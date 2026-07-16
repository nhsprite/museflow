# Foreshadow Final-Chapter Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Distribute hard foreshadow obligations before the last chapter, make outline correction cumulative, and add backward-compatible structured resolution intent.

**Architecture:** Keep hard act-capacity calculations unchanged, but derive a configurable lower target capacity for per-chapter mandatory shares. Carry the latest outline candidate and complete mandatory ID set through bounded retries. Extend foreshadow events and projections with optional semantic fields so legacy checkpoints replay unchanged while new clues provide stronger planning evidence.

**Tech Stack:** TypeScript 5, Node.js 20, Vitest, StoryMemory event projection, LangGraph chapter planning.

---

## File Map

- `src/types/genre.ts`: additive chapter-planning headroom configuration.
- `src/utils/chapter-planning.ts`: default and normalized planning configuration.
- `src/story-memory/foreshadow-policy.ts`: pure target-capacity and minimum-share calculation.
- `src/core/outline-expander.ts`: apply minimum mandatory share and cumulative retry feedback.
- `src/agents/types.ts`: additive planning-obligation and rejection fields.
- `src/agents/prompts/fragments/foreshadow-planning.ts`: render resolution intent and cumulative correction context.
- `src/types/story-memory.ts`: optional event and projected-memory resolution fields.
- `src/story-memory/event-contract.ts`: validate optional resolution fields.
- `src/story-memory/projector.ts`: project optional fields.
- `src/story-memory/parser.ts`, `src/story-memory/event-format.ts`, `src/story-memory/diff.ts`: preserve optional fields through text/event utilities.
- `src/agents/prompts/fragments/story-events.ts`, `src/agents/prompts/chapter-planner-prompt.ts`, `src/agents/prompts/chapter-prompt.ts`, `src/agents/prompts/summary-prompt.ts`: request the new fields from generation agents.
- `src/graph/services/foreshadow-fulfillment/planning-verifier.ts`: include resolution intent in pre-draft semantic review.
- `src/graph/services/foreshadow-fulfillment/semantic-verifier.ts`: include the same intent in post-draft defense-in-depth review.
- Mirrored Vitest files under `tests/` provide red-green coverage.

### Task 1: Headroom-aware minimum-share scheduling

**Files:**
- Modify: `src/types/genre.ts`
- Modify: `src/utils/chapter-planning.ts`
- Modify: `src/story-memory/foreshadow-policy.ts`
- Modify: `src/core/outline-expander.ts`
- Test: `tests/story-memory/foreshadow-policy.test.ts`
- Test: `tests/core/outline-expander.test.ts`

- [ ] **Step 1: Write failing pure-policy tests**

Add tests that express the required numeric behavior:

```ts
expect(normalizeForeshadowHeadroom(3, 1)).toBe(1)
expect(normalizeForeshadowHeadroom(1, 1)).toBe(0)
expect(calculateMinimumForeshadowsToFulfillNow({
  pendingBlockingCount: 3,
  remainingChapters: 2,
  hardCapacity: 3,
  headroomPerChapter: 1,
})).toBe(1)
expect(calculateMinimumForeshadowsToFulfillNow({
  pendingBlockingCount: 3,
  remainingChapters: 1,
  hardCapacity: 3,
  headroomPerChapter: 1,
})).toBe(3)
```

- [ ] **Step 2: Run the pure-policy tests and verify RED**

Run:

```bash
npx vitest run tests/story-memory/foreshadow-policy.test.ts
```

Expected: FAIL because the two new exports do not exist.

- [ ] **Step 3: Implement minimal pure helpers and configuration**

Add the optional configuration key and default:

```ts
foreshadowFulfillmentHeadroomPerChapter: number
```

```ts
foreshadowFulfillmentHeadroomPerChapter: 1,
```

Add pure helpers:

```ts
export function normalizeForeshadowHeadroom(hardCapacity: number, value: number): number {
  const capacity = normalizeForeshadowCapacity(hardCapacity)
  if (capacity <= 1) return 0
  if (!Number.isFinite(value)) return 0
  return Math.min(capacity - 1, Math.max(0, Math.floor(value)))
}

export function calculateMinimumForeshadowsToFulfillNow(input: {
  pendingBlockingCount: number
  remainingChapters: number
  hardCapacity: number
  headroomPerChapter: number
}): number {
  const hardCapacity = normalizeForeshadowCapacity(input.hardCapacity)
  const headroom = normalizeForeshadowHeadroom(hardCapacity, input.headroomPerChapter)
  const targetCapacity = Math.max(1, hardCapacity - headroom)
  const futureChapters = Math.max(0, Math.floor(input.remainingChapters) - 1)
  return Math.min(
    hardCapacity,
    Math.max(0, Math.floor(input.pendingBlockingCount) - futureChapters * targetCapacity)
  )
}
```

- [ ] **Step 4: Verify pure-policy GREEN**

Run the same focused test and expect PASS.

- [ ] **Step 5: Write a failing outline-expander regression**

Create a state with three blocking IDs, chapter 2 of a two-chapter remainder, maximum three, and
default headroom one. Assert only the first deterministic ID has
`mustFulfillThisChapter: true`; the other two remain advisory. Assert no act extension occurs.

- [ ] **Step 6: Run the outline-expander regression and verify RED**

Run:

```bash
npx vitest run tests/core/outline-expander.test.ts -t "reserves final-chapter foreshadow headroom"
```

Expected: FAIL because current code marks zero IDs mandatory when three exactly fit the final
chapter.

- [ ] **Step 7: Apply the minimum share in `computeForeshadowConstraintContext`**

Replace the all-or-none tight branch with the pure count and deterministic prefix:

```ts
const minimumRequiredNow = calculateMinimumForeshadowsToFulfillNow({
  pendingBlockingCount,
  remainingChapters,
  hardCapacity: capacity,
  headroomPerChapter: planningConfig.foreshadowFulfillmentHeadroomPerChapter,
})
const blockingIds = new Set(blockingForeshadows.map((foreshadow) => foreshadow.id))
const mustFulfillIds = scheduledIds
  .filter((id) => blockingIds.has(id))
  .slice(0, minimumRequiredNow)
```

Keep existing act-extension functions on hard capacity.

- [ ] **Step 8: Run focused scheduling tests and expect PASS**

```bash
npx vitest run tests/story-memory/foreshadow-policy.test.ts tests/core/outline-expander.test.ts
```

- [ ] **Step 9: Commit Task 1**

```bash
git add src/types/genre.ts src/utils/chapter-planning.ts src/story-memory/foreshadow-policy.ts src/core/outline-expander.ts tests/story-memory/foreshadow-policy.test.ts tests/core/outline-expander.test.ts
git commit -m "[BugFix] Distribute final foreshadow obligations" -m "Reserve planning headroom and require only the minimum deterministic share before the final chapter." -m "issue: #0"
```

### Task 2: Cumulative, non-regressing outline correction

**Files:**
- Modify: `src/agents/types.ts`
- Modify: `src/agents/prompts/fragments/foreshadow-planning.ts`
- Modify: `src/core/outline-expander.ts`
- Test: `tests/agents/chapter-outline.test.ts`
- Test: `tests/core/outline-expander.test.ts`

- [ ] **Step 1: Write failing retry-context tests**

Model two candidates: the first declares B/C and omits A; the second declares A and drops B/C.
Assert the second call receives:

```ts
expect(rejection).toMatchObject({
  requiredFulfillmentIds: ['fs-a', 'fs-b', 'fs-c'],
  preservedFulfillmentIds: ['fs-b', 'fs-c'],
  currentOutline: { title: 'first revision', description: expect.any(String) },
})
```

Assert the terminal error contains `伏笔大纲修订未收敛`, all required IDs, and the final regressed
IDs, and does not contain `请调整幕边界`.

- [ ] **Step 2: Run the retry regression and verify RED**

```bash
npx vitest run tests/core/outline-expander.test.ts -t "reports non-regressing mandatory revision"
```

Expected: FAIL because current feedback lacks the complete required set/latest candidate and uses
the generic boundary message.

- [ ] **Step 3: Add typed cumulative rejection fields**

Extend the existing interface additively:

```ts
requiredFulfillmentIds?: ForeshadowId[]
preservedFulfillmentIds?: ForeshadowId[]
regressedFulfillmentIds?: ForeshadowId[]
```

Render the three lists as exact IDs and state that every required ID must remain fulfilled while
the latest `currentOutline` is revised.

- [ ] **Step 4: Carry the latest candidate through JIT retries**

Before `continue`, derive preserved and regressed IDs from typed ID sets, update
`currentOutline` to `normalizedCandidate`, keep the complete mandatory set, and merge cumulative
regressions. Do not merge IDs into the candidate itself.

- [ ] **Step 5: Replace the misleading terminal error**

When the batch fits hard capacity but bounded JIT correction fails, throw:

```ts
throw new Error(
  `第 ${chapterIndex + 1} 章伏笔大纲修订未收敛：必须回收 ${requiredIds.join(', ')}；` +
    `最终未裁决或错误顺延 ${failureIds.join(', ')}；` +
    `修订中回退 ${regressedIds.join(', ') || '无'}。`
)
```

Capacity-adjustment failures retain their existing command guidance.

- [ ] **Step 6: Add prompt rendering coverage**

Assert the outline prompt contains `requiredFulfillmentIds`, `preservedFulfillmentIds`, the latest
outline description, and a no-regression instruction.

- [ ] **Step 7: Run focused tests and expect PASS**

```bash
npx vitest run tests/agents/chapter-outline.test.ts tests/core/outline-expander.test.ts
```

- [ ] **Step 8: Commit Task 2**

```bash
git add src/agents/types.ts src/agents/prompts/fragments/foreshadow-planning.ts src/core/outline-expander.ts tests/agents/chapter-outline.test.ts tests/core/outline-expander.test.ts
git commit -m "[BugFix] Preserve foreshadow revision progress" -m "Carry the complete mandatory set and latest outline through retries, and report structural non-convergence accurately." -m "issue: #0"
```

### Task 3: Backward-compatible structured resolution intent

**Files:**
- Modify: `src/types/story-memory.ts`
- Modify: `src/agents/types.ts`
- Modify: `src/story-memory/event-contract.ts`
- Modify: `src/story-memory/projector.ts`
- Modify: `src/story-memory/parser.ts`
- Modify: `src/story-memory/event-format.ts`
- Modify: `src/story-memory/diff.ts`
- Modify: `src/agents/prompts/fragments/story-events.ts`
- Modify: `src/agents/prompts/chapter-planner-prompt.ts`
- Modify: `src/agents/prompts/chapter-prompt.ts`
- Modify: `src/agents/prompts/summary-prompt.ts`
- Modify: `src/core/outline-expander.ts`
- Modify: `src/agents/prompts/fragments/foreshadow-planning.ts`
- Modify: `src/graph/services/foreshadow-fulfillment/planning-verifier.ts`
- Modify: `src/graph/services/foreshadow-fulfillment/semantic-verifier.ts`
- Test: `tests/story-memory/event-contract.test.ts`
- Test: `tests/story-memory/projector.test.ts`
- Test: `tests/story-memory/parser.test.ts`
- Test: `tests/story-memory/event-format.test.ts`
- Test: `tests/story-memory/diff.test.ts`
- Test: `tests/agents/chapter-planner.test.ts`
- Test: `tests/agents/chapter.test.ts`
- Test: `tests/agents/summary.test.ts`
- Test: `tests/agents/chapter-outline.test.ts`
- Test: `tests/graph/services/foreshadow-fulfillment/planning-verifier.test.ts`
- Test: `tests/graph/services/foreshadow-fulfillment/semantic-verifier.test.ts`

- [ ] **Step 1: Write failing event-contract and projection tests**

Use an introduction event with:

```ts
resolutionQuestion: '哪个既有事实仍未得到解释？',
fulfillmentCriteria: '通过可验证事件揭示该事实的原因或责任主体。',
```

Assert strict validation accepts both non-empty fields, rejects a present blank field, projection
preserves them, and a legacy event with neither field remains valid and projects without them.

- [ ] **Step 2: Run event tests and verify RED**

```bash
npx vitest run tests/story-memory/event-contract.test.ts tests/story-memory/projector.test.ts
```

Expected: FAIL because the event and memory types/projection do not expose the fields.

- [ ] **Step 3: Add optional fields and structural validation**

Add to both introduction event and projected memory:

```ts
resolutionQuestion?: string
fulfillmentCriteria?: string
```

Validate each only when present:

```ts
if (hasOwn(value, 'resolutionQuestion') && !isNonEmptyString(value.resolutionQuestion)) {
  return invalid('foreshadow-introduce.resolutionQuestion must be a non-empty string when present')
}
```

Apply the same rule to `fulfillmentCriteria`. Copy fields in the introduction projection without
changing StoryMemory version.

- [ ] **Step 4: Preserve fields through parser, formatter, and diff**

Render and parse machine-readable slash fields named `question` and `criteria`; include both in
foreshadow-introduce equality. Add round-trip tests and legacy-line tests.

- [ ] **Step 5: Run StoryMemory focused tests and expect PASS**

```bash
npx vitest run tests/story-memory/event-contract.test.ts tests/story-memory/projector.test.ts tests/story-memory/parser.test.ts tests/story-memory/event-format.test.ts tests/story-memory/diff.test.ts
```

- [ ] **Step 6: Write failing prompt and verifier tests**

Assert generation prompts request `resolutionQuestion` and `fulfillmentCriteria`. Assert planning
obligations render both as inert context. Capture verifier structured input and assert both fields
are included for a new clue and safely absent for a legacy clue.

- [ ] **Step 7: Run prompt/verifier tests and verify RED**

```bash
npx vitest run tests/agents/chapter-planner.test.ts tests/agents/chapter.test.ts tests/agents/summary.test.ts tests/agents/chapter-outline.test.ts tests/graph/services/foreshadow-fulfillment/planning-verifier.test.ts tests/graph/services/foreshadow-fulfillment/semantic-verifier.test.ts
```

- [ ] **Step 8: Thread resolution intent into planning and verification**

Add optional fields to `ForeshadowPlanningObligation`, populate them from canonical StoryMemory,
render them in the shared prompt fragment, and add them to verifier candidates:

```ts
resolutionQuestion: planted.resolutionQuestion,
fulfillmentCriteria: planted.fulfillmentCriteria,
```

Update story-event prompt contracts to request the fields for new `must_resolve` events while
explicitly allowing legacy input to omit them.

- [ ] **Step 9: Run focused prompt/verifier tests and expect PASS**

Run the command from Step 7 and expect all selected suites to pass.

- [ ] **Step 10: Commit Task 3**

```bash
git add src/types/story-memory.ts src/agents/types.ts src/story-memory/event-contract.ts src/story-memory/projector.ts src/story-memory/parser.ts src/story-memory/event-format.ts src/story-memory/diff.ts src/agents/prompts/fragments/story-events.ts src/agents/prompts/chapter-planner-prompt.ts src/agents/prompts/chapter-prompt.ts src/agents/prompts/summary-prompt.ts src/core/outline-expander.ts src/agents/prompts/fragments/foreshadow-planning.ts src/graph/services/foreshadow-fulfillment/planning-verifier.ts src/graph/services/foreshadow-fulfillment/semantic-verifier.ts tests/story-memory/event-contract.test.ts tests/story-memory/projector.test.ts tests/story-memory/parser.test.ts tests/story-memory/event-format.test.ts tests/story-memory/diff.test.ts tests/agents/chapter-planner.test.ts tests/agents/chapter.test.ts tests/agents/summary.test.ts tests/agents/chapter-outline.test.ts tests/graph/services/foreshadow-fulfillment/planning-verifier.test.ts tests/graph/services/foreshadow-fulfillment/semantic-verifier.test.ts
git commit -m "[Feature] Add foreshadow resolution intent" -m "Persist optional resolution questions and fulfillment criteria while preserving legacy checkpoint compatibility." -m "issue: #0"
```

### Task 4: Full verification

**Files:**
- Test: `tests/smoke/no-prose-matching.test.ts`
- Verify all modified source and test files.

- [ ] **Step 1: Run type checking**

```bash
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 2: Run lint and formatting checks**

```bash
npm run lint
npm run format:check
```

Expected: both exit 0.

- [ ] **Step 3: Run the semantic control-flow smoke guard**

```bash
npx vitest run tests/smoke/no-prose-matching.test.ts
```

Expected: PASS with no newly forbidden prose matching.

- [ ] **Step 4: Run the complete test suite**

```bash
npm test
```

Expected: every suite passes with zero failed tests.

- [ ] **Step 5: Build distributable output**

```bash
npm run build
```

Expected: exit 0 and compiled `dist/` output.

- [ ] **Step 6: Inspect final diff and status**

```bash
git diff HEAD~3 --check
git status --short
```

Expected: no whitespace errors and a clean worktree after commits.
