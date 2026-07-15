# Foreshadow Semantic Alias Merge Design

## Status

Approved for implementation on 2026-07-15.

## Problem

StoryMemory currently identifies a foreshadow only by `foreshadowId`. Two
`foreshadow-introduce` events with different IDs therefore become two independent
obligations even when they establish the same unresolved narrative question. Every downstream
consumer then counts them separately: scheduling, act and story boundary pressure, planning,
fulfillment verification, CLI display, and author commands.

This is an identity-model defect, not a text-normalization defect. Runtime code must not compare
story prose with keywords, regular expressions, n-grams, fuzzy similarity, or other natural-language
matching. The system needs an explicit, event-sourced equivalence relation decided through
structured model output and consumed through exact IDs.

## Goals

- Automatically merge every pair or group the semantic detector judges equivalent.
- Prevent new duplicate foreshadows and repair historical duplicates on the next normal story run.
- Preserve the earliest introduced foreshadow as the authoritative record.
- Keep old IDs addressable for fulfillment and audit without counting them as separate obligations.
- Fail closed when semantic detection or its structured protocol fails.
- Preserve checkpoint replay, event history, and the prohibition on direct `books/` edits.
- Keep all runtime logic neutral across stories, genres, characters, objects, and languages.

## Non-goals

- No lexical or fuzzy prose matching in TypeScript.
- No deletion or rewriting of historical introduction events.
- No confidence threshold: if the detector returns a valid duplicate group, the group is merged.
- No automatic merging merely because clues are related, causal, or mention the same entity.
- No direct repair of generated files under `books/`.
- No general-purpose entity deduplication outside foreshadows.

## User Decisions

- A valid semantic duplicate judgment always triggers automatic merging.
- Both future introductions and historical active foreshadows are covered.
- The earliest introduced record owns text, policy, deadline, kind, and beat binding.
- A later duplicate must never strengthen or move the canonical record's obligation.
- Detector/provider/protocol failure aborts the current chapter before partial state is committed.

## Event Model

Add a new StoryMemory event:

```ts
interface ForeshadowMergeEvent extends BaseEvent {
  type: 'foreshadow-merge'
  canonicalForeshadowId: ForeshadowId
  duplicateForeshadowId: ForeshadowId
  reason: string
}
```

The event is runtime reconciliation metadata and uses `source: 'outline'`. `reason` is retained for
human audit only. Runtime behavior must never parse or match the reason.

The normalized event contract requires:

- both IDs are valid machine identifiers;
- the IDs are different;
- `reason` is a non-empty string;
- both IDs exist when the event is applied;
- the canonical record precedes the duplicate under the canonical ordering;
- adding the edge cannot create a cycle.

The generic event-contract layer validates shape. The merge builder and projector validate
memory-dependent invariants.

## Canonical Ordering

Canonical selection is deterministic and performed by code after the model returns duplicate
groups:

1. lower `introducedIn` chapter index;
2. earlier `foreshadow-introduce` event position in the event log;
3. lexical ID order as a final stable tie-breaker.

The model never chooses the canonical ID. This keeps the same validated duplicate grouping stable
across retries and providers.

## Projection Model

StoryMemory advances to version `3`. `ForeshadowMemory` gains:

```ts
mergedInto?: ForeshadowId
```

The projector retains every introduced record. A duplicate remains visible by its old ID and points
to its root canonical record through `mergedInto`. Legal alias chains are flattened to the root.

When replay reaches `foreshadow-merge`:

- the canonical record remains unchanged;
- the duplicate receives `mergedInto: canonicalId`;
- an earlier fulfillment on the duplicate is transferred to the canonical record using the earliest
  fulfillment chapter;
- the duplicate's text, kind, policy, deadline, beat binding, waiver, and deadline extensions do not
  overwrite or strengthen the canonical record.

After a merge:

- `foreshadow-fulfill` targeting an alias resolves to and fulfills the root canonical ID;
- scheduling/planning declarations targeting an alias normalize to the root canonical ID;
- automatic policy/deadline mutations targeting an alias do not modify the canonical record;
- author mutation commands presented with an alias report its canonical ID instead of silently
  changing a different record.

Version-1 memory first receives the existing resolution-policy migration and then the version-3
shape migration. Version-2 memory receives the version-3 shape migration. Neither migration invents
semantic aliases; historical equivalence is decided by the runtime detector.

## Canonical ID Utilities

Provide centralized utilities rather than duplicating alias logic:

- `resolveCanonicalForeshadowId(memory, id)` returns the flattened root or `null` for an unknown or
  invalid chain.
- `getCanonicalForeshadows(memory)` returns only root records.
- `canonicalizeForeshadowIds(memory, ids)` resolves exact IDs and removes duplicate roots while
  preserving first occurrence order.

All foreshadow consumers must use these utilities. They must not inspect `mergedInto` independently
or implement local filtering.

Consumers include:

- active, mandatory, overdue, and opportunity queries;
- act/story capacity and boundary pressure;
- outline obligations and ChapterPlan fulfillment declarations;
- expected and actual `foreshadow-fulfill` events;
- semantic planning and post-draft fulfillment verifiers;
- verified constraints, reports, status/info output, and the legacy foreshadow stack projection;
- waive and policy author commands.

## Semantic Equivalence Detector

Add a model-backed service with structured input and output. Each candidate contains only data needed
for semantic judgment:

```ts
interface ForeshadowEquivalenceCandidate {
  id: ForeshadowId
  text: string
  kind: ForeshadowKind | null
  introducedChapter: number
}
```

The detector receives active, unfulfilled, unwaived canonical records plus proposed introductions.
Its instruction defines equivalence narrowly: records are duplicates only when resolving either one
would resolve the same outstanding narrative question or obligation. Sharing an entity, motif,
scene, cause, or thematic relation is insufficient.

Structured output contains zero or more groups:

```ts
interface ForeshadowEquivalenceGroup {
  ids: ForeshadowId[]
  reason: string
}
```

Protocol validation requires:

- every group contains at least two distinct IDs;
- every ID came from the input candidate set;
- an ID appears in at most one group;
- returned IDs and groups are not silently added, removed, or repaired;
- reasons are non-empty but remain audit-only prose.

No confidence field is requested or used. Every valid returned group produces merge events. Provider
errors, malformed output, unknown IDs, duplicate IDs, or overlapping groups produce a typed failure.

## Historical Reconciliation Flow

The chapter preparation path runs historical reconciliation before outline expansion:

1. Project and normalize StoryMemory.
2. Collect active canonical candidates.
3. Check a versioned operational audit marker in graph state. The marker stores the exact ordered
   canonical ID set and detector protocol version; it contains no prose and does not affect narrative
   projection.
4. If the marker covers the current set, skip the model call.
5. Otherwise call the detector once for the complete active set.
6. Validate groups, choose canonicals, build merge events, and apply them atomically.
7. Update StoryMemory, legacy stack projection, verified constraints, and the audit marker in the same
   state update.
8. Continue into outline expansion using canonical IDs only.

The operational marker is a checkpoint cache, not narrative truth. Losing it can only cause a safe
repeat scan; it cannot change replayed StoryMemory. Any active-set change invalidates it.

If detection or application fails, preparation throws a typed blocking error. No merge event or
partial projection is returned.

## New Introduction Flow

Chapter finalization checks proposed introductions before committing StoryMemory:

1. Collect evidence-valid `foreshadow-introduce` events from the authoritative draft event block.
2. Form a proposed candidate set from existing active canonicals and all new introductions, allowing
   detection both against history and among multiple new IDs.
3. Call and validate the detector before returning finalized state.
4. Apply introduction events followed by deterministic merge events in one local event batch.
5. Reproject canonical state, constraints, reports, and the legacy stack.
6. Update the operational audit marker to the resulting active canonical ID set.

SummaryAgent remains forbidden from introducing foreshadows, so no second introduction path is
needed.

If detection fails, finalization returns or throws a blocking structured failure and does not return
the proposed StoryMemory update. The chapter is not marked finalized.

## Planning and Validation Normalization

At the chapter planning boundary, exact-ID canonicalization is applied to:

- outline `fulfilledForeshadowIds` and `deferredForeshadowIds`;
- ChapterPlan `fulfilledForeshadowIds`;
- `foreshadow-fulfill` expected events;
- structured validation's expected and actual fulfillment IDs.

When multiple aliases resolve to the same canonical ID, only one obligation and one expected event
remain. Evidence is not fabricated: an existing event is retained deterministically, and conflicting
events remain a structured planning error rather than being merged by prose.

The pre-draft semantic fulfillment verifier receives one canonical obligation. The post-draft
verifier accepts evidence declared through an old alias but judges it against canonical planted text.

## CLI and Observability

When merges are applied, the CLI logs one line per edge and a summary, for example:

```text
[MuseFlow] 已将 duplicate-id 归并到 canonical-id：同一伏笔义务
[MuseFlow] 活跃伏笔义务已从 4 个归并为 3 个
```

Status and boundary-pressure displays list only canonical records. Detailed story information may
show aliases beneath a canonical record for audit, but aliases never increase counts.

Author commands behave explicitly:

- fulfillment references may use a canonical ID or alias;
- policy/waive commands given an alias stop with an actionable message naming the canonical ID;
- no author command silently creates, removes, or reverses a semantic merge.

## Failure Handling

Fail closed in all semantic or structural ambiguity cases:

- provider unavailable or request failure;
- malformed structured output;
- unknown or repeated output IDs;
- overlapping groups;
- self-merge, missing introduction, reversed canonical order, or alias cycle;
- partial application or projection failure.

The blocking error includes the stage and machine IDs but does not derive control flow from the
model's prose reason. A retry may rerun the detector. No merge event is persisted until the entire
batch validates.

## Test Strategy

### Event contract and projection

- Normalize a valid merge event and reject malformed IDs, self-merge, and empty reason.
- Project a direct alias and a valid alias chain to the root.
- Make `applyEvents` throw a typed merge-validation error for unknown IDs, reversed canonical order,
  and cycles; it must never silently ignore an invalid merge.
- Preserve canonical text, kind, policy, deadline, beat binding, and waiver.
- Transfer alias fulfillment to canonical without transferring stricter alias policy.
- Resolve a later fulfillment event addressed to an alias.
- Migrate version-1 and version-2 memory to version 3 with no invented aliases.

### Detector

- Accept valid disjoint duplicate groups.
- Reject unknown IDs, repeated IDs, overlapping groups, malformed cardinality, and provider failure.
- Confirm canonical choice is deterministic and independent of model group ordering.
- Use neutral fixture descriptions; no production behavior depends on fixture prose.

### Runtime integration

- Preparation merges historical duplicates before scheduling and persists one merge event.
- An unchanged audited active set skips a repeated detector call.
- Active-set changes invalidate the audit marker.
- Finalization merges a new ID against history and merges two new IDs in the same chapter.
- Detection failure blocks preparation/finalization without partial StoryMemory changes.
- Outline, plan, expected events, validation, constraints, and legacy stack use canonical IDs.

### CLI and invariants

- Boundary pressure and status count a duplicate group once.
- Alias fulfillment affects the canonical record.
- Policy/waive commands reject aliases and name the canonical ID.
- `tests/smoke/no-prose-matching.test.ts` continues to pass.
- Type checking, lint, formatting, targeted tests, and the full test suite pass.

## Acceptance Criteria

- A story containing two active IDs for the same semantic clue emits one merge edge on its next
  normal `write` or `rewrite` run.
- The earlier introduction remains canonical and retains its own current contract.
- The duplicate remains traceable through `mergedInto` but disappears from obligation counts.
- Repeating the command emits no duplicate merge event and performs no unnecessary semantic scan
  while the active canonical ID set is unchanged.
- Model/protocol failure stops before outline generation or final chapter commit.
- The reported regression changes four structural obligations representing three semantic clues into
  three active canonical obligations without editing generated story files by hand.
