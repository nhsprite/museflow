# Foreshadow Capacity Scheduling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drain required foreshadows in configurable per-chapter batches and automatically extend an act when its remaining capacity cannot satisfy the structured backlog.

**Architecture:** Keep deadline selection in `story-memory/foreshadow-policy.ts`, capacity sizing in `utils/story-arc.ts`, and generation orchestration in `core/outline-expander.ts`. Exact IDs flow from the scheduler through outline and plan declarations into evidence-backed StoryMemory events; SummaryAgent receives only the IDs planned for the current chapter as a fallback extraction context.

**Tech Stack:** TypeScript ESM, LangGraph state, Vitest, JSON filesystem checkpoints, existing GenreSkill configuration.

---

## File Map

- Modify `src/types/genre.ts`: declare the configurable per-chapter fulfillment limit.
- Modify `src/utils/chapter-planning.ts`: provide the neutral default limit.
- Modify `src/story-memory/foreshadow-policy.ts`: select and sort typed due/final-act obligations.
- Modify `src/utils/story-arc.ts`: compute fixed-point capacity and combine it with mandatory-beat extension.
- Modify `src/core/outline-expander.ts`: auto-extend with StoryMemory context, schedule a bounded batch every chapter, validate plan events, and report exact missing IDs.
- Modify `src/agents/prompts/summary-prompt.ts`: render exact planned fulfillment IDs for evidence extraction.
- Modify `src/agents/summary.ts`: pass the new prompt section.
- Modify `src/graph/services/finalization/chapter.ts`: provide SummaryAgent only the current plan's fulfillment targets.
- Modify focused tests under `tests/story-memory/`, `tests/utils/`, `tests/core/`, `tests/agents/`, and `tests/graph/services/finalization/`.

### Task 1: Add Configurable Structured Scheduling Policy

**Files:**
- Modify: `src/types/genre.ts:40-49`
- Modify: `src/utils/chapter-planning.ts:14-41`
- Modify: `src/story-memory/foreshadow-policy.ts:80-106`
- Test: `tests/story-memory/foreshadow-policy.test.ts`

- [ ] **Step 1: Write failing policy tests**

Import `getRequiredForeshadowsForScheduling` and `selectForeshadowsForChapter`, then add tests that build a StoryMemory with finite deadlines, a null deadline, optional, fulfilled, invalid, and future entries:

```typescript
it('orders due required foreshadows by deadline, introduction, and id', () => {
  const memory: StoryMemory = {
    ...createEmptyStoryMemory(),
    foreshadows: {
      later: memoryForeshadow('later', null, true, 8),
      'same-b': { ...memoryForeshadow('same-b', null, true, 6), introducedIn: 2 },
      'same-a': { ...memoryForeshadow('same-a', null, true, 6), introducedIn: 2 },
      earlier: { ...memoryForeshadow('earlier', null, true, 6), introducedIn: 1 },
      future: memoryForeshadow('future', null, true, 9),
      unscheduled: memoryForeshadow('unscheduled', null, true, null),
      optional: memoryForeshadow('optional', null, false, 5),
      fulfilled: { ...memoryForeshadow('fulfilled', null, true, 5), fulfilledIn: 4 },
      invalid: { ...memoryForeshadow('invalid', null, true, 1), introducedIn: 0 },
    },
  }

  expect(getRequiredForeshadowsForScheduling(memory, 8, false).map((f) => f.id)).toEqual([
    'earlier',
    'same-a',
    'same-b',
    'later',
  ])
  expect(selectForeshadowsForChapter(memory, 8, 3, false)).toEqual([
    'earlier',
    'same-a',
    'same-b',
  ])
})

it('includes every valid required unresolved foreshadow in final-act scheduling', () => {
  const memory: StoryMemory = {
    ...createEmptyStoryMemory(),
    foreshadows: {
      due: memoryForeshadow('due', null, true, 3),
      future: memoryForeshadow('future', null, true, 30),
      unscheduled: memoryForeshadow('unscheduled', null, true, null),
      optional: memoryForeshadow('optional', null, false, null),
    },
  }

  expect(getRequiredForeshadowsForScheduling(memory, 20, true).map((f) => f.id)).toEqual([
    'due',
    'future',
    'unscheduled',
  ])
})
```

- [ ] **Step 2: Run the policy test and verify RED**

Run:

```bash
npm test -- tests/story-memory/foreshadow-policy.test.ts
```

Expected: FAIL because the two scheduling exports do not exist.

- [ ] **Step 3: Add the config field and minimal scheduling implementation**

Add to `ChapterPlanningConfig`:

```typescript
/** 单章最多主动回收的 required 伏笔数量 */
foreshadowMaxFulfillmentsPerChapter: number
```

Add to `DEFAULT_CHAPTER_PLANNING_CONFIG` next to the other foreshadow settings:

```typescript
foreshadowMaxFulfillmentsPerChapter: 3,
```

Add the shared typed policy:

```typescript
import type {
  ForeshadowId,
  ForeshadowMemory,
  StoryEvent,
  StoryMemory,
} from '../types/story-memory.js'

export function getRequiredForeshadowsForScheduling(
  memory: StoryMemory,
  chapterNumber: number,
  includeAllRequired: boolean
): ForeshadowMemory[] {
  return Object.values(memory.foreshadows)
    .filter((foreshadow) => {
      if (
        !foreshadow.required ||
        foreshadow.fulfilledIn !== null ||
        !isValidForeshadowDeadline(foreshadow.introducedIn, foreshadow.expectedFulfillChapter)
      ) {
        return false
      }
      return (
        includeAllRequired ||
        (foreshadow.expectedFulfillChapter !== null &&
          foreshadow.expectedFulfillChapter <= chapterNumber)
      )
    })
    .sort((left, right) => {
      const leftDeadline = left.expectedFulfillChapter ?? Number.MAX_SAFE_INTEGER
      const rightDeadline = right.expectedFulfillChapter ?? Number.MAX_SAFE_INTEGER
      return (
        leftDeadline - rightDeadline ||
        left.introducedIn - right.introducedIn ||
        left.id.localeCompare(right.id)
      )
    })
}

export function selectForeshadowsForChapter(
  memory: StoryMemory,
  chapterNumber: number,
  capacity: number,
  includeAllRequired: boolean
): ForeshadowId[] {
  const normalizedCapacity = Math.max(1, Math.floor(capacity))
  return getRequiredForeshadowsForScheduling(memory, chapterNumber, includeAllRequired)
    .slice(0, normalizedCapacity)
    .map((foreshadow) => foreshadow.id)
}
```

Refactor `getBoundaryBlockingForeshadows` to reuse this policy without capping:

```typescript
return getRequiredForeshadowsForScheduling(memory, boundaryChapter, isStoryEnd).map(
  (foreshadow) => foreshadow.id
)
```

- [ ] **Step 4: Run policy tests and typecheck**

Run:

```bash
npm test -- tests/story-memory/foreshadow-policy.test.ts
npm run typecheck
```

Expected: policy suite PASS and typecheck exit 0.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/types/genre.ts src/utils/chapter-planning.ts src/story-memory/foreshadow-policy.ts tests/story-memory/foreshadow-policy.test.ts
git commit -m "[BugFix] Schedule due foreshadows by structured deadlines" -m "Add configurable bounded selection with deterministic exact-ID ordering." -m "issue: #0"
```

### Task 2: Size Act Extensions for Foreshadow Capacity

**Files:**
- Modify: `src/utils/story-arc.ts:181-263`
- Test: `tests/utils/story-arc.test.ts`

- [ ] **Step 1: Write failing capacity tests**

Add a helper that creates N required unresolved foreshadows, then add:

```typescript
function memoryWithDueForeshadows(count: number): StoryMemory {
  const memory = createEmptyStoryMemory()
  for (let index = 0; index < count; index++) {
    const id = `fs-${String(index).padStart(2, '0')}`
    memory.foreshadows[id] = {
      id,
      text: id,
      kind: 'plot',
      introducedIn: 0,
      expectedFulfillChapter: 5,
      fulfilledIn: null,
      required: true,
      beatId: null,
    }
  }
  return memory
}

it('extends a one-chapter boundary by three chapters for eleven due clues at capacity three', () => {
  const proposals = proposeActBoundaryAdjustments(
    makeStoryArc(),
    completedActProgress,
    4,
    memoryWithDueForeshadows(11),
    3
  )

  expect(proposals).toEqual([
    expect.objectContaining({ actIndex: 1, proposedEndChapter: 8 }),
  ])
})

it('uses the greater of beat and foreshadow extension instead of adding them', () => {
  const arc: StoryArc = {
    totalChapters: 5,
    acts: [{ ...makeStoryArc().acts[0]!, endChapter: 5, mandatoryBeats: ['a', 'b', 'c'] }],
    keyBeats: [],
  }
  const proposals = proposeActBoundaryAdjustments(
    arc,
    { 1: { consumed: [], pending: ['a', 'b', 'c'] } },
    4,
    memoryWithDueForeshadows(7),
    3
  )

  expect(proposals).toEqual([
    expect.objectContaining({ proposedEndChapter: 7 }),
  ])
})

it('recalculates capacity when an extension crosses another explicit deadline', () => {
  const memory = memoryWithDueForeshadows(4)
  for (let index = 0; index < 4; index++) {
    const id = `future-${index}`
    memory.foreshadows[id] = {
      id,
      text: id,
      kind: 'plot',
      introducedIn: 0,
      expectedFulfillChapter: 6,
      fulfilledIn: null,
      required: true,
      beatId: null,
    }
  }

  const proposals = proposeActBoundaryAdjustments(
    makeStoryArc(),
    completedActProgress,
    4,
    memory,
    3
  )

  expect(proposals[0]?.proposedEndChapter).toBe(7)
})
```

- [ ] **Step 2: Run the story-arc tests and verify RED**

Run:

```bash
npm test -- tests/utils/story-arc.test.ts
```

Expected: FAIL because the fifth capacity argument is ignored and no extension is proposed for the structured backlog.

- [ ] **Step 3: Implement fixed-point capacity sizing**

Import `getRequiredForeshadowsForScheduling` and add:

```typescript
function calculateForeshadowCapacityEndChapter(
  storyArc: StoryArc,
  act: ActArc,
  currentChapterNumber: number,
  memory: StoryMemory,
  capacity: number
): number {
  const normalizedCapacity = Math.max(1, Math.floor(capacity))
  const finalActIndex = storyArc.acts.at(-1)?.index
  const includeAllRequired = act.index === finalActIndex
  let candidateEnd = act.endChapter

  while (true) {
    const blockingCount = getRequiredForeshadowsForScheduling(
      memory,
      candidateEnd,
      includeAllRequired
    ).length
    const availableCapacity =
      (candidateEnd - currentChapterNumber + 1) * normalizedCapacity
    const missingCapacity = blockingCount - availableCapacity
    if (missingCapacity <= 0) return candidateEnd
    candidateEnd += Math.ceil(missingCapacity / normalizedCapacity)
  }
}
```

Extend the public signature:

```typescript
export function proposeActBoundaryAdjustments(
  storyArc: StoryArc,
  actProgress: Record<number, { consumed: string[]; pending: string[] }>,
  currentChapterIndex: number,
  storyMemory?: StoryMemory | null,
  foreshadowCapacity = Number.MAX_SAFE_INTEGER
): ActBoundaryProposal[]
```

Calculate the beat extension end with the existing logic, calculate the foreshadow end with the new helper, and push one extension proposal whose end is:

```typescript
const proposedExtensionEnd = Math.max(beatExtensionEnd, foreshadowExtensionEnd)
```

Only run the existing early-reduction branch when `proposedExtensionEnd === currentAct.endChapter`. Keep reduction validation against `getBoundaryBlockingForeshadows(memory, proposedEnd, false)`.

- [ ] **Step 4: Run story-arc and finalization tests**

Run:

```bash
npm test -- tests/utils/story-arc.test.ts tests/graph/services/finalization/chapter.test.ts
npm run typecheck
```

Expected: both suites PASS and typecheck exit 0.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/utils/story-arc.ts tests/utils/story-arc.test.ts
git commit -m "[BugFix] Extend acts for foreshadow capacity" -m "Reserve enough chapter slots with fixed-point deadline sizing." -m "issue: #0"
```

### Task 3: Schedule Bounded IDs Through JIT Outline and Chapter Plan

**Files:**
- Modify: `src/core/outline-expander.ts:70-94,129-198,343-486,628-774`
- Test: `tests/core/outline-expander.test.ts`

- [ ] **Step 1: Add failing ordinary-chapter and backlog regression tests**

Update the plan mock to return complete structured declarations:

```typescript
function planForFulfillments(ids: string[]): ChapterPlan {
  return {
    chapterIndex: 0,
    sections: [],
    timeline: [],
    outlineCheck: [],
    expectedEvents: ids.map((id, index) => ({
      id: `expected-${index}`,
      type: 'foreshadow-fulfill',
      foreshadowId: id,
      chapterIndex: 0,
      source: 'outline',
    })),
    claimedBeatIds: [],
    fulfilledForeshadowIds: ids,
    introducedForeshadowIds: [],
    resolvedTaskIds: [],
    createdTaskIds: [],
  }
}
```

Add a test proving a due ID is scheduled outside an act boundary:

```typescript
it('schedules due foreshadows on ordinary chapters', async () => {
  const state = stateWithBoundaryForeshadow('既有大纲。')
  state.currentChapterIndex = 1
  state.storyMemory!.foreshadows['fs-due']!.expectedFulfillChapter = 2
  planChapterWithOverrideMock.mockResolvedValue({ chapterPlan: planForFulfillments(['fs-due']) })

  await expandOutlineForChapter(state, 1, createMockProvider())

  const formattedOutline = planChapterWithOverrideMock.mock.calls[0]![2] as string
  expect(formattedOutline).toContain('fs-due')
})
```

Add the reported-capacity regression with eleven IDs and capacity three. Use a two-act arc ending act 1 at chapter 3, set the current chapter to 3, and make all eleven deadlines `3`. Mock the outline and plan with only `fs-00`, `fs-01`, and `fs-02`:

```typescript
expect(result.storyArc?.acts[0]?.endChapter).toBe(6)
expect(result.totalChapters).toBe(originalTotalChapters + 3)
expect(result.outline?.[2]?.fulfilledForeshadowIds).toEqual(['fs-00', 'fs-01', 'fs-02'])
expect(chapterOutlineRunMock.mock.calls[0]![0].verifiedConstraints.join('\n')).not.toContain(
  'fs-03（'
)
```

Add a test where `fulfilledForeshadowIds` contains the selected ID but `expectedEvents` omits its fulfillment event. Assert one replan occurs and the retry constraint contains the exact ID and `expectedEvents`.

Add a test where all three JIT outline attempts omit `fs-due`:

```typescript
await expect(
  expandOutlineForChapter(stateWithBoundaryForeshadow(''), 2, createMockProvider())
).rejects.toThrow('第 3 章即时大纲连续 3 次遗漏伏笔义务：fs-due')
```

- [ ] **Step 2: Run the outline-expander tests and verify RED**

Run:

```bash
npm test -- tests/core/outline-expander.test.ts
```

Expected failures:

- ordinary chapters do not currently receive due obligations;
- the eleven-ID boundary sends all IDs instead of three and does not extend;
- plan validation ignores missing `expectedEvents`;
- retry exhaustion still reports “未返回可执行大纲”.

- [ ] **Step 3: Pass StoryMemory capacity into automatic extension**

In `autoExtendCurrentActBeforeOutline`, load configuration and call:

```typescript
const planningConfig = getChapterPlanningConfig(state.genre)
const extensionProposals = proposeActBoundaryAdjustments(
  state.storyArc,
  state.actProgress,
  chapterIndex,
  state.storyMemory,
  planningConfig.foreshadowMaxFulfillmentsPerChapter
).filter(
  (proposal) =>
    proposal.actIndex === currentAct.index && proposal.proposedEndChapter > currentAct.endChapter
)
```

Keep the existing `applyActBoundaryAdjustment`, outline scaffold, chapter scaffold, and total-chapter update path unchanged.

- [ ] **Step 4: Replace boundary-only selection with per-chapter scheduling**

Replace `getChapterBoundaryForeshadowIds` with:

```typescript
function getChapterScheduledForeshadowIds(
  state: ReducedGraphState,
  chapterIndex: number
): string[] {
  if (!state.storyMemory) return []
  const act = getActForChapter(state.storyArc, chapterIndex)
  const finalActIndex = state.storyArc?.acts.at(-1)?.index
  const includeAllRequired = act !== undefined && act.index === finalActIndex
  const planningConfig = getChapterPlanningConfig(state.genre)
  return selectForeshadowsForChapter(
    state.storyMemory,
    chapterIndex + 1,
    planningConfig.foreshadowMaxFulfillmentsPerChapter,
    includeAllRequired
  )
}
```

Use the selected IDs in both JIT outline generation and existing-outline planning. Rename local variables and messages from “boundary” to “scheduled” where they now apply to ordinary chapters.

- [ ] **Step 5: Validate both plan declarations and events**

Add:

```typescript
function getMissingPlanForeshadowIds(
  plan: ChapterPlan,
  scheduledIds: string[]
): { declarationIds: string[]; eventIds: string[] } {
  const declared = new Set(plan.fulfilledForeshadowIds ?? [])
  const eventIds = new Set(
    (plan.expectedEvents ?? []).flatMap((event) =>
      event.type === 'foreshadow-fulfill' ? [event.foreshadowId] : []
    )
  )
  return {
    declarationIds: scheduledIds.filter((id) => !declared.has(id)),
    eventIds: scheduledIds.filter((id) => !eventIds.has(id)),
  }
}
```

Use both arrays when deciding whether to replan. The correction constraint must name the exact missing declaration IDs and event IDs. Apply the same validation after time-anchor and budget replans.

Track the last JIT omission and log each attempt:

```typescript
logger.warn(
  `[MuseFlow] 第 ${chapterIndex + 1} 章即时大纲第 ${attempt + 1}/${MAX_JIT_OUTLINE_ATTEMPTS} 次遗漏伏笔义务：${missingIds.join(', ')}`
)
```

After exhaustion, throw:

```typescript
throw new Error(
  `第 ${chapterIndex + 1} 章即时大纲连续 ${MAX_JIT_OUTLINE_ATTEMPTS} 次遗漏伏笔义务：${lastMissingIds.join(', ')}（单章容量 ${planningConfig.foreshadowMaxFulfillmentsPerChapter}）`
)
```

- [ ] **Step 6: Run focused tests and typecheck**

Run:

```bash
npm test -- tests/core/outline-expander.test.ts tests/utils/story-arc.test.ts tests/story-memory/foreshadow-policy.test.ts
npm run typecheck
```

Expected: all focused suites PASS and typecheck exit 0.

- [ ] **Step 7: Commit Task 3**

```bash
git add src/core/outline-expander.ts tests/core/outline-expander.test.ts
git commit -m "[BugFix] Drain foreshadows in bounded chapter batches" -m "Propagate scheduled IDs through JIT outlines and evidence-bearing chapter plans." -m "issue: #0"
```

### Task 4: Give SummaryAgent Exact Planned Fulfillment IDs

**Files:**
- Modify: `src/agents/prompts/summary-prompt.ts:17-39,43-73,155-169`
- Modify: `src/agents/summary.ts:102-125`
- Modify: `src/graph/services/finalization/chapter.ts:333-361`
- Test: `tests/agents/summary.test.ts`
- Test: `tests/graph/services/finalization/chapter.test.ts`

- [ ] **Step 1: Write a failing SummaryAgent prompt test**

```typescript
it('includes exact IDs only for foreshadows planned for fulfillment', () => {
  const agent = new TestableSummaryAgent(createMockProvider())
  const messages = agent.exposePrompt({
    idea: 'test',
    genre: 'default',
    totalChapters: 10,
    chapterContent: '正文明确解释了旧线索。',
    chapterTitle: '回收',
    chapterIndex: 5,
    chapterSummaries: [],
    foreshadowStack: [
      {
        id: 'fs-planned',
        text: '计划在本章回收的线索',
        expectedFulfillChapter: 6,
        createdAt: 0,
        createdAtChapter: 1,
        status: 'planted',
        isExplicit: true,
        required: true,
      },
    ],
  })

  const prompt = messages.find((message) => message.role === 'user')?.content ?? ''
  expect(prompt).toContain('<planned_foreshadow_fulfillments>')
  expect(prompt).toContain('[fs-planned]')
  expect(prompt).toContain('只有正文存在明确段落证据时')
})
```

In the finalization suite, capture the `summaryAgent.run` input for a state whose `chapterPlan.fulfilledForeshadowIds` is `['fs-planned']` while StoryMemory also contains `fs-unplanned`. Assert the input stack contains only `fs-planned`.

- [ ] **Step 2: Run SummaryAgent and finalization tests and verify RED**

Run:

```bash
npm test -- tests/agents/summary.test.ts tests/graph/services/finalization/chapter.test.ts
```

Expected: FAIL because SummaryAgent does not render the stack and finalization does not pass planned foreshadows.

- [ ] **Step 3: Render a neutral planned-fulfillment section**

Add to `summary-prompt.ts`:

```typescript
export function buildPlannedForeshadowsSection(
  foreshadows: import('../../types/foreshadow.js').ForeshadowItem[]
): string {
  if (foreshadows.length === 0) return ''
  const lines = foreshadows.map((foreshadow) => `- [${foreshadow.id}] ${foreshadow.text}`)
  return `<planned_foreshadow_fulfillments>
本章规划声明要回收以下伏笔：
${lines.join('\n')}
只有正文存在明确段落证据时，才输出对应 foreshadow-fulfill 事件；事件必须使用方括号中的精确 foreshadowId。正文未完成回收时不得编造事件。
</planned_foreshadow_fulfillments>`
}
```

Add `{plannedForeshadowsSection}` to the prompt template after claimed beats, add the field to `SummaryPromptSections`, import the builder in `summary.ts`, and pass:

```typescript
plannedForeshadowsSection: buildPlannedForeshadowsSection(state.foreshadowStack ?? []),
```

- [ ] **Step 4: Pass only current-plan targets during finalization**

Before building `summaryState`, derive:

```typescript
const plannedForeshadowIds = new Set(state.chapterPlan?.fulfilledForeshadowIds ?? [])
const plannedForeshadows = Object.values(updatedStoryMemory.foreshadows)
  .filter((foreshadow) => plannedForeshadowIds.has(foreshadow.id))
  .map(foreshadowMemoryToItem)
```

Then include the non-empty stack:

```typescript
...(plannedForeshadows.length > 0 ? { foreshadowStack: plannedForeshadows } : {}),
```

Do not pass unrelated active foreshadows; this fallback must not invite the summary model to close unscheduled IDs.

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```bash
npm test -- tests/agents/summary.test.ts tests/graph/services/finalization/chapter.test.ts
npm run typecheck
```

Expected: both suites PASS and typecheck exit 0.

- [ ] **Step 6: Commit Task 4**

```bash
git add src/agents/prompts/summary-prompt.ts src/agents/summary.ts src/graph/services/finalization/chapter.ts tests/agents/summary.test.ts tests/graph/services/finalization/chapter.test.ts
git commit -m "[BugFix] Expose planned foreshadow IDs to summaries" -m "Allow evidence-backed fallback events without presenting unrelated active clues." -m "issue: #0"
```

### Task 5: Verify the Full Rewrite Path and Guard Neutrality

**Files:**
- Verify: `tests/core/outline-expander.test.ts`
- Verify: `tests/smoke/no-prose-matching.test.ts`

- [ ] **Step 1: Run the complete focused regression set**

```bash
npm test -- tests/story-memory/foreshadow-policy.test.ts tests/utils/story-arc.test.ts tests/core/outline-expander.test.ts tests/agents/summary.test.ts tests/graph/services/finalization/chapter.test.ts tests/smoke/no-prose-matching.test.ts
```

Expected: all focused tests PASS. If the smoke test identifies a new production-code prose match, replace that decision with typed IDs or fields before proceeding.

- [ ] **Step 2: Confirm the reported arithmetic in the integration-style test**

Verify the eleven-ID test asserts all of the following in one graph-free `expandOutlineForChapter` call:

```typescript
expect(result.storyArc?.acts[currentActArrayIndex]?.endChapter).toBe(originalEndChapter + 3)
expect(result.totalChapters).toBe(originalTotalChapters + 3)
expect(result.outline?.[chapterIndex]?.fulfilledForeshadowIds).toEqual([
  'fs-00',
  'fs-01',
  'fs-02',
])
expect(planChapterWithOverrideMock).toHaveBeenCalledTimes(1)
```

These assertions were added during Task 3. Run the named regression and require all four assertions to pass before continuing.

- [ ] **Step 3: Run full verification**

```bash
npm test
npm run typecheck
npm run build
npx prettier --check src/types/genre.ts src/utils/chapter-planning.ts src/story-memory/foreshadow-policy.ts src/utils/story-arc.ts src/core/outline-expander.ts src/agents/prompts/summary-prompt.ts src/agents/summary.ts src/graph/services/finalization/chapter.ts tests/story-memory/foreshadow-policy.test.ts tests/utils/story-arc.test.ts tests/core/outline-expander.test.ts tests/agents/summary.test.ts tests/graph/services/finalization/chapter.test.ts
git diff --check
```

Expected:

- 0 failed test files and 0 failed tests;
- typecheck exit 0;
- build exit 0;
- all listed files match Prettier formatting;
- `git diff --check` produces no output.

- [ ] **Step 4: Audit repository scope**

```bash
git status --short
git diff --name-only cff0791..HEAD
```

Expected: only the source, test, spec, and plan files listed in this plan; no path under `books/`, no package-lock change, and no `.codegraph/` change.

- [ ] **Step 5: Commit any final test-only or formatting changes**

If Step 3 changed formatting or Step 2 added missing assertions:

```bash
git add src tests
git commit -m "[BugFix] Complete foreshadow capacity regression coverage" -m "Finalize neutral scheduling verification and repository formatting." -m "issue: #0"
```

If there are no uncommitted source or test changes, skip this commit.

### Task 6: Finish and Integrate the Branch

**Files:**
- No code changes expected.

- [ ] **Step 1: Re-run the full test suite immediately before completion**

```bash
npm test
```

Expected: all test files and tests PASS with exit 0.

- [ ] **Step 2: Use the finishing-development workflow**

Invoke `superpowers:finishing-a-development-branch`, determine that the base branch is `develop`, and present its four integration choices. Do not merge, push, or discard without the user's selected option.
