# Chapter Plan Event Index Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every chapter planner expected event use the authoritative zero-based current chapter index, while explicitly giving the model that same index.

**Architecture:** Keep semantic event extraction in `ChapterPlannerAgent`, but establish the graph planning boundary as the owner of mechanical chapter indexing. `runPlanChapter` normalizes all parsed current-chapter events; the prompt renders the exact internal index to improve model output without relying on it for correctness.

**Tech Stack:** TypeScript, Vitest, LangGraph state nodes, ESM/NodeNext

---

## File Structure

- Modify `src/graph/nodes/planning.ts`: normalize plan-level and event-level indexes.
- Create `tests/graph/nodes/planning.test.ts`: cover a one-based model event for chapter 26.
- Modify `src/agents/prompts/chapter-planner-prompt.ts`: render the exact internal index.
- Modify `tests/agents/chapter-planner.test.ts`: verify the chapter 26 prompt contract.

### Task 1: Normalize Expected Event Indexes at the Planning Boundary

**Files:**

- Create: `tests/graph/nodes/planning.test.ts`
- Modify: `src/graph/nodes/planning.ts:38-51`

- [ ] **Step 1: Write the failing boundary regression test**

Mock the planner factory and chapter context. Return a plan for displayed chapter 26 whose fulfillment event contains `chapterIndex: 26`, then assert that `plan_chapter_with_override` returns both plan and event with internal `chapterIndex: 25`, preserving all other fields.

```ts
it('normalizes every expected event to the authoritative current chapter index', async () => {
  plannerRun.mockResolvedValue({
    success: true,
    data: {
      chapterIndex: 26,
      sections: [],
      timeline: [],
      outlineCheck: [],
      expectedEvents: [{
        id: 'evt-fulfill',
        type: 'foreshadow-fulfill',
        foreshadowId: 'fs-due',
        chapterIndex: 26,
        source: 'chapter',
      }],
      fulfilledForeshadowIds: ['fs-due'],
    },
  })

  const result = await plan_chapter_with_override(
    createMockProvider(),
    buildState({ currentChapterIndex: 25 }),
    '第26章：底稿'
  )

  expect(result.chapterPlan?.chapterIndex).toBe(25)
  expect(result.chapterPlan?.expectedEvents[0]).toMatchObject({
    id: 'evt-fulfill',
    foreshadowId: 'fs-due',
    chapterIndex: 25,
  })
})
```

- [ ] **Step 2: Run the boundary test and verify RED**

Run: `npx vitest run tests/graph/nodes/planning.test.ts`

Expected: FAIL because the event still has `chapterIndex: 26`.

- [ ] **Step 3: Implement minimal boundary normalization**

Apply defaults and model output first, then copy every event with the authoritative index:

```ts
const parsedPlan = {
  expectedEvents: [],
  // existing defaults remain here
  ...output.data,
}
const chapterPlan: ChapterPlan = {
  ...parsedPlan,
  chapterIndex,
  expectedEvents: parsedPlan.expectedEvents.map((event) => ({ ...event, chapterIndex })),
}
```

Do not synthesize absent events and do not alter semantic fields.

- [ ] **Step 4: Run the boundary test and verify GREEN**

Run: `npx vitest run tests/graph/nodes/planning.test.ts`

Expected: PASS.

### Task 2: Make the Planner Prompt Index Contract Explicit

**Files:**

- Modify: `tests/agents/chapter-planner.test.ts`
- Modify: `src/agents/prompts/chapter-planner-prompt.ts:133-140,185-193,227-245,358-376`

- [ ] **Step 1: Write the failing prompt regression test**

```ts
it('renders the authoritative zero-based event chapter index', () => {
  const agent = new TestableChapterPlannerAgent(createMockProvider())
  const messages = agent.exposePrompt({
    idea: '测试', genre: 'default', totalChapters: 50,
    world: '', characters: '', outline: '第26章：底稿', previousChapters: '',
    chapterIndex: 25, foreshadowStack: [], chapterSummaries: [],
  })
  const prompt = messages[1]?.content ?? ''
  expect(prompt).toContain('内部零基章节索引固定为 25')
  expect(prompt).toContain('"chapterIndex": 25')
})
```

- [ ] **Step 2: Run the prompt test and verify RED**

Run: `npx vitest run tests/agents/chapter-planner.test.ts -t "renders the authoritative zero-based event chapter index"`

Expected: FAIL because the prompt omits index 25 and retains the fixed example.

- [ ] **Step 3: Render the internal index in the prompt**

Add `chapterIndex` to `ChapterPlannerPromptVariables` and `vars`. Add this neutral structured contract:

```text
- expectedEvents 中的所有事件都由本章产生，其内部零基章节索引固定为 {chapterIndex}；不得填写展示章节号 {displayChapterNumber} 或其他章节索引。
```

Replace the JSON example with `"chapterIndex": {chapterIndex}`.

- [ ] **Step 4: Run planner tests and verify GREEN**

Run: `npx vitest run tests/agents/chapter-planner.test.ts tests/graph/nodes/planning.test.ts`

Expected: both files pass.

### Task 3: Regression and Static Verification

**Files:**

- Verify: `src/graph/nodes/planning.ts`
- Verify: `src/agents/prompts/chapter-planner-prompt.ts`
- Verify: `tests/graph/nodes/planning.test.ts`
- Verify: `tests/agents/chapter-planner.test.ts`

- [ ] **Step 1: Run foreshadow scheduling regressions**

Run: `npx vitest run tests/core/outline-expander.test.ts tests/graph/nodes/planning.test.ts tests/agents/chapter-planner.test.ts`

Expected: all focused tests pass, including tests that reject genuinely absent events.

- [ ] **Step 2: Run type checking**

Run: `npm run typecheck`

Expected: exit code 0.

- [ ] **Step 3: Run the full suite**

Run: `npm test`

Expected: zero failures.

- [ ] **Step 4: Check formatting and patch integrity**

Run: `npx prettier --check src/graph/nodes/planning.ts src/agents/prompts/chapter-planner-prompt.ts tests/graph/nodes/planning.test.ts tests/agents/chapter-planner.test.ts`

Run: `git diff --check`

Expected: both commands exit with code 0.

- [ ] **Step 5: Commit the root fix**

```bash
git add src/graph/nodes/planning.ts src/agents/prompts/chapter-planner-prompt.ts tests/graph/nodes/planning.test.ts tests/agents/chapter-planner.test.ts
git commit -m "[BugFix] Normalize chapter plan event indexes"
```
