# CLI Foreshadow Boundary Pressure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the structured required-foreshadow pressure that can extend the current act in every CLI act-progress view.

**Architecture:** Add a detail-returning boundary query beside the existing ID-returning policy API, then put state-to-lines formatting in one focused CLI formatter. `printActProgress` and `printChapterProgress` will print those shared lines, so write/rewrite/continue/status cannot drift apart.

**Tech Stack:** TypeScript, Node.js 20+, Vitest, existing StoryMemory and CLI formatter modules.

---

## File map

- Modify `src/story-memory/foreshadow-policy.ts`: expose boundary-blocking records while preserving the existing ID API.
- Create `src/cli/formatters/foreshadow-boundary-pressure.ts`: resolve and format the current act's pressure.
- Modify `src/cli/utils/chapter-display.ts`: print pressure in write/rewrite/continue headers.
- Modify `src/cli/formatters/status-formatter.ts`: print the same pressure in `museflow status`.
- Modify `tests/story-memory/foreshadow-policy.test.ts`: cover the shared detail query.
- Create `tests/cli/foreshadow-boundary-pressure.test.ts`: cover detailed, empty, and final-act formatting.
- Modify `tests/cli/chapter-display.test.ts`: cover chapter-header integration.
- Modify `tests/cli/status.test.ts`: cover status integration.

### Task 1: Expose structured boundary-blocking foreshadows

**Files:**
- Modify: `src/story-memory/foreshadow-policy.ts:79-87`
- Test: `tests/story-memory/foreshadow-policy.test.ts`

- [ ] **Step 1: Write the failing policy test**

Import `getBoundaryBlockingForeshadowDetails` and add:

```ts
it('returns boundary-blocking details in scheduling order', () => {
  const memory: StoryMemory = {
    ...createEmptyStoryMemory(),
    foreshadows: {
      later: memoryForeshadow('later', null, true, 4),
      earlier: memoryForeshadow('earlier', null, true, 2),
      future: memoryForeshadow('future', null, true, 8),
      optional: memoryForeshadow('optional', null, false, 2),
      fulfilled: { ...memoryForeshadow('fulfilled', null, true, 2), fulfilledIn: 1 },
    },
  }

  expect(
    getBoundaryBlockingForeshadowDetails(memory, 4, false).map((entry) => [
      entry.id,
      entry.expectedFulfillChapter,
    ])
  ).toEqual([
    ['earlier', 2],
    ['later', 4],
  ])
})
```

- [ ] **Step 2: Run test to verify RED**

Run: `npx vitest run tests/story-memory/foreshadow-policy.test.ts`

Expected: FAIL because `getBoundaryBlockingForeshadowDetails` is not exported.

- [ ] **Step 3: Implement the detail API**

```ts
export function getBoundaryBlockingForeshadowDetails(
  memory: StoryMemory,
  boundaryChapter: number,
  isStoryEnd: boolean
): ForeshadowMemory[] {
  return getRequiredForeshadowsForScheduling(memory, boundaryChapter, isStoryEnd)
}

export function getBoundaryBlockingForeshadows(
  memory: StoryMemory,
  boundaryChapter: number,
  isStoryEnd: boolean
): ForeshadowId[] {
  return getBoundaryBlockingForeshadowDetails(memory, boundaryChapter, isStoryEnd).map(
    (foreshadow) => foreshadow.id
  )
}
```

- [ ] **Step 4: Run test to verify GREEN**

Run: `npx vitest run tests/story-memory/foreshadow-policy.test.ts`

Expected: all tests in the file PASS.

- [ ] **Step 5: Commit**

```bash
git add src/story-memory/foreshadow-policy.ts tests/story-memory/foreshadow-policy.test.ts
git commit -m "refactor: expose foreshadow boundary details"
```

### Task 2: Add one shared CLI pressure formatter

**Files:**
- Create: `src/cli/formatters/foreshadow-boundary-pressure.ts`
- Create: `tests/cli/foreshadow-boundary-pressure.test.ts`

- [ ] **Step 1: Write failing formatter tests**

Create a two-act state with structured `storyMemory`, then assert:

```ts
expect(formatActForeshadowBoundaryPressure(state, state.storyArc!.acts[0]!, '  ')).toEqual([
  '  伏笔边界压力: 2 个 required 伏笔待回收',
  '  待回收伏笔:',
  '    1. fs-earlier（预计第 2 章）',
  '    2. fs-boundary（预计第 3 章）',
])
```

Add the empty-state assertion:

```ts
expect(formatActForeshadowBoundaryPressure({ ...state, storyMemory: null }, act, '  ')).toEqual([
  '  伏笔边界压力: 0',
])
```

Add a final-act assertion proving story-end semantics and null-deadline rendering:

```ts
expect(formatActForeshadowBoundaryPressure(finalActState, finalAct, '')).toContain(
  '  2. fs-unscheduled（未设预计章节）'
)
```

- [ ] **Step 2: Run test to verify RED**

Run: `npx vitest run tests/cli/foreshadow-boundary-pressure.test.ts`

Expected: FAIL because the formatter module does not exist.

- [ ] **Step 3: Implement the formatter**

```ts
import type { ReducedGraphState } from '../../graph/state.js'
import { getBoundaryBlockingForeshadowDetails } from '../../story-memory/foreshadow-policy.js'
import type { ActArc } from '../../types/outline.js'

export function formatActForeshadowBoundaryPressure(
  state: ReducedGraphState,
  act: ActArc,
  indent = ''
): string[] {
  const finalActIndex = state.storyArc?.acts.at(-1)?.index
  const entries = state.storyMemory
    ? getBoundaryBlockingForeshadowDetails(
        state.storyMemory,
        act.endChapter,
        act.index === finalActIndex
      )
    : []

  if (entries.length === 0) return [`${indent}伏笔边界压力: 0`]

  return [
    `${indent}伏笔边界压力: ${entries.length} 个 required 伏笔待回收`,
    `${indent}待回收伏笔:`,
    ...entries.map((entry, index) => {
      const deadline =
        entry.expectedFulfillChapter === null
          ? '未设预计章节'
          : `预计第 ${entry.expectedFulfillChapter} 章`
      return `${indent}  ${index + 1}. ${entry.id}（${deadline}）`
    }),
  ]
}
```

- [ ] **Step 4: Run test to verify GREEN**

Run: `npx vitest run tests/cli/foreshadow-boundary-pressure.test.ts`

Expected: all formatter tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/formatters/foreshadow-boundary-pressure.ts tests/cli/foreshadow-boundary-pressure.test.ts
git commit -m "feat: format foreshadow boundary pressure"
```

### Task 3: Show pressure in write, rewrite, and continue headers

**Files:**
- Modify: `src/cli/utils/chapter-display.ts:1-59`
- Test: `tests/cli/chapter-display.test.ts`

- [ ] **Step 1: Write the failing integration test**

Give `buildState()` two due required foreshadows and assert after `printActProgress(buildState(), 5)`:

```ts
expect(logSpy).toHaveBeenCalledWith('  伏笔边界压力: 2 个 required 伏笔待回收')
expect(logSpy).toHaveBeenCalledWith('  待回收伏笔:')
expect(logSpy).toHaveBeenCalledWith('    1. fs-a（预计第 6 章）')
expect(logSpy).toHaveBeenCalledWith('    2. fs-b（预计第 8 章）')
```

Add a `storyMemory: null` test expecting `  伏笔边界压力: 0`.

- [ ] **Step 2: Run test to verify RED**

Run: `npx vitest run tests/cli/chapter-display.test.ts`

Expected: FAIL because `printActProgress` does not print pressure lines.

- [ ] **Step 3: Print the shared lines**

Import `formatActForeshadowBoundaryPressure` and append after the pending-beat list:

```ts
for (const line of formatActForeshadowBoundaryPressure(state, act, '  ')) {
  console.log(line)
}
```

- [ ] **Step 4: Run test to verify GREEN**

Run: `npx vitest run tests/cli/chapter-display.test.ts`

Expected: all chapter-display tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/utils/chapter-display.ts tests/cli/chapter-display.test.ts
git commit -m "feat: show foreshadow pressure in chapter headers"
```

### Task 4: Show pressure in status

**Files:**
- Modify: `src/cli/formatters/status-formatter.ts:75-115`
- Test: `tests/cli/status.test.ts`

- [ ] **Step 1: Write the failing status test**

Build a state containing one required unfulfilled foreshadow due by the current act boundary, invoke `status`, and assert:

```ts
expect(logSpy).toHaveBeenCalledWith('伏笔边界压力: 1 个 required 伏笔待回收')
expect(logSpy).toHaveBeenCalledWith('待回收伏笔:')
expect(logSpy).toHaveBeenCalledWith('  1. fs-status（预计第 3 章）')
```

- [ ] **Step 2: Run test to verify RED**

Run: `npx vitest run tests/cli/status.test.ts`

Expected: FAIL because `printChapterProgress` does not print pressure lines.

- [ ] **Step 3: Print shared status lines**

Import the formatter and, inside the `arcStatus.currentAct` branch, append:

```ts
for (const line of formatActForeshadowBoundaryPressure(state, arcStatus.currentAct)) {
  console.log(line)
}
```

Keep the existing `printForeshadowStatus` inventory unchanged.

- [ ] **Step 4: Run test to verify GREEN**

Run: `npx vitest run tests/cli/status.test.ts`

Expected: all status tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/formatters/status-formatter.ts tests/cli/status.test.ts
git commit -m "feat: show foreshadow pressure in status"
```

### Task 5: Verify the complete change

**Files:**
- Verify all files changed in Tasks 1-4.

- [ ] **Step 1: Run focused regression tests**

Run:

```bash
npx vitest run tests/story-memory/foreshadow-policy.test.ts tests/cli/foreshadow-boundary-pressure.test.ts tests/cli/chapter-display.test.ts tests/cli/status.test.ts
```

Expected: all focused tests PASS with zero failures.

- [ ] **Step 2: Run the full test suite**

Run: `npm test`

Expected: all test files and tests PASS.

- [ ] **Step 3: Run static verification**

Run: `npm run typecheck` and `npm run build`.

Expected: both commands exit 0 with no TypeScript errors.

- [ ] **Step 4: Inspect final repository state**

Run: `git diff HEAD~4 --check` and `git status --short --branch`.

Expected: no whitespace errors and no uncommitted implementation changes.
