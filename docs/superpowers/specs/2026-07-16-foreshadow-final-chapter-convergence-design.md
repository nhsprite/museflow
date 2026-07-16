# Foreshadow Final-Chapter Convergence Root Fix

Date: 2026-07-16

## Problem

MuseFlow can preserve every unresolved `must_resolve` obligation at the final-act boundary and
still fail before drafting the last chapter. Three contracts currently interact badly:

1. Tight scheduling treats `foreshadowMaxFulfillmentsPerChapter` as a dependable target rather
   than a hard ceiling. If the remaining backlog exactly fits future maximum capacity, the current
   chapter may defer the whole batch. The final chapter then inherits a capacity-saturating batch
   alongside its remaining mandatory beats.
2. A semantic-planning rejection regenerates a complete outline. The structural correction loop
   does not carry the immediately preceding candidate forward, so a later attempt may repair one
   obligation while dropping obligations that the prior attempt declared.
3. A foreshadow records the planted observation but not the uncertainty to resolve or the evidence
   that would count as fulfillment. Planning and verification therefore infer different meanings
   for observational clues.

The reported state demonstrates all three conditions: chapter 60 deferred three blocking clues
because chapter 61 had a configured maximum capacity of three; chapter 61 then had to combine all
three with two closing beats; and its semantic revision alternated between missing one ID and
missing the other two before producing a generic boundary error.

## Goals

- Drain hard obligations before the last available chapter when doing so creates planning
  headroom.
- Force only the minimum number of obligations needed in the current chapter, rather than the
  entire selected batch.
- Make outline correction cumulative and prevent a later revision from silently dropping prior
  required decisions.
- Add structured resolution intent for newly introduced foreshadows.
- Keep every persisted checkpoint and legacy event readable without an in-place migration.
- Preserve semantic verification: an ID declaration alone must never count as fulfillment.
- Report planning non-convergence as planning non-convergence, not as insufficient act capacity.
- Keep all runtime decisions based on typed fields and stable IDs; add no prose matching.

## Non-goals

- Do not edit data under `books/`.
- Do not automatically fulfill, waive, merge, or downgrade an existing foreshadow.
- Do not weaken the final boundary invariant or semantic verifier.
- Do not make a story-specific rule for letters, lamps, handwriting, evidence, or endings.
- Do not guarantee that every arbitrary set of clues is narratively compatible in one chapter.

## Approaches Considered

### A. Increase retry counts

This may hide stochastic failures but keeps the capacity cliff, permits revision regression, and
does not improve semantic information. Rejected because it treats the symptom.

### B. Make equality enter the existing tight mode

Changing `<=` to `<` would make chapter 60 tight in the reported state, but the current tight mode
forces every scheduled ID. It would move the same three-clue overload from chapter 61 to chapter
60. Rejected because it changes where the overload happens rather than distributing it.

### C. Headroom-aware minimum-share scheduling plus cumulative revision and optional resolution
intent

Use a configurable planning target below the hard per-chapter ceiling, compute the exact minimum
share required now, preserve revision state across attempts, and enrich new foreshadows with an
optional structured resolution contract. This is the selected approach because it fixes the
capacity, convergence, and semantic-contract causes while remaining backward compatible.

## Design

### 1. Separate hard capacity from planning target

Add `foreshadowFulfillmentHeadroomPerChapter` to `ChapterPlanningConfig`.

- Default: `1`.
- Genre skills may override it through the existing `chapterPlanning` configuration.
- Normalize it to a non-negative integer smaller than the configured maximum when the maximum is
  greater than one.
- The hard maximum remains `foreshadowMaxFulfillmentsPerChapter` and continues to bound the
  selected batch.

Define:

```text
hardCapacity = normalized foreshadowMaxFulfillmentsPerChapter
targetCapacity = max(1, hardCapacity - normalized headroom)
futureTargetSlots = chaptersAfterCurrent * targetCapacity
minimumRequiredNow = max(0, pendingBlockingCount - futureTargetSlots)
```

The current chapter marks only the first `minimumRequiredNow` scheduled blocking IDs as
`mustFulfillThisChapter`, bounded by the hard capacity. Ordering continues to use the existing
deterministic scheduler.

For the reported chapter 60 state:

```text
hardCapacity = 3
targetCapacity = 2
futureTargetSlots = 1 * 2
minimumRequiredNow = 3 - 2 = 1
```

Chapter 60 must therefore recover one clue, leaving at most two for chapter 61. At the last
chapter, `futureTargetSlots` is zero, so every remaining selected blocker is mandatory.

The act-extension calculation continues to use hard capacity. Headroom guides distribution; it
must not extend the story merely to preserve optional slack.

### 2. Carry cumulative outline-revision state

Extend `ForeshadowPlanningRejection` with optional structured revision context:

- `requiredFulfillmentIds`: the complete canonical mandatory set for the current chapter;
- `preservedFulfillmentIds`: required IDs declared by the immediately preceding candidate and not
  implicated by that candidate's structural failure.

The existing `currentOutline` field is updated to the immediately preceding candidate before every
JIT retry. Every retry therefore receives the complete required set, the latest candidate, and the
current failure set. The prompt requires the model to revise that candidate and preserve concrete
events for IDs outside the failure set while fixing the listed IDs.

Runtime validation still checks the entire required set after every attempt. No TypeScript merge
may add a fulfillment ID that the candidate did not return, because doing so would create a false
claim. If a later attempt drops a previously preserved ID, record it as a regression and include it
in the next rejection.

Retry limits remain bounded. If structural convergence still fails, throw an error that identifies:

- the complete required set;
- the final missing, deferred, conflicting, and regressed IDs;
- whether the retry originated from semantic rejection.

Do not suggest adjusting the act boundary when the hard-capacity calculation already proves that
the batch fits. Boundary guidance remains appropriate only for a real capacity-adjustment failure.

### 3. Add an optional structured resolution contract

Add two optional fields to `ForeshadowIntroduceEvent` and `ForeshadowMemory`:

- `resolutionQuestion?: string`: the unresolved question created by the planted clue;
- `fulfillmentCriteria?: string`: the observable narrative change or revelation that would count
  as resolving it.

New planner and summary prompts request both fields for newly generated `must_resolve` clues and
encourage them for `should_resolve` clues. `may_remain_open` clues may omit them.

The strict event contract validates either field as a non-empty string when present. It does not
require the fields during event replay, so legacy JSON and checkpoints remain valid. New model
output that omits them remains structurally accepted during the compatibility window, but prompt
tests ensure the runtime requests them.

Projection copies the fields when present. Deadline extension, policy changes, merge aliases, and
fulfillment preserve the canonical record's fields. Planning obligations and the semantic planning
verifier receive both optional fields. For a legacy clue they receive `null`/absence and continue
using planted text as context; no runtime prose interpretation is added.

This compatibility rule deliberately avoids fabricating resolution intent for old stories. The
headroom and cumulative-revision fixes improve their convergence, while newly written stories gain
an explicit semantic contract.

### 4. Semantic retry data flow

When the planning verifier rejects a mandatory clue:

1. Preserve the verifier's exact ID, verdict, and reason.
2. Set `requiredFulfillmentIds` to the current canonical mandatory set.
3. Set `currentOutline` to the rejected outline and update it to each subsequent candidate.
4. Regenerate the outline with the cumulative revision context.
5. Generate a fresh chapter plan only after the outline structurally covers the complete set.
6. Re-run semantic verification over the complete claimed set.

A structurally regressed outline never replaces the in-memory accepted outline. A semantically
rejected plan never reaches chapter drafting.

### 5. Compatibility and persistence

- Do not increment StoryMemory's version solely for additive optional fields.
- Existing events without the new fields project exactly as before.
- Existing checkpoints deserialize without a migration command.
- New fields persist only through normal structured events and checkpoint commits.
- Failed outline or plan attempts do not write StoryMemory or chapter files.
- No repair directly edits `books/`.

## Error Handling

Introduce no story-text classification in TypeScript. Errors are derived from typed planning
state:

- real capacity exhaustion: retain existing act-adjustment guidance;
- mandatory structural omission or regression: report outline revision non-convergence;
- structured plan evidence omission: retain the exact-ID plan error;
- semantic rejection after the bounded retry: report semantic planning non-convergence and its
  structured reasons;
- malformed verifier output or provider failure: remain verification errors, never deferrals.

## Testing Strategy

Tests are written before production changes and must fail for the current implementation.

1. Planning configuration tests cover the default and normalized headroom.
2. Pure scheduling tests prove that three blockers, two remaining chapters, hard capacity three,
   and headroom one require exactly one fulfillment now.
3. Scheduling tests prove that the last chapter requires every remaining scheduled blocker and
   that headroom alone does not extend an act.
4. Outline-expander tests reproduce revision regression: attempt one omits A while declaring B/C;
   attempt two fixes A but drops B/C. The second input must carry the latest candidate and complete
   required set, and the error must identify non-convergence rather than suggest a boundary change.
5. A convergence test proves a revision that preserves B/C and fixes A proceeds to fresh planning
   and semantic verification.
6. Event-contract and projector tests cover new optional fields and legacy events with neither
   field.
7. Outline, planner, chapter, and summary prompt tests verify that resolution intent is requested
   and rendered as inert context.
8. Planning-verifier tests verify that optional resolution intent is included for new clues and
   omitted safely for legacy clues.
9. Smoke tests confirm no prose matching is added.

Run focused Vitest suites during red-green cycles, followed by typecheck, lint, formatting check,
build, the no-prose-matching smoke test, and the complete test suite.

## Success Criteria

- With three blocking clues and chapters 60–61 remaining, default configuration requires at least
  one clue in chapter 60 and leaves at most two for chapter 61.
- The hard per-chapter maximum remains three and no automatic act extension is caused solely by
  planning headroom.
- A semantic outline revision cannot silently trade one missing mandatory ID for another without
  a precise non-convergence diagnostic.
- Newly introduced hard clues can state what question they open and what evidence will resolve it.
- Every legacy checkpoint and event without the new fields remains readable and behaves according
  to its existing policy and deadline.
- Semantic validation remains strict and scheduling never marks a clue fulfilled.
- No code or prompt contains story-specific concepts, and no runtime control flow matches prose.
