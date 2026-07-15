# Foreshadow Semantic Planning Root Fix

## Problem

MuseFlow can create an internally contradictory chapter contract near an act or story boundary:

1. Legacy foreshadow events with `required: false` and a finite
   `expectedFulfillChapter` are replayed as `must_resolve`, although the legacy runtime treated
   them as optional.
2. The scheduler passes only foreshadow IDs and policy metadata to the chapter-outline and
   chapter-planner agents. It omits the planted text that defines what must be resolved.
3. Outline and plan validation checks that fulfillment IDs and `foreshadow-fulfill` events exist,
   but it does not check whether the planned narrative actually resolves the planted clue.
4. When post-draft semantic validation reports `foreshadow_false_fulfillment`, routing keeps the
   contradictory chapter plan and only drafts the prose again.

This produces a deterministic retry loop: the writer is repeatedly asked to satisfy the same
semantically impossible outline and event contract.

## Goals

- Preserve the non-blocking meaning of legacy `required: false` events.
- Give planning agents the semantic information needed to design a real fulfillment.
- Reject false fulfillment plans before spending a full chapter-generation call.
- Re-enter planning when a false fulfillment escapes the pre-draft gate.
- Keep the post-draft semantic verifier as defense in depth.
- Use structured IDs, enums, typed fields, and structured model output; add no prose matching in
  runtime code.

## Non-goals

- Do not edit generated story data under `books/`.
- Do not automatically merge semantically similar foreshadow IDs.
- Do not weaken post-draft semantic verification or downgrade false fulfillments.
- Do not redesign all chapter-planning or routing policies.
- Do not introduce story-specific rules or prompt text.

## Design

### 1. Preserve legacy optional semantics

Legacy events without an explicit `resolutionPolicy` are interpreted using both legacy fields:

| Legacy fields | V2 policy | Projected deadline |
| --- | --- | --- |
| `required: true`, finite deadline | `must_resolve` | original finite deadline |
| `required: true`, null deadline | `should_resolve` | `null` |
| `required: false`, any deadline | `may_remain_open` | `null` |
| missing `required`, finite deadline | `must_resolve` | original finite deadline |
| missing `required`, null deadline | `should_resolve` | `null` |

The original event log remains unchanged. Projection and V1-to-V2 migration normalize the policy
and projected deadline. Replaying an existing checkpoint therefore produces the corrected policy
projection without an in-place story-data patch, and optional legacy clues stop becoming boundary
blockers.

### 2. Make planning obligations semantically complete

`ForeshadowPlanningObligation` gains the planted clue fields required for planning:

- `text`
- `kind`
- `introducedChapter`
- existing ID, policy, deadline, scheduling mode, and `mustFulfillThisChapter`

The outline and planner prompt fragment renders these fields for every obligation. The text is
context data, not an instruction. Prompts continue to require exact IDs in declarations and
events.

### 3. Add a pre-draft semantic planning gate

Before `expandOutlineForChapter` returns a chapter plan, a focused structured verifier evaluates
every ID claimed by `outline.fulfilledForeshadowIds` or `chapterPlan.fulfilledForeshadowIds`.

For each candidate it receives:

- foreshadow ID and planted text;
- outline title and description;
- relevant planned sections and expected fulfillment event;
- whether the obligation is mandatory for this chapter.

It returns exactly one structured judgment per ID:

- `fulfilled`: the planned events materially resolve the planted uncertainty;
- `not_fulfilled`: the plan is unrelated or contradictory;
- `uncertain`: the plan lacks enough detail to justify a fulfillment claim.

The verifier must not search for keywords or compare prose in TypeScript. Semantic judgment is
performed by the model through a JSON schema; TypeScript only validates IDs, verdict enums, and
response completeness.

### 4. Correct invalid plans before drafting

For a mandatory obligation rejected by the planning gate:

1. Record the exact ID, verdict, and reason in a typed planning rejection.
2. Invoke the chapter-outline agent in a targeted revision path with the current title,
   description, planted clue context, and semantic rejection. This path runs even when the current
   outline already has a non-empty description, and replaces the current chapter outline only
   after the revised candidate passes existing authority/conflict checks.
3. Discard the current chapter plan and generate a fresh plan from the revised outline.
4. Run the semantic planning gate once more.
5. If the second result still fails, stop before drafting with an actionable planning error rather
   than entering the prose rewrite loop.

For an opportunity or ambient obligation, a valid `not_fulfilled` or `uncertain` judgment removes
the ID and its expected fulfillment event from the outline and plan fulfillment declarations, then
adds the ID to `deferredForeshadowIds` without blocking the chapter. Provider or response-contract
failures remain errors; they are never converted into a deferral.

The retry is bounded and uses the existing two-attempt planning pattern.

### 5. Replan escaped post-draft false fulfillments

Post-draft `foreshadow_false_fulfillment` remains a structured error, but its retry behavior changes:

- discard the current chapter plan;
- preserve the semantic rejection in verified planning feedback;
- return through outline expansion and the pre-draft semantic gate;
- do not perform another prose-only retry with the old plan.

Other structured errors retain their current routing behavior. The existing
`forceStructuralRewrite` log must describe the actual scope of the retry.

### 6. Checkpoint and rewrite behavior

All changes operate on the in-memory graph state and persisted checkpoint projections. No command
edits chapter files or StoryMemory events directly. Rewriting an older chapter replays the original
event log through the corrected policy projection, then follows normal checkpoint commit behavior.

The CLI preview/runtime checkpoint mismatch is tracked as a separate issue because it does not
cause the semantic planning deadlock and is outside this focused root fix.

## Error handling

- Missing foreshadow records are rejected structurally before the model call.
- Missing, duplicate, or unknown judgment IDs reject the planning verification response.
- Model-call failures yield a planning verification error and do not silently accept fulfillment.
- Mandatory planning failures stop before drafting after the bounded retry.
- Valid non-mandatory `not_fulfilled` or `uncertain` judgments defer the candidate and continue.

## Testing strategy

Tests are written first and must demonstrate the original failure before implementation.

1. Resolution-policy tests prove `required: false` plus a finite deadline projects to
   `may_remain_open` with a null deadline, while missing `required` plus a finite deadline remains
   `must_resolve`.
2. Prompt tests prove outline and planner obligations include planted text and metadata.
3. Planning-verifier tests cover fulfilled, contradictory, uncertain, malformed, duplicate-ID,
   and provider-failure responses.
4. Outline-expander tests prove mandatory semantic rejection regenerates outline and plan before
   drafting, while non-mandatory rejection defers.
5. Routing tests prove `foreshadow_false_fulfillment` discards the plan and unrelated structured
   issues continue to preserve it.
6. An integration regression reproduces the key contradiction: a planted clue says a light
   remained on while the plan says it did not light. The chapter writer must not be called with
   that rejected plan.

## Success criteria

- Optional legacy clues no longer appear as `must_resolve` boundary pressure.
- Planning agents receive the planted meaning for every scheduled foreshadow.
- A semantically contradictory fulfillment plan cannot reach `draft_chapter`.
- A post-draft false fulfillment cannot reuse the same chapter plan.
- Existing post-draft semantic verification remains strict.
- Typecheck, lint, smoke guards, targeted tests, and the full test suite pass.
