# Foreshadow Semantic Alias Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically collapse semantically equivalent foreshadow IDs into one event-sourced canonical obligation for both historical memory and new chapter introductions.

**Architecture:** Add a strict `foreshadow-merge` event and StoryMemory v3 alias projection, then use a model-backed structured equivalence detector at chapter preparation and finalization boundaries. All downstream consumers resolve exact IDs through centralized canonicalization utilities; TypeScript never infers equivalence from prose.

**Tech Stack:** Node.js 20+, TypeScript strict ESM, LangGraph checkpoints, structured `ModelProvider` calls, zod-free JSON-schema validation patterns, Vitest, ESLint, Prettier.

---

## File Structure

### New files

- `src/story-memory/foreshadow-alias.ts` — canonical ID resolution, canonical-record queries, deterministic canonical ordering, and merge-event construction.
- `src/graph/services/foreshadow-equivalence/detector.ts` — model-backed structured semantic grouping with fail-closed protocol validation.
- `src/graph/services/foreshadow-equivalence/reconcile.ts` — historical/new-candidate reconciliation orchestration and audit-marker construction.
- `src/utils/story-memory-constraints.ts` — one canonical rebuild path for StoryMemory and foreshadow-boundary verified constraints.
- `tests/story-memory/foreshadow-alias.test.ts` — alias utilities and deterministic merge construction.
- `tests/graph/services/foreshadow-equivalence/detector.test.ts` — detector protocol tests.
- `tests/graph/services/foreshadow-equivalence/reconcile.test.ts` — reconciliation atomicy and audit behavior.

### Existing files with focused changes

- `src/types/story-memory.ts` — v3 memory, merge event, `mergedInto` projection.
- `src/story-memory/resolution-policy.ts` — v1/v2 to v3 migration.
- `src/story-memory/event-contract.ts`, `parser.ts`, `event-format.ts`, `diff.ts` — machine-readable merge-event support.
- `src/story-memory/projector.ts` — replay merge edges and alias-addressed fulfillment.
- `src/graph/state.ts` — versioned operational equivalence audit marker.
- `src/graph/services/chapter-orchestration/preparation.ts`, `src/graph/nodes/chapter-orchestration.ts` — historical gate before planning.
- `src/graph/services/finalization/chapter.ts` — proposed-introduction gate before commit.
- `src/types/agent.ts`, `src/types/chapter-report.ts` — explicit detector-failure issue and exhaustive report accounting.
- `src/story-memory/foreshadow-policy.ts`, `queries.ts`, `validator.ts` — canonical-only scheduling and validation.
- `src/core/outline-expander.ts` — normalize outline and plan claims at the planning boundary.
- `src/graph/services/foreshadow-fulfillment/planning-verifier.ts`, `semantic-verifier.ts` — accept aliases but judge canonical planted records once.
- `src/cli/commands/waive-foreshadow.ts`, `set-foreshadow-policy.ts` — reject alias mutations with canonical guidance.
- `src/core/runner.ts`, `src/storage/meta/exporter.ts` — use current StoryMemory migration.
- Mirrored tests under `tests/story-memory`, `tests/graph`, `tests/core`, and `tests/cli`.

---

### Task 1: StoryMemory v3 and merge event contract

**Files:**

- Modify: `src/types/story-memory.ts`
- Modify: `src/story-memory/resolution-policy.ts`
- Modify: `src/story-memory/event-contract.ts`
- Modify: `src/story-memory/parser.ts`
- Modify: `src/story-memory/event-format.ts`
- Modify: `src/story-memory/diff.ts`
- Modify: `src/core/runner.ts`
- Modify: `src/storage/meta/exporter.ts`
- Modify: `src/cli/commands/set-foreshadow-policy.ts`
- Test: `tests/types/story-memory.test.ts`
- Test: `tests/story-memory/resolution-policy.test.ts`
- Test: `tests/story-memory/event-contract.test.ts`
- Test: `tests/story-memory/parser.test.ts`
- Test: `tests/story-memory/event-format.test.ts`
- Test: `tests/story-memory/diff.test.ts`

- [ ] **Step 1: Write failing type, migration, and event-contract tests**

Add tests that construct v3 memory and a merge event, migrate v1/v2 without inventing aliases, and reject malformed merge records:

```ts
const merge: StoryEvent = {
  id: 'evt-merge-1',
  type: 'foreshadow-merge',
  canonicalForeshadowId: 'fs-early',
  duplicateForeshadowId: 'fs-late',
  reason: 'Both records establish the same unresolved question.',
  chapterIndex: 4,
  source: 'outline',
}

expect(migrateStoryMemoryToV3(v2Memory)).toMatchObject({
  version: '3',
  foreshadows: { 'fs-early': expect.not.objectContaining({ mergedInto: expect.anything() }) },
})

expect(
  normalizeStoryEvent({ ...merge, duplicateForeshadowId: 'fs-early' }, { mode: 'strict' })
).toMatchObject({ valid: false, reason: 'foreshadow-merge ids must be different' })
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
npx vitest run tests/types/story-memory.test.ts tests/story-memory/resolution-policy.test.ts tests/story-memory/event-contract.test.ts tests/story-memory/parser.test.ts tests/story-memory/event-format.test.ts tests/story-memory/diff.test.ts
```

Expected: FAIL because StoryMemory only accepts version `2`, `ForeshadowMergeEvent` does not exist, and the parser/formatter/diff have no merge branch.

- [ ] **Step 3: Add the v3 types and migration chain**

Implement the exact public types and migration entry point:

```ts
export interface StoryMemory {
  version: '3'
  // existing fields unchanged
}

export interface ForeshadowMergeEvent extends Omit<BaseEvent, 'source'> {
  type: 'foreshadow-merge'
  source: 'outline'
  canonicalForeshadowId: ForeshadowId
  duplicateForeshadowId: ForeshadowId
  reason: string
}

export interface ForeshadowMemory {
  // existing fields unchanged
  mergedInto?: ForeshadowId
}

export interface LegacyStoryMemoryV2 extends Omit<StoryMemory, 'version'> {
  version: '2'
}

function migrateStoryMemoryV1ToV2(memory: LegacyStoryMemoryV1): LegacyStoryMemoryV2 {
  // Move the existing v1 field-normalization body here unchanged.
}

export function migrateStoryMemoryToV3(
  memory: StoryMemory | LegacyStoryMemoryV2 | LegacyStoryMemoryV1
): StoryMemory {
  if (memory.version === '3') return memory
  const v2 = memory.version === '1' ? migrateStoryMemoryV1ToV2(memory) : memory
  return { ...v2, version: '3' }
}
```

Move the current v1 normalization logic into `migrateStoryMemoryV1ToV2`; do not reference an
undefined migration helper. Remove the old `migrateStoryMemoryToV2` export after updating every
repository call site to `migrateStoryMemoryToV3` in this task.

- [ ] **Step 4: Add strict merge parsing, formatting, and event identity**

Use machine-field validation only:

```ts
case 'foreshadow-merge': {
  if (base.source !== 'outline') {
    return invalid('foreshadow-merge.source must be outline')
  }
  if (!isMachineIdentifier(event.canonicalForeshadowId)) {
    return invalid('foreshadow-merge.canonicalForeshadowId must be an identifier')
  }
  if (!isMachineIdentifier(event.duplicateForeshadowId)) {
    return invalid('foreshadow-merge.duplicateForeshadowId must be an identifier')
  }
  if (event.canonicalForeshadowId === event.duplicateForeshadowId) {
    return invalid('foreshadow-merge ids must be different')
  }
  if (typeof event.reason !== 'string' || event.reason.trim().length === 0) {
    return invalid('foreshadow-merge.reason must be a non-empty string')
  }
  return valid(normalizedBaseEvent)
}
```

Format with explicit delimiters for audit display and compare merge events by both IDs in `diff.ts`.
The chapter `STORY_EVENTS` parser must not parse a `foreshadow-merge` line: only runtime
reconciliation can create this operational event. Update parser exhaustiveness for the new union
member and add a test proving chapter text cannot emit it.

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```bash
npx vitest run tests/types/story-memory.test.ts tests/story-memory/resolution-policy.test.ts tests/story-memory/event-contract.test.ts tests/story-memory/parser.test.ts tests/story-memory/event-format.test.ts tests/story-memory/diff.test.ts
npm run typecheck
```

Expected: all selected tests PASS and TypeScript reports no version/type errors.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/types/story-memory.ts src/story-memory/resolution-policy.ts src/story-memory/event-contract.ts src/story-memory/parser.ts src/story-memory/event-format.ts src/story-memory/diff.ts src/core/runner.ts src/storage/meta/exporter.ts src/cli/commands/set-foreshadow-policy.ts tests/types/story-memory.test.ts tests/story-memory/resolution-policy.test.ts tests/story-memory/event-contract.test.ts tests/story-memory/parser.test.ts tests/story-memory/event-format.test.ts tests/story-memory/diff.test.ts
git commit -m "[Feature] Add foreshadow merge event contract" -m "Introduce StoryMemory v3 and strict round-trippable merge event metadata without inventing semantic aliases during migration." -m "issue: #N/A"
```

---

### Task 2: Alias projection and canonical ID utilities

**Files:**

- Create: `src/story-memory/foreshadow-alias.ts`
- Modify: `src/story-memory/projector.ts`
- Test: `tests/story-memory/foreshadow-alias.test.ts`
- Test: `tests/story-memory/projector.test.ts`

- [ ] **Step 1: Write failing alias and projector tests**

Cover direct merge, chain flattening, deterministic canonical selection, transferred fulfillment, preserved canonical policy, alias-addressed later fulfillment, and fail-closed invalid edges:

```ts
const merged = applyEvents(memoryWithIntroductions, [
  mergeEvent('fs-early', 'fs-middle'),
  mergeEvent('fs-middle', 'fs-late'),
])

expect(resolveCanonicalForeshadowId(merged, 'fs-late')).toBe('fs-early')
expect(merged.foreshadows['fs-late']?.mergedInto).toBe('fs-early')
expect(getCanonicalForeshadows(merged).map((item) => item.id)).toEqual(['fs-early'])

expect(() => applyEvents(memoryWithIntroductions, [mergeEvent('fs-late', 'fs-early')])).toThrow(
  ForeshadowMergeValidationError
)
```

Use neutral texts such as “A sealed record has an unexplained mark” and “The same unexplained mark remains on the sealed record”; the mock merge event, not the prose, drives projection behavior.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npx vitest run tests/story-memory/foreshadow-alias.test.ts tests/story-memory/projector.test.ts
```

Expected: FAIL because canonical utilities and merge replay do not exist.

- [ ] **Step 3: Implement the canonical utility module**

Expose only centralized exact-ID operations:

```ts
export class ForeshadowMergeValidationError extends Error {}

export function resolveCanonicalForeshadowId(
  memory: StoryMemory,
  id: ForeshadowId
): ForeshadowId | null

export function getCanonicalForeshadows(memory: StoryMemory): ForeshadowMemory[]

export function canonicalizeForeshadowIds(
  memory: StoryMemory,
  ids: readonly ForeshadowId[]
): ForeshadowId[]

export function compareCanonicalOrder(
  memory: StoryMemory,
  leftId: ForeshadowId,
  rightId: ForeshadowId
): number
```

`compareCanonicalOrder` derives introduction position from exact event type and ID fields. It never reads `text` or `reason`.

- [ ] **Step 4: Replay merge events in the projector**

Process introductions and mutations in log order. On merge:

```ts
const duplicate = foreshadows[event.duplicateForeshadowId]
assertValidMergeEdge(
  foreshadows[event.canonicalForeshadowId],
  duplicate,
  event,
  aliases,
  introductionOrder
)

const rootId = resolveAliasRoot(aliases, event.canonicalForeshadowId)
const root = foreshadows[rootId]!
aliases.set(event.duplicateForeshadowId, rootId)
duplicate.mergedInto = rootId
if (duplicate.fulfilledIn !== null) {
  root.fulfilledIn =
    root.fulfilledIn === null
      ? duplicate.fulfilledIn
      : Math.min(root.fulfilledIn, duplicate.fulfilledIn)
}
flattenAliasTargets(foreshadows, aliases)
```

For later `foreshadow-fulfill`, resolve the root before updating. For policy/deadline/waive events targeting an alias, leave canonical unchanged. Invalid merge edges throw `ForeshadowMergeValidationError`; never skip them silently.

- [ ] **Step 5: Run focused tests, smoke guard, and typecheck**

Run:

```bash
npx vitest run tests/story-memory/foreshadow-alias.test.ts tests/story-memory/projector.test.ts tests/smoke/no-prose-matching.test.ts
npm run typecheck
```

Expected: all selected tests PASS, including the prose-matching guard.

- [ ] **Step 6: Commit Task 2**

```bash
git add src/story-memory/foreshadow-alias.ts src/story-memory/projector.ts tests/story-memory/foreshadow-alias.test.ts tests/story-memory/projector.test.ts
git commit -m "[Feature] Project canonical foreshadow aliases" -m "Replay validated merge edges, preserve canonical contracts, and resolve alias-addressed fulfillments through centralized exact-ID utilities." -m "issue: #N/A"
```

---

### Task 3: Structured semantic equivalence detector

**Files:**

- Create: `src/graph/services/foreshadow-equivalence/detector.ts`
- Test: `tests/graph/services/foreshadow-equivalence/detector.test.ts`

- [ ] **Step 1: Write detector protocol tests first**

Test valid disjoint groups plus every fail-closed condition:

```ts
await expect(
  detectForeshadowEquivalence({
    provider,
    candidates: [candidate('fs-a'), candidate('fs-b'), candidate('fs-c')],
  })
).resolves.toEqual([
  { ids: ['fs-a', 'fs-b'], reason: 'They establish one unresolved obligation.' },
])

await expect(detectWithOutput({ groups: [{ ids: ['fs-a', 'unknown'], reason: 'x' }] })).rejects.toThrow(
  ForeshadowEquivalenceError
)
await expect(detectWithOutput({ groups: overlappingGroups })).rejects.toThrow(
  ForeshadowEquivalenceError
)
await expect(detectWithProviderFailure()).rejects.toThrow(ForeshadowEquivalenceError)
```

- [ ] **Step 2: Run the detector test and verify RED**

Run:

```bash
npx vitest run tests/graph/services/foreshadow-equivalence/detector.test.ts
```

Expected: FAIL because the module is missing.

- [ ] **Step 3: Implement the detector with exact cardinality checks**

Use the existing structured-provider fallback pattern:

```ts
export interface ForeshadowEquivalenceCandidate {
  id: ForeshadowId
  text: string
  kind: ForeshadowKind | null
  introducedChapter: number
}

export interface ForeshadowEquivalenceGroup {
  ids: ForeshadowId[]
  reason: string
}

export class ForeshadowEquivalenceError extends Error {}

export async function detectForeshadowEquivalence(input: {
  provider: ModelProvider
  candidates: readonly ForeshadowEquivalenceCandidate[]
}): Promise<ForeshadowEquivalenceGroup[]>
```

The system prompt must state that duplicate means “resolving either record resolves the same outstanding narrative question.” It must explicitly reject mere shared entities, motifs, causality, or thematic relation. Parse only `groups[].ids` and structural fields. Do not request or interpret confidence. Wrap provider and protocol failures in `ForeshadowEquivalenceError`.

- [ ] **Step 4: Run detector tests and the no-prose guard**

Run:

```bash
npx vitest run tests/graph/services/foreshadow-equivalence/detector.test.ts tests/smoke/no-prose-matching.test.ts
npm run typecheck
```

Expected: all selected tests PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add src/graph/services/foreshadow-equivalence/detector.ts tests/graph/services/foreshadow-equivalence/detector.test.ts
git commit -m "[Feature] Detect equivalent foreshadows semantically" -m "Use fail-closed structured model output to group duplicate narrative obligations without runtime prose matching." -m "issue: #N/A"
```

---

### Task 4: Reconciliation service and historical preparation gate

**Files:**

- Create: `src/graph/services/foreshadow-equivalence/reconcile.ts`
- Create: `src/utils/story-memory-constraints.ts`
- Modify: `src/graph/state.ts`
- Modify: `src/graph/services/chapter-orchestration/preparation.ts`
- Modify: `src/graph/nodes/chapter-orchestration.ts`
- Modify: `src/graph/services/finalization/chapter.ts`
- Modify: `src/story-memory/foreshadow-policy.ts`
- Test: `tests/graph/services/foreshadow-equivalence/reconcile.test.ts`
- Test: `tests/graph/services/chapter-orchestration/preparation.test.ts`
- Test: `tests/utils/story-memory-constraints.test.ts`
- Test: `tests/story-memory/foreshadow-policy.test.ts`

- [ ] **Step 1: Write failing reconciliation and preparation tests**

Test one historical merge before session creation, audit skip, active-set invalidation, idempotence,
proposed-event batch atomicity, detector failure without partial memory, and invalid merge-edge
failure without partial memory:

```ts
const result = await prepareChapter(stateWithDuplicateForeshadows(), provider)

expect(result.storyMemory?.events).toEqual(
  expect.arrayContaining([
    expect.objectContaining({
      type: 'foreshadow-merge',
      canonicalForeshadowId: 'fs-early',
      duplicateForeshadowId: 'fs-late',
    }),
  ])
)
expect(result.foreshadowEquivalenceAudit).toEqual({
  protocolVersion: 1,
  activeCanonicalIds: ['fs-early'],
})
expect(result.foreshadowStack?.map((item) => item.id)).toEqual(['fs-early'])
expect(
  normalizeVerifiedConstraints(result.verifiedConstraints).filter(
    (item) => item.kind === 'generic' && item.id?.startsWith('memory:foreshadow:')
  )
).toEqual([expect.objectContaining({ id: 'memory:foreshadow:fs-early' })])

await expect(prepareChapter(state, failingProvider)).rejects.toThrow(ForeshadowEquivalenceError)
expect(state.storyMemory?.events).toHaveLength(originalEventCount)
```

Add zero- and one-candidate cases that update the audit without calling the provider; semantic
equivalence is impossible until at least two active canonical candidates exist.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npx vitest run tests/graph/services/foreshadow-equivalence/reconcile.test.ts tests/graph/services/chapter-orchestration/preparation.test.ts
```

Expected: FAIL because the audit state and reconciliation service do not exist and `prepareChapter` has no provider.

- [ ] **Step 3: Implement deterministic reconciliation**

Define the checkpoint-only marker next to `GraphState`, then expose the reconciliation function:

```ts
export interface ForeshadowEquivalenceAudit {
  protocolVersion: 1
  activeCanonicalIds: ForeshadowId[]
}

// GraphState channel:
foreshadowEquivalenceAudit: Annotation<ForeshadowEquivalenceAudit | undefined>

export async function reconcileForeshadowEquivalence(input: {
  provider: ModelProvider
  memory: StoryMemory
  chapterIndex: number
  audit?: ForeshadowEquivalenceAudit
  proposedEvents?: readonly StoryEvent[]
}): Promise<{
  memory: StoryMemory
  audit: ForeshadowEquivalenceAudit
  mergeEvents: ForeshadowMergeEvent[]
}>
```

Apply `proposedEvents` to a local candidate memory first. If those events contain no
`foreshadow-introduce` record and the protocol version plus ordered active canonical ID set match the
audit, return the candidate memory without a provider call. Otherwise build candidates, call the
detector, sort each group by `compareCanonicalOrder`, generate edges from each later ID to the first
ID, validate the full event batch with `applyEvents`, and return only after every edge succeeds. This
keeps non-foreshadow events and introductions in the same all-or-nothing local batch without mutating
the input memory.

Before calling the detector, short-circuit candidate sets of size zero or one by returning the
candidate memory plus a refreshed audit. Do not spend a model call when no duplicate group can
exist.

Rethrow the detector's existing `ForeshadowEquivalenceError`. Wrap
`ForeshadowMergeValidationError` in `ForeshadowEquivalenceError` with the original error as `cause`.
Do not catch unrelated programming errors. Tests must prove that an invalid generated edge leaves
both the input event log and audit unchanged.

- [ ] **Step 4: Wire the historical gate before preparation's same-session shortcut**

Change signatures and node wiring:

```ts
export async function prepareChapter(
  state: ReducedGraphState,
  provider: ModelProvider
): Promise<Partial<ReducedGraphState>> {
  const reconciled = state.storyMemory
    ? await reconcileForeshadowEquivalence({
        provider,
        memory: state.storyMemory,
        chapterIndex: state.currentChapterIndex,
        audit: state.foreshadowEquivalenceAudit,
      })
    : null

  // only after reconciliation decide whether the existing session can be reused
}

export async function prepare_chapter(context: RuntimeContext, state: ReducedGraphState) {
  return prepareChapter(state, context.provider)
}
```

Return reconciled StoryMemory, `projectForeshadowStack(memory)`, the audit marker, refreshed verified
constraints, and the existing session/pending-issue updates atomically. Log each merge and the
before/after canonical count.

Update `projectForeshadowStack` in this task to emit canonical records only; otherwise the historical
gate would repair memory but still pass duplicate stack entries to planning. Extract
`rebuildStoryMemoryVerifiedConstraints` into `src/utils/story-memory-constraints.ts` and use it from
both preparation and finalization. It must replace all regenerable `memory:*` and
`foreshadow-boundary:*` constraints from the reconciled memory/stack while preserving unrelated
constraints.

- [ ] **Step 5: Run focused tests, graph tests, and typecheck**

Run:

```bash
npx vitest run tests/graph/services/foreshadow-equivalence/reconcile.test.ts tests/graph/services/chapter-orchestration/preparation.test.ts tests/utils/story-memory-constraints.test.ts tests/story-memory/foreshadow-policy.test.ts tests/graph/services/finalization/chapter.test.ts tests/graph/novel-graph.test.ts tests/smoke/no-prose-matching.test.ts
npm run typecheck
```

Expected: all selected tests PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add src/graph/services/foreshadow-equivalence/reconcile.ts src/utils/story-memory-constraints.ts src/graph/state.ts src/graph/services/chapter-orchestration/preparation.ts src/graph/nodes/chapter-orchestration.ts src/graph/services/finalization/chapter.ts src/story-memory/foreshadow-policy.ts tests/graph/services/foreshadow-equivalence/reconcile.test.ts tests/graph/services/chapter-orchestration/preparation.test.ts tests/utils/story-memory-constraints.test.ts tests/story-memory/foreshadow-policy.test.ts tests/graph/services/finalization/chapter.test.ts
git commit -m "[Feature] Reconcile historical foreshadow aliases" -m "Scan active canonical IDs before planning, persist deterministic merge events, and cache successful audits in checkpoint state." -m "issue: #N/A"
```

---

### Task 5: Gate new introductions during finalization

**Files:**

- Modify: `src/types/agent.ts`
- Modify: `src/types/chapter-report.ts`
- Modify: `src/graph/services/finalization/chapter.ts`
- Test: `tests/graph/chapter-report.test.ts`
- Test: `tests/graph/services/finalization/chapter.test.ts`

- [ ] **Step 1: Write failing finalization tests**

Add three tests: new-versus-history merge, two-new-ID merge, and provider failure with no returned memory update:

```ts
const result = await finalizeChapter(stateWithNewIntroduction('fs-new'), providerReturningGroup([
  'fs-existing',
  'fs-new',
]))

expect(result.storyMemory?.events).toEqual(
  expect.arrayContaining([
    expect.objectContaining({
      type: 'foreshadow-merge',
      canonicalForeshadowId: 'fs-existing',
      duplicateForeshadowId: 'fs-new',
    }),
  ])
)
expect(getCanonicalForeshadows(result.storyMemory!).map((item) => item.id)).toEqual(['fs-existing'])

const failed = await finalizeChapter(stateWithNewIntroduction('fs-new'), failingProvider)
expect(failed.storyMemory).toBeUndefined()
expect(failed.rewriteRequested).toBe(true)
expect(failed.pendingIssues).toEqual(
  expect.arrayContaining([
    expect.objectContaining({
      type: 'foreshadow_equivalence_failed',
      retryStrategy: 'manual',
    }),
  ])
)
```

Also assert `createEmptyIssueSummary().byType.foreshadow_equivalence_failed === 0` and that
`summarizeIssues` increments it. This protects the exhaustive `Record<IssueType, number>` map.

- [ ] **Step 2: Run the finalization tests and verify RED**

Run:

```bash
npx vitest run tests/graph/services/finalization/chapter.test.ts
```

Expected: the new tests FAIL because introduction events are applied without equivalence reconciliation.

- [ ] **Step 3: Reconcile proposed introductions before returning finalized state**

First add `foreshadow_equivalence_failed` to `IssueType` and the exhaustive empty chapter-report
summary. After evidence/deadline filtering identifies draft introductions, branch on the exact
structured introduction count:

```ts
if (newForeshadowIntroduceEvents.length > 0) {
  const equivalence = await reconcileForeshadowEquivalence({
    provider,
    memory: updatedStoryMemory,
    chapterIndex,
    audit: state.foreshadowEquivalenceAudit,
    proposedEvents: draftEvents,
  })
  updatedStoryMemory = equivalence.memory
  updatedForeshadowEquivalenceAudit = equivalence.audit
} else {
  updatedStoryMemory = applyEvents(updatedStoryMemory, draftEvents)
}
```

The reconciliation service applies draft events followed by merge events exactly once; do not apply
`draftEvents` before or after the call. Non-foreshadow draft events remain in the same atomic local
batch. Add `foreshadow-merge` to finalization's `FORBIDDEN_SUMMARY_FALLBACK_EVENT_TYPES` so the
SummaryAgent cannot create operational merge events.

When reconciliation ran, return `updatedForeshadowEquivalenceAudit` as
`foreshadowEquivalenceAudit` together with the reprojected canonical stack and constraints. This
ensures the next preparation skips a redundant semantic scan. Chapters with no new introduction do
not invoke the detector during finalization; historical coverage belongs to preparation.

Catch only `ForeshadowEquivalenceError` and return a structured blocking issue:

```ts
{
  type: 'foreshadow_equivalence_failed',
  severity: 'error',
  source: 'foreshadowing',
  retryStrategy: 'manual',
  description: `第 ${chapterIndex + 1} 章伏笔等价检测失败：${error.message}`,
}
```

Return `rewriteRequested: true` so `routeAfterFinalize` sends the state directly to
`request_rewrite`; do not return `storyMemory`, `foreshadowStack`, chapter completion, or the audit
marker on failure. Catch only `ForeshadowEquivalenceError`; programming and projection errors must
still surface normally.

- [ ] **Step 4: Run finalization, integration, and type tests**

Run:

```bash
npx vitest run tests/graph/services/finalization/chapter.test.ts tests/graph/chapter-report.test.ts tests/integration/story-memory.e2e.test.ts tests/graph/chapter-writing.integration.test.ts
npm run typecheck
```

Expected: all selected tests PASS.

- [ ] **Step 5: Commit Task 5**

```bash
git add src/types/agent.ts src/types/chapter-report.ts src/graph/services/finalization/chapter.ts tests/graph/chapter-report.test.ts tests/graph/services/finalization/chapter.test.ts
git commit -m "[Feature] Gate new foreshadow introductions" -m "Detect and merge new duplicate IDs before chapter commit, failing atomically when semantic equivalence cannot be verified." -m "issue: #N/A"
```

---

### Task 6: Canonicalize scheduling, planning, and fulfillment verification

**Files:**

- Modify: `src/story-memory/foreshadow-policy.ts`
- Modify: `src/story-memory/foreshadow-deadline-boundary.ts`
- Modify: `src/story-memory/queries.ts`
- Modify: `src/story-memory/validator.ts`
- Modify: `src/story-memory/diff.ts`
- Modify: `src/core/outline-expander.ts`
- Modify: `src/graph/nodes/validation.ts`
- Modify: `src/graph/services/foreshadow-fulfillment/planning-verifier.ts`
- Modify: `src/graph/services/foreshadow-fulfillment/semantic-verifier.ts`
- Test: `tests/story-memory/queries.test.ts`
- Test: `tests/story-memory/foreshadow-deadline-boundary.test.ts`
- Test: `tests/story-memory/validator.test.ts`
- Test: `tests/story-memory/diff.test.ts`
- Test: `tests/core/outline-expander.test.ts`
- Test: `tests/graph/nodes/validation.test.ts`
- Test: `tests/graph/services/foreshadow-fulfillment/planning-verifier.test.ts`
- Test: `tests/graph/services/foreshadow-fulfillment/semantic-verifier.test.ts`

- [ ] **Step 1: Write failing consumer tests**

Construct memory with one canonical and one alias and assert one obligation everywhere:

```ts
expect(getActiveForeshadows(memory)).toEqual(['fs-early'])
expect(getMandatoryForeshadows(memory).map((item) => item.id)).toEqual(['fs-early'])
expect(getBoundaryBlockingForeshadows(memory, 10, true)).toEqual(['fs-early'])

const expanded = await expandOutlineForChapter(
  stateWhoseOutlineClaims(['fs-early', 'fs-late']),
  chapterIndex,
  provider
)
expect(expanded.outline?.[chapterIndex]?.fulfilledForeshadowIds).toEqual(['fs-early'])
expect(expanded.chapterPlan.fulfilledForeshadowIds).toEqual(['fs-early'])
expect(fulfillmentEvents(expanded.chapterPlan)).toHaveLength(1)
```

For semantic verification, send a fulfillment event using `fs-late` and assert the model candidate ID and planted text are canonical `fs-early` exactly once.

- [ ] **Step 2: Run consumer tests and verify RED**

Run:

```bash
npx vitest run tests/story-memory/queries.test.ts tests/story-memory/foreshadow-deadline-boundary.test.ts tests/story-memory/validator.test.ts tests/story-memory/diff.test.ts tests/core/outline-expander.test.ts tests/graph/nodes/validation.test.ts tests/graph/services/foreshadow-fulfillment/planning-verifier.test.ts tests/graph/services/foreshadow-fulfillment/semantic-verifier.test.ts
```

Expected: new tests FAIL because consumers iterate `Object.values(memory.foreshadows)` or compare raw IDs.

- [ ] **Step 3: Replace direct foreshadow iteration with canonical utilities**

Use `getCanonicalForeshadows(memory)` in all remaining policy/query/boundary loops. Preserve existing
sort and deadline behavior after filtering aliases; stack projection was already canonicalized in
Task 4 because preparation depends on it.

Use the same canonical query in the continuity context assembled by `src/graph/nodes/validation.ts`
so validation prompts do not reintroduce duplicate obligations. Make `diffMemorySnapshots` report
new and fulfilled foreshadows by canonical ID only; a new duplicate merged into history is not a new
obligation, while two new equivalent IDs produce one canonical addition.

At outline expansion entry, normalize exact structured fields:

```ts
function canonicalizeChapterForeshadowClaims(
  memory: StoryMemory,
  outline: ChapterOutline,
  plan: ChapterPlan | null
): { outline: ChapterOutline; plan: ChapterPlan | null } {
  const fulfilled = canonicalizeForeshadowIds(memory, outline.fulfilledForeshadowIds ?? [])
  const deferred = canonicalizeForeshadowIds(memory, outline.deferredForeshadowIds ?? [])
  // canonicalize plan IDs and foreshadow-fulfill expected events by exact ID,
  // retaining the first event for each canonical root.
}
```

Do not combine conflicting evidence or event bodies. If two distinct events map to one root but disagree structurally, surface the existing plan-compliance error.

- [ ] **Step 4: Canonicalize pre-draft and post-draft verification candidates**

Both verifiers must resolve raw IDs first:

```ts
const canonicalId = resolveCanonicalForeshadowId(input.memory, rawId)
if (!canonicalId) return verificationFailure(rawId, ...)
const planted = input.memory.foreshadows[canonicalId]!
```

Deduplicate model candidates by canonical ID. Map a rejection back to the canonical ID so routing and replanning operate on one obligation. Preserve the evidence paragraph from the first structurally valid alias event.

- [ ] **Step 5: Run all focused tests, smoke guard, and typecheck**

Run:

```bash
npx vitest run tests/story-memory/queries.test.ts tests/story-memory/foreshadow-deadline-boundary.test.ts tests/story-memory/validator.test.ts tests/story-memory/diff.test.ts tests/core/outline-expander.test.ts tests/graph/nodes/validation.test.ts tests/graph/services/foreshadow-fulfillment/planning-verifier.test.ts tests/graph/services/foreshadow-fulfillment/semantic-verifier.test.ts tests/smoke/no-prose-matching.test.ts
npm run typecheck
```

Expected: all selected tests PASS and no prose-matching guard changes are required unless a legitimate new runtime file must be added to its scan list.

- [ ] **Step 6: Commit Task 6**

```bash
git add src/story-memory/foreshadow-policy.ts src/story-memory/foreshadow-deadline-boundary.ts src/story-memory/queries.ts src/story-memory/validator.ts src/story-memory/diff.ts src/core/outline-expander.ts src/graph/nodes/validation.ts src/graph/services/foreshadow-fulfillment/planning-verifier.ts src/graph/services/foreshadow-fulfillment/semantic-verifier.ts tests/story-memory/queries.test.ts tests/story-memory/foreshadow-deadline-boundary.test.ts tests/story-memory/validator.test.ts tests/story-memory/diff.test.ts tests/core/outline-expander.test.ts tests/graph/nodes/validation.test.ts tests/graph/services/foreshadow-fulfillment/planning-verifier.test.ts tests/graph/services/foreshadow-fulfillment/semantic-verifier.test.ts
git commit -m "[BugFix] Count canonical foreshadow obligations once" -m "Normalize aliases across scheduling, planning, validation, and fulfillment verification using exact structured IDs." -m "issue: #N/A"
```

---

### Task 7: CLI mutations, derived constraints, and observability

**Files:**

- Modify: `src/cli/commands/waive-foreshadow.ts`
- Modify: `src/cli/commands/set-foreshadow-policy.ts`
- Modify: `src/cli/commands/info.ts`
- Modify: `src/cli/formatters/foreshadow-boundary-pressure.ts`
- Modify: `src/cli/formatters/status-formatter.ts`
- Modify: `src/graph/services/finalization/chapter.ts`
- Modify: `src/utils/foreshadow-constraints.ts`
- Modify: `src/utils/story-memory-constraints.ts`
- Test: `tests/cli/waive-foreshadow.test.ts`
- Test: `tests/cli/set-foreshadow-policy.test.ts`
- Test: `tests/cli/info.test.ts`
- Test: `tests/cli/foreshadow-boundary-pressure.test.ts`
- Test: `tests/cli/status.test.ts`
- Test: `tests/utils/foreshadow-constraints.test.ts`
- Test: `tests/utils/story-memory-constraints.test.ts`
- Test: `tests/graph/services/finalization/chapter.test.ts`

- [ ] **Step 1: Write failing CLI and derived-state tests**

Assert alias mutations are rejected with canonical guidance and display counts one root:

```ts
await waiveForeshadow('story-1', { foreshadow: 'fs-late' })
expect(consoleError).toHaveBeenCalledWith(
  '[MuseFlow] 错误: 伏笔 fs-late 已归并到 fs-early；请使用 canonical ID 操作'
)

expect(formatActForeshadowBoundaryPressure(state, act)).toEqual([
  '伏笔边界压力: 1 个 must_resolve 硬义务待回收',
  '必须回收伏笔:',
  expect.stringContaining('fs-early'),
])
expect(generateForeshadowConstraints(projectForeshadowStack(memory), 4)).toHaveLength(1)
```

- [ ] **Step 2: Run CLI/constraint tests and verify RED**

Run:

```bash
npx vitest run tests/cli/waive-foreshadow.test.ts tests/cli/set-foreshadow-policy.test.ts tests/cli/info.test.ts tests/cli/foreshadow-boundary-pressure.test.ts tests/cli/status.test.ts tests/utils/foreshadow-constraints.test.ts tests/graph/services/finalization/chapter.test.ts
```

Expected: alias command tests FAIL and duplicate derived constraints remain.

- [ ] **Step 3: Add explicit alias command behavior and canonical derived state**

Resolve the requested structured ID through the centralized utility before existing fulfilled/waived
checks:

```ts
const canonicalId = resolveCanonicalForeshadowId(memory, foreshadowId)
if (canonicalId === null) {
  fail(`未找到伏笔 ${foreshadowId}`)
  return
}
if (canonicalId !== foreshadowId) {
  fail(`伏笔 ${foreshadowId} 已归并到 ${canonicalId}；请使用 canonical ID 操作`)
  return
}
const foreshadow = memory.foreshadows[canonicalId]!
```

Use canonical stack/query functions for constraints, reports, `status`, and `info`. Both active and
fulfilled CLI counts must exclude aliases. During historical or new merges, log each exact edge and
one before/after count; do not parse the model reason to choose control flow.

Reuse `rebuildStoryMemoryVerifiedConstraints` from Task 4 for both preparation and finalization; do
not introduce a second rebuild path. Ensure chapter reports derive planted/fulfilled/overdue counts
from canonical records as well.

- [ ] **Step 4: Run CLI/derived-state tests and static checks**

Run:

```bash
npx vitest run tests/cli/waive-foreshadow.test.ts tests/cli/set-foreshadow-policy.test.ts tests/cli/info.test.ts tests/cli/foreshadow-boundary-pressure.test.ts tests/cli/status.test.ts tests/utils/foreshadow-constraints.test.ts tests/utils/story-memory-constraints.test.ts tests/graph/services/finalization/chapter.test.ts tests/smoke/no-prose-matching.test.ts
npm run typecheck
npm run lint
```

Expected: all selected tests and static checks PASS.

- [ ] **Step 5: Commit Task 7**

```bash
git add src/cli/commands/waive-foreshadow.ts src/cli/commands/set-foreshadow-policy.ts src/cli/commands/info.ts src/cli/formatters/foreshadow-boundary-pressure.ts src/cli/formatters/status-formatter.ts src/graph/services/finalization/chapter.ts src/utils/foreshadow-constraints.ts src/utils/story-memory-constraints.ts tests/cli/waive-foreshadow.test.ts tests/cli/set-foreshadow-policy.test.ts tests/cli/info.test.ts tests/cli/foreshadow-boundary-pressure.test.ts tests/cli/status.test.ts tests/utils/foreshadow-constraints.test.ts tests/utils/story-memory-constraints.test.ts tests/graph/services/finalization/chapter.test.ts
git commit -m "[BugFix] Expose canonical foreshadow aliases safely" -m "Reject ambiguous alias mutations and rebuild status, constraints, and reports from canonical obligations only." -m "issue: #N/A"
```

---

### Task 8: End-to-end regression and full verification

**Files:**

- Modify: `tests/integration/story-memory.e2e.test.ts`
- Modify: `tests/smoke/project-smoke.test.ts` only if the v3 invariant belongs in the existing project guard
- Modify: `tests/smoke/no-prose-matching.test.ts` only to include new runtime files in its scan set, never to weaken forbidden patterns

- [ ] **Step 1: Write an integration regression for historical duplicate obligations**

Create a neutral story memory with two different IDs, two introduce events, and a provider that returns one duplicate group. Run preparation followed by planning-visible queries:

```ts
const prepared = await prepareChapter(stateWithTwoEquivalentActiveIds(), provider)
const memory = prepared.storyMemory!

expect(getCanonicalForeshadows(memory).map((item) => item.id)).toEqual(['fs-first'])
expect(memory.foreshadows['fs-second']?.mergedInto).toBe('fs-first')
expect(getBoundaryBlockingForeshadows(memory, state.totalChapters, true)).toEqual(['fs-first'])
expect(memory.events.filter((event) => event.type === 'foreshadow-merge')).toHaveLength(1)

const repeated = await prepareChapter({ ...state, ...prepared }, provider)
expect(provider.chatStructured).toHaveBeenCalledTimes(1)
expect(repeated.storyMemory?.events.filter((event) => event.type === 'foreshadow-merge')).toHaveLength(1)
```

- [ ] **Step 2: Run the integration test and verify its initial result**

Run:

```bash
npx vitest run tests/integration/story-memory.e2e.test.ts
```

Expected: PASS if Tasks 1–7 are complete. If it fails, fix the production integration point exposed by the test; do not relax assertions or add story-text matching.

- [ ] **Step 3: Run the complete targeted regression matrix**

Run:

```bash
npx vitest run tests/types/story-memory.test.ts tests/story-memory/resolution-policy.test.ts tests/story-memory/event-contract.test.ts tests/story-memory/parser.test.ts tests/story-memory/event-format.test.ts tests/story-memory/diff.test.ts tests/story-memory/foreshadow-alias.test.ts tests/story-memory/projector.test.ts tests/story-memory/foreshadow-policy.test.ts tests/story-memory/queries.test.ts tests/story-memory/validator.test.ts tests/story-memory/foreshadow-deadline-boundary.test.ts tests/graph/services/foreshadow-equivalence/detector.test.ts tests/graph/services/foreshadow-equivalence/reconcile.test.ts tests/graph/services/chapter-orchestration/preparation.test.ts tests/graph/nodes/validation.test.ts tests/graph/services/finalization/chapter.test.ts tests/graph/chapter-report.test.ts tests/core/outline-expander.test.ts tests/graph/services/foreshadow-fulfillment/planning-verifier.test.ts tests/graph/services/foreshadow-fulfillment/semantic-verifier.test.ts tests/cli/waive-foreshadow.test.ts tests/cli/set-foreshadow-policy.test.ts tests/cli/info.test.ts tests/cli/foreshadow-boundary-pressure.test.ts tests/cli/status.test.ts tests/utils/foreshadow-constraints.test.ts tests/utils/story-memory-constraints.test.ts tests/integration/story-memory.e2e.test.ts tests/smoke/no-prose-matching.test.ts tests/smoke/project-smoke.test.ts
```

Expected: every selected file and test PASS.

- [ ] **Step 4: Run all repository quality gates**

Run each command from the worktree root:

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
```

Expected:

- TypeScript exits 0.
- ESLint exits 0.
- Prettier reports all files matched.
- The full Vitest suite exits 0 with no failed files or tests.

If formatting fails, run Prettier only on reported files, then repeat the targeted matrix and all four quality gates.

- [ ] **Step 5: Audit repository integrity**

Run:

```bash
git status --short
git diff --check
git diff --name-status develop...HEAD
rg -n "Object\.values\([^)]*foreshadows|Object\.entries\([^)]*foreshadows" src
```

Expected: only the Task 8 integration/smoke test files are uncommitted before their final commit, no
whitespace errors, and no paths under `books/`. Review every remaining direct foreshadow-map
iteration: it may exist only inside migration, projection, or the centralized canonical alias
module—not in scheduling, validation, prompts, reports, or CLI consumers.

- [ ] **Step 6: Commit the integration regression if it changed tracked files**

```bash
git add tests/integration/story-memory.e2e.test.ts tests/smoke/project-smoke.test.ts tests/smoke/no-prose-matching.test.ts
git commit -m "[Test] Cover semantic foreshadow alias merging" -m "Verify historical repair, canonical boundary counts, idempotent audit caching, and no-prose runtime invariants end to end." -m "issue: #N/A"
```

If ignored/generated output changed, do not edit or delete runtime story data manually. Identify the
test or command that produced it, keep it outside the branch diff, and report it during handoff.

---

## Completion Criteria

- StoryMemory v3 replays `foreshadow-merge` deterministically and preserves alias provenance.
- Historical duplicates merge before planning; new duplicates merge before final chapter commit.
- Provider/protocol/merge-validation failures abort atomically.
- Earliest introduction remains authoritative and later duplicate policies cannot strengthen it.
- Alias fulfillment reaches canonical planted text and is verified once.
- Scheduling, boundary pressure, planning, constraints, reports, and CLI count only canonical roots.
- Unchanged active canonical sets skip repeated semantic scans.
- No runtime prose matching is introduced.
- Targeted tests, typecheck, lint, formatting, and the complete suite pass.
- No file under `books/` is modified directly or included in the branch diff.
