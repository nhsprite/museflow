# Foreshadow Deferred Capacity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recompute future act capacity after structured foreshadow adjudication so deferred due foreshadows receive chapter slots before drafting while finalize remains strict.

**Architecture:** Add a pure post-adjudication capacity proposal to `story-arc.ts`, using the existing structured scheduling policy and fixed-point sizing. Apply the proposal from `outline-expander.ts` after outline adjudication and again after planner fallback changes fulfillment claims into deferrals; reuse the existing bounded act-adjustment path and scaffold synchronization.

**Tech Stack:** TypeScript, Node.js 20+, Vitest, LangGraph state objects.

---

### Task 1: Specify post-adjudication capacity sizing

**Files:**
- Modify: `tests/utils/story-arc.test.ts`
- Modify: `src/utils/story-arc.ts`

- [ ] **Step 1: Write failing pure-policy tests**

Add tests importing `proposeActExtensionAfterForeshadowAdjudication` and assert:

```ts
const proposal = proposeActExtensionAfterForeshadowAdjudication(
  storyArc,
  4,
  memoryWithDueForeshadows(3),
  3,
  []
)
expect(proposal?.proposedEndChapter).toBe(6)
```

Cover exclusion of current-chapter planned fulfillment IDs and fixed-point inclusion of a deadline crossed by the proposed extension.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- tests/utils/story-arc.test.ts`

Expected: FAIL because `proposeActExtensionAfterForeshadowAdjudication` is not exported.

- [ ] **Step 3: Implement the minimal structured sizing function**

In `src/utils/story-arc.ts`, add an exported pure function with this signature:

```ts
export function proposeActExtensionAfterForeshadowAdjudication(
  storyArc: StoryArc,
  currentChapterIndex: number,
  memory: StoryMemory,
  capacity: number,
  plannedFulfillmentIds: readonly string[]
): ActBoundaryProposal | undefined
```

Use `getRequiredForeshadowsForScheduling`, exclude `plannedFulfillmentIds` by exact ID, count only chapters after the current chapter as future slots, and iterate candidate end chapters to a fixed point. Return `undefined` when the existing boundary has enough capacity.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm test -- tests/utils/story-arc.test.ts`

Expected: all story-arc tests pass.

### Task 2: Apply the proposal around outline and planner adjudication

**Files:**
- Modify: `tests/core/outline-expander.test.ts`
- Modify: `src/core/outline-expander.ts`

- [ ] **Step 1: Write failing integration tests**

Add one test where chapter 3 is the end of act 1, three due required foreshadows are returned in
`deferredForeshadowIds`, and assert the result shifts act 1 end to chapter 4 before
`plan_chapter_with_override` receives its state. Add a second test where the outline claims fulfillment but two
planner attempts omit `foreshadow-fulfill` evidence; assert the automatic deferral also shifts the boundary and
the returned boundary hint no longer announces entry into the next act.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- tests/core/outline-expander.test.ts`

Expected: FAIL because the act remains at its pre-adjudication boundary.

- [ ] **Step 3: Implement reusable state synchronization**

In `src/core/outline-expander.ts`, extract the existing story-arc/scaffold synchronization into a focused helper.
Add a helper that calls `proposeActExtensionAfterForeshadowAdjudication`, applies the proposal through
`applyActBoundaryAdjustment`, logs the result, throws the existing manual `adjust-act` guidance when limits bind,
and returns the synchronized state.

- [ ] **Step 4: Invoke capacity coordination at both adjudication points**

Call the helper after the final outline item is available and before planner boundary context is built. Call it
again if planner correction converts fulfillment IDs to deferrals. Ensure `nextItem`, act boundary detection, and
returned `boundaryHints` are calculated from the final updated state.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run: `npm test -- tests/core/outline-expander.test.ts tests/utils/story-arc.test.ts`

Expected: both suites pass, including the new regression cases.

### Task 3: Verify repository invariants

**Files:**
- Verify only.

- [ ] **Step 1: Run type checking**

Run: `npm run typecheck`

Expected: exit 0 with no TypeScript errors.

- [ ] **Step 2: Run all tests**

Run: `npm test`

Expected: all test files and tests pass.

- [ ] **Step 3: Run build and policy smoke test**

Run: `npm run build && npm test -- tests/smoke/no-prose-matching.test.ts && git diff --check`

Expected: build exits 0, policy smoke tests pass, and `git diff --check` reports no whitespace errors.
