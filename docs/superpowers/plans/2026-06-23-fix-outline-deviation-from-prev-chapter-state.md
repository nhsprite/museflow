# Fix Chapter Outline Deviation Caused by Previous Chapter State

> **For agentic workers:** REQUIRED SUB-LEVEL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent chapter generation from being pulled back into the previous chapter's unresolved plot threads when the current chapter outline switches to a parallel event.

**Architecture:** Introduce an outline-driven context filtering layer that prunes `storyState.activePlots` / `revealedSecrets` and softens the previous-chapter continuity prompt when the current outline does not mention those threads. Add backward boundary hints and tighten planner/chapter prompts so that "follow the current outline" wins over "continue from the previous scene".

**Tech Stack:** TypeScript ESM, Node 20, MuseFlow agent/graph framework, Vitest.

---

## Problem Statement

When chapter `N` ends with a strong unresolved scene (e.g. a deal offered by a prince) and chapter `N+1`'s outline switches to a parallel event (e.g. an undercover investigation at a teahouse), the drafter keeps writing about the prince deal because:

1. `storyState` carries `activePlots` and `revealedSecrets` from chapter `N` verbatim.
2. The previous-chapter summary and `story_state` prompt sections instruct the model to "naturally continue" from the previous ending.
3. The planner treats unresolved previous-chapter threads as required "bridge" content.
4. There is no explicit instruction telling the model that the previous chapter's core result is already settled and must not be re-enacted.

This produces persistent `outline_deviation` errors that do not converge after repeated rewrites because the input context is identical every time.

## Files to Change

| File | Responsibility |
|------|----------------|
| `src/utils/story-state-filter.ts` (new) | Filter `StoryState` items by relevance to the current chapter outline. |
| `src/utils/outline-boundary.ts` | Add backward boundary hint builder. |
| `src/agents/chapter.ts` | Strengthen "outline wins over previous state" rule in the drafter prompt. |
| `src/agents/chapter-planner.ts` | Prevent planner from bridging unrelated previous-chapter threads. |
| `src/graph/nodes.ts` | Wire `filterStoryStateByOutline` into `draft_chapter` and `plan_chapter`. |
| `src/types/story-state.ts` | Possibly expand `StoryState` types if new metadata is needed (plan keeps existing shape). |
| `tests/utils/story-state-filter.test.ts` (new) | Unit tests for the filter logic. |
| `tests/agents/chapter.test.ts` (modify) | Add prompt-content assertions for outline-priority wording. |

---

## Task 1: Create StoryState Filter Utility

**Files:**
- Create: `src/utils/story-state-filter.ts`
- Test: `tests/utils/story-state-filter.test.ts`

### Step 1: Write the failing test

```typescript
// tests/utils/story-state-filter.test.ts
import { describe, it, expect } from 'vitest'
import { filterStoryStateByOutline } from '../../src/utils/story-state-filter.js'
import type { StoryState } from '../../src/types/story-state.js'
import { createEmptyStoryState } from '../../src/storage/database/dao/story-state.js'

function makeState(overrides: Partial<StoryState> = {}): StoryState {
  return { ...createEmptyStoryState(), ...overrides }
}

describe('filterStoryStateByOutline', () => {
  it('keeps plots and secrets that overlap with current outline', () => {
    const state = makeState({
      activePlots: ['茶楼暗访查经手人', '亲王走账三日期限'],
      revealedSecrets: ['经手人是姓周的翰林', '亲王亏空四十万两'],
    })
    const outline = '第6章 茶楼暗访：苏半城派人潜入琉璃厂茶楼，从旧僚口中探得告发密折的经手人。'
    const filtered = filterStoryStateByOutline(state, outline)
    expect(filtered.activePlots).toContain('茶楼暗访查经手人')
    expect(filtered.activePlots).not.toContain('亲王走账三日期限')
    expect(filtered.revealedSecrets).toContain('经手人是姓周的翰林')
    expect(filtered.revealedSecrets).not.toContain('亲王亏空四十万两')
  })

  it('keeps character status and locations untouched', () => {
    const state = makeState({
      characterStatus: { '苏半城': '冷静' },
      characterLocations: { '苏半城': '陆宅正房' },
      activePlots: ['亲王走账三日期限'],
    })
    const outline = '茶楼暗访：苏半城派人潜入琉璃厂茶楼。'
    const filtered = filterStoryStateByOutline(state, outline)
    expect(filtered.characterStatus).toEqual(state.characterStatus)
    expect(filtered.characterLocations).toEqual(state.characterLocations)
  })

  it('keeps all plots when outline is ambiguous', () => {
    const state = makeState({
      activePlots: ['亲王走账三日期限'],
    })
    const outline = '第6章 继续推进：苏半城处理各方事务。'
    const filtered = filterStoryStateByOutline(state, outline)
    expect(filtered.activePlots).toContain('亲王走账三日期限')
  })
})
```

Run: `npm test -- tests/utils/story-state-filter.test.ts`

Expected: FAIL with "filterStoryStateByOutline is not defined".

### Step 2: Implement the utility

```typescript
// src/utils/story-state-filter.ts
import type { StoryState } from '../types/story-state.js'

export interface FilterStoryStateOptions {
  /**
   * Minimum Jaccard overlap ratio between an item's words and the outline's words
   * for the item to be considered relevant.
   */
  relevanceThreshold?: number
}

function extractKeywords(text: string): Set<string> {
  const words = text
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2)
  return new Set(words)
}

function relevanceScore(item: string, outlineKeywords: Set<string>): number {
  const itemKeywords = extractKeywords(item)
  if (itemKeywords.size === 0) return 0
  let overlap = 0
  for (const kw of itemKeywords) {
    if (outlineKeywords.has(kw)) overlap++
  }
  return overlap / itemKeywords.size
}

function isRelevant(item: string, outlineKeywords: Set<string>, threshold: number): boolean {
  return relevanceScore(item, outlineKeywords) >= threshold
}

/**
 * Prune story-state items that are not relevant to the current chapter outline.
 *
 * - activePlots and revealedSecrets are filtered by keyword overlap.
 * - characterStatus, characterLocations, keyItemsLocation, keyItemsState are kept as-is.
 * - currentScene and storyTime are kept as-is; the caller may override them separately.
 */
export function filterStoryStateByOutline(
  state: StoryState,
  outline: string,
  options: FilterStoryStateOptions = {}
): StoryState {
  const threshold = options.relevanceThreshold ?? 0.15
  const outlineKeywords = extractKeywords(outline)

  const activePlots = state.activePlots.filter(plot =>
    isRelevant(plot, outlineKeywords, threshold)
  )

  const revealedSecrets = state.revealedSecrets.filter(secret =>
    isRelevant(secret, outlineKeywords, threshold)
  )

  return {
    ...state,
    activePlots,
    revealedSecrets,
  }
}
```

Run: `npm test -- tests/utils/story-state-filter.test.ts`

Expected: PASS.

### Step 3: Commit

```bash
git add src/utils/story-state-filter.ts tests/utils/story-state-filter.test.ts
git commit -m "feat(utils): add story-state filter by outline relevance"
```

---

## Task 2: Add Backward Boundary Hint

**Files:**
- Modify: `src/utils/outline-boundary.ts`
- Modify: `src/core/outline-expander.ts`
- Test: `tests/utils/outline-boundary.test.ts` (create if absent)

### Step 1: Write the failing test

If `tests/utils/outline-boundary.test.ts` does not exist, create it:

```typescript
// tests/utils/outline-boundary.test.ts
import { describe, it, expect } from 'vitest'
import { buildPreviousChapterBoundaryHint } from '../../src/utils/outline-boundary.js'
import type { ChapterOutline } from '../../src/graph/state.js'

describe('buildPreviousChapterBoundaryHint', () => {
  it('warns when previous chapter title differs from current chapter topic', () => {
    const outline: ChapterOutline[] = [
      { number: 5, title: '初会亲王', description: '亲王接见苏半城，开出走账条件。' },
      { number: 6, title: '茶楼暗访', description: '苏半城派人潜入琉璃厂茶楼探得经手人。' },
    ]
    const hint = buildPreviousChapterBoundaryHint(outline, 1)
    expect(hint).toContain('第5章"初会亲王"')
    expect(hint).toContain('本章核心事件是"茶楼暗访"')
    expect(hint).toContain('不得在本章重新展开第5章')
  })

  it('returns empty string for chapter 1', () => {
    const outline: ChapterOutline[] = [
      { number: 1, title: '开场', description: '主角登场。' },
    ]
    const hint = buildPreviousChapterBoundaryHint(outline, 0)
    expect(hint).toBe('')
  })
})
```

Run: `npm test -- tests/utils/outline-boundary.test.ts`

Expected: FAIL because `buildPreviousChapterBoundaryHint` is not exported.

### Step 2: Implement the hint builder

Open `src/utils/outline-boundary.ts` and append before the final export block:

```typescript
export function buildPreviousChapterBoundaryHint(
  outline: ChapterOutline[],
  chapterIndex: number
): string {
  if (chapterIndex <= 0) return ''

  const previous = outline[chapterIndex - 1]
  const current = outline[chapterIndex]
  if (!previous?.description || !current?.description) {
    return ''
  }

  const previousKeywords = extractBoundaryKeywords(previous.description)
  const currentKeywords = extractBoundaryKeywords(current.description)

  const overlap = previousKeywords.filter(kw => currentKeywords.includes(kw))
  const similarity = previousKeywords.length > 0
    ? overlap.length / previousKeywords.length
    : 0

  if (similarity >= 0.3) {
    // Chapters are already closely related; no need to warn.
    return ''
  }

  return `<previous_chapter_boundary>
<important>【上一章边界提示】</important>
第${previous.number}章"${previous.title}"的核心事件已在前章完成：${previous.description.slice(0, 60)}……

<mandatory>【强制要求】本章（第${current.number}章"${current.title}"）的核心事件是"${current.title}"，与第${previous.number}章不是同一事件的延续。本章必须聚焦本章大纲描述的事件，不得在本章重新展开第${previous.number}章的核心内容、不得把上一章已经达成的结果再写一遍、不得让上一章的后续安排占据本章主要篇幅。上一章的遗留事项若未在本章大纲中提及，只能作为背景一笔带过，不能展开新场景。</mandatory>
</previous_chapter_boundary>`
}

function extractBoundaryKeywords(text: string): string[] {
  return text
    .split(/[，。；！？、]/)
    .flatMap(s => s.split(/\s+/))
    .map(s => s.trim())
    .filter(s => s.length >= 2)
}
```

Export the helper by adding it to the `export` list at the top or by keeping it in the same file scope (it is already exported via the `export function` keyword).

### Step 3: Wire into outline expansion

Open `src/core/outline-expander.ts`. Import the new helper and add it to `formattedOutline`:

```typescript
import {
  buildOutlineBridgeHint,
  buildNextChapterBoundaryHint,
  buildPreviousChapterBoundaryHint,
  findRedundantOutlineEvents,
} from '../utils/outline-boundary.js'
```

Inside `expandOutlineForChapter`, after computing `nextBoundaryHint`:

```typescript
  const previousBoundaryHint = buildPreviousChapterBoundaryHint(state.outline, chapterIndex)
```

Add it to `formattedOutline` and to `boundaryHints`:

```typescript
  const formattedOutline = [
    `第${toDisplayChapterNumber(chapterIndex)}章：${outlineItem.title}`,
    outlineItem.description,
    nextItem ? `\n【后续章节边界】第${nextItem.number}章"${nextItem.title}"大纲：${nextItem.description}` : '',
    previousBoundaryHint,
    bridgeHint,
    nextBoundaryHint,
    redundant.length > 0
      ? `\n【修正要求】检测到相邻章节事件重叠：第${redundant[0]!.previousChapter}章已包含"${redundant[0]!.previousKeyword}"，本章不得重复处理该事件，请将其改写为余波、后续发展或新转折。`
      : '',
  ].filter(part => part.length > 0).join('\n')
```

Update `boundaryHints`:

```typescript
  const boundaryHints = [previousBoundaryHint, bridgeHint, nextBoundaryHint].filter(h => h.length > 0)
```

Run: `npm test -- tests/utils/outline-boundary.test.ts`

Expected: PASS.

### Step 4: Commit

```bash
git add src/utils/outline-boundary.ts src/core/outline-expander.ts tests/utils/outline-boundary.test.ts
git commit -m "feat(outline): add previous-chapter backward boundary hint"
```

---

## Task 3: Filter StoryState Before Drafting

**Files:**
- Modify: `src/graph/nodes.ts`

### Step 1: Import the filter utility

At the top of `src/graph/nodes.ts` add:

```typescript
import { filterStoryStateByOutline } from '../utils/story-state-filter.js'
```

### Step 2: Filter state in `draft_chapter`

Locate `draft_chapter` and find the section that computes `reconciledState`:

```typescript
  const reconciledState = state.storyState && outlineItem?.description
    ? reconcileStoryState(state.storyState, outlineItem.description, state.characters)
    : state.storyState
  const storyStateStr = reconciledState ? formatStoryState(reconciledState) : ''
```

Change to:

```typescript
  const reconciledState = state.storyState && outlineItem?.description
    ? reconcileStoryState(state.storyState, outlineItem.description, state.characters)
    : state.storyState

  const filteredState = reconciledState && outlineItem?.description
    ? filterStoryStateByOutline(reconciledState, `${outlineItem.title}\n${outlineItem.description}`)
    : reconciledState

  const storyStateStr = filteredState ? formatStoryState(filteredState) : ''
```

### Step 3: Filter state in `runPlanChapter`

Find the same pattern in `runPlanChapter`:

```typescript
  const reconciledState = state.storyState && outlineItem?.description
    ? reconcileStoryState(state.storyState, outlineItem.description, state.characters)
    : state.storyState
  const storyStateStr = reconciledState ? formatStoryState(reconciledState) : ''
```

Change to:

```typescript
  const reconciledState = state.storyState && outlineItem?.description
    ? reconcileStoryState(state.storyState, outlineItem.description, state.characters)
    : state.storyState

  const filteredState = reconciledState && outlineItem?.description
    ? filterStoryStateByOutline(reconciledState, `${outlineItem.title}\n${outlineItem.description}`)
    : reconciledState
  const storyStateStr = filteredState ? formatStoryState(filteredState) : ''
```

### Step 4: Verify type check

Run: `npm run typecheck`

Expected: PASS (no errors).

### Step 5: Commit

```bash
git add src/graph/nodes.ts
git commit -m "feat(nodes): filter story state by outline before drafting and planning"
```

---

## Task 4: Strengthen Chapter Drafter Prompt

**Files:**
- Modify: `src/agents/chapter.ts`

### Step 1: Add outline-priority rule

In `src/agents/chapter.ts`, locate the `outlineComplianceSection` and append a high-priority rule:

```typescript
    const outlineComplianceSection = `<outline_compliance>
<mandatory>【大纲遵循 - 强制要求】</mandatory>
- 本章只能呈现大纲中明确列出的情节点，不得擅自添加大纲未提及的新情节、新场景或新角色
- 如果大纲中某角色被描述为"暗中跟踪"、"暗中观察"或类似定位，该角色不得在本章中公开出现在主角团队面前，不得与主角团队公开互动
- 不得擅自增加大纲未提及的考验、试炼、关卡等情节
- 不得擅自改变大纲中明确指定的角色关系（如"暗中护法"不得变为"正式入队"）
- 如果大纲中出现"后续章节边界提示"或"跨章节边界冲突"，必须严格遵守其中的强制要求：不要把后续章节的核心事件提前解决、不要重复处理前章已解决的事件
- <priority>【最高优先级】</priority> 当"前几章摘要"、"故事当前状态"或"上一章结束时间"与本章大纲要求冲突时，必须无条件以本章大纲为准。上一章遗留的未解决事项若未在本章大纲中明确出现，只能作为简短背景提及，不得占用本章主要篇幅或展开成新场景。
</outline_compliance>`
```

### Step 2: Adjust cross-chapter continuity wording

In `src/agents/prompt-fragments.ts`, modify `CROSS_CHAPTER_CONTINUITY_RULES` to avoid implying that every chapter must continue the previous scene:

Replace:

```typescript
export const CROSS_CHAPTER_CONTINUITY_RULES = `<cross_chapter_continuity_rules>
<mandatory>【必须】跨章节衔接自然且不重复</mandatory>
- 本章结尾的动作、对话或场景，不得与上一章结尾重复。
- 禁止连续两章以相同角色做相同或高度相似的事情作为结尾。
- 本章开头应当自然承接上一章的结尾，但不得简单重复上一章最后一段的内容。
- 本章只能呈现当前大纲要求的事件，不得擅自推进到后续章节的核心事件。
</cross_chapter_continuity_rules>`
```

With:

```typescript
export const CROSS_CHAPTER_CONTINUITY_RULES = `<cross_chapter_continuity_rules>
<mandatory>【必须】跨章节衔接自然且不重复</mandatory>
- 本章结尾的动作、对话或场景，不得与上一章结尾重复。
- 禁止连续两章以相同角色做相同或高度相似的事情作为结尾。
- 本章开头允许直接切入本章大纲的新场景，不必从上一章最后一个场景续写；当大纲明确切换事件、地点或时间时，禁止使用大段笔墨回顾或延续上一章核心情节。
- 本章只能呈现当前大纲要求的事件，不得擅自推进到后续章节的核心事件，也不得把上一章已经处理过的核心事件重新展开。
</cross_chapter_continuity_rules>`
```

### Step 3: Add prompt assertion test

Open `tests/agents/chapter.test.ts`. Find existing prompt-content assertions or add a new test:

```typescript
import { ChapterAgent } from '../../src/agents/chapter.js'

class TestChapterAgent extends ChapterAgent {
  public buildPrompt(state: any) {
    return (this as any).buildPrompt(state)
  }
}

describe('ChapterAgent prompt', () => {
  it('includes outline-priority rule over previous state', () => {
    const agent = new TestChapterAgent()
    const messages = agent.buildPrompt({
      idea: 'test',
      genre: 'default',
      totalChapters: 10,
      world: 'world',
      characters: '【苏半城】主角',
      outline: '第6章 茶楼暗访：苏半城派人潜入琉璃厂茶楼。',
      previousChapters: '第5章：亲王接见。',
      chapterIndex: 5,
      foreshadowStack: [],
      chapterSummaries: [],
      storyState: '【进行中的情节】亲王走账三日期限',
    } as any)
    const userContent = messages.find(m => m.role === 'user')?.content ?? ''
    expect(userContent).toContain('无条件以本章大纲为准')
    expect(userContent).toContain('上一章遗留的未解决事项')
  })
})
```

Run: `npm test -- tests/agents/chapter.test.ts`

Expected: PASS.

### Step 4: Commit

```bash
git add src/agents/chapter.ts src/agents/prompt-fragments.ts tests/agents/chapter.test.ts
git commit -m "feat(chapter): strengthen outline-priority rules over previous state"
```

---

## Task 5: Prevent Planner from Bridging Unrelated Threads

**Files:**
- Modify: `src/agents/chapter-planner.ts`

### Step 1: Adjust planner instruction

In `src/agents/chapter-planner.ts`, inside the `<instruction>` block, replace point 6 (the "check for unresolved states" bridge requirement) with a more conditional version:

```markdown
6. 【本章时间锚点 - 必须输出】
   在输出 JSON 的根级别增加字段 "chapterTimeAnchor"（字符串）。
   规则：
   - 如果本章从上一章结束时间继续推进：chapterTimeAnchor = 上一章结束时间（或写"继续推进：{storyTime}"）。
   - 如果本章大纲要求回溯、倒叙或跨越一段时间：chapterTimeAnchor = 本章叙事起点时间，并注明时间模式（如"三日期限第一日卯时（回溯覆盖第5章后三日）"）。
   - 如果本章大纲明确切换到新的核心事件或新场景，chapterTimeAnchor 应该直接定位到本章大纲要求的起点，不要默认延续上一章的 currentScene。
   - 如果无法判断：chapterTimeAnchor = "未指定"。
   - chapterTimeAnchor 将成为本章写作者和一致性检查者的时间原点，必须准确。
```

Then add a new point 7 after it:

```markdown
7. 【上章遗留状态处理 - 按条件执行】
   - 仅当本章大纲明确提及或直接影响上一章遗留状态时，才需要在规划中包含"衔接段落"。
   - 如果本章大纲切换到全新事件、新地点或新人物，不得为了"衔接"而额外展开上一章的核心内容。
   - 衔接段落只能承接已知事实，不得为了修补前文矛盾而发明新事实、新来源、新因果或新设定。
```

Renumber the remaining points if needed.

### Step 2: Add planner test

Create or extend `tests/agents/chapter-planner.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { ChapterPlannerAgent } from '../../src/agents/chapter-planner.js'

class TestPlannerAgent extends ChapterPlannerAgent {
  public buildPrompt(state: any) {
    return (this as any).buildPrompt(state)
  }
}

describe('ChapterPlannerAgent prompt', () => {
  it('warns against bridging unrelated previous threads', () => {
    const agent = new TestPlannerAgent()
    const messages = agent.buildPrompt({
      idea: 'test',
      genre: 'default',
      totalChapters: 10,
      outline: '第6章 茶楼暗访：苏半城派人潜入琉璃厂茶楼。',
      previousChapters: '第5章：亲王接见，三日期限开始。',
      chapterIndex: 5,
      storyState: '【进行中的情节】亲王走账三日期限',
    } as any)
    const userContent = messages.find(m => m.role === 'user')?.content ?? ''
    expect(userContent).toContain('本章大纲切换到全新事件')
    expect(userContent).toContain('不得为了"衔接"而额外展开上一章的核心内容')
  })
})
```

Run: `npm test -- tests/agents/chapter-planner.test.ts`

Expected: PASS.

### Step 3: Commit

```bash
git add src/agents/chapter-planner.ts tests/agents/chapter-planner.test.ts
git commit -m "feat(planner): avoid bridging unrelated previous-chapter threads"
```

---

## Task 6: Integration Verification

**Files:**
- None (verification only)

### Step 1: Run full test suite

```bash
npm run typecheck
npm test
```

Expected: PASS (or only pre-existing failures).

### Step 2: Run lint

```bash
npm run lint
```

Expected: PASS (or only pre-existing lint warnings).

### Step 3: Manual regression check

Run the original failing command against the existing story:

```bash
npm start -- rewrite story_mqoope2735602be08dfa -c 6
```

Expected: The generated chapter 6 should no longer spend ~40% of its content on the prince-deal accounting. The `outline_deviation` error should either disappear or be reduced to a warning.

### Step 4: Commit final state

If all checks pass:

```bash
git add -A
git commit -m "fix: prevent previous-chapter state from overriding current outline"
```

---

## Self-Review Checklist

1. **Spec coverage:** Every root cause identified in the analysis has a corresponding task:
   - Context filtering of `activePlots` / `revealedSecrets` → Task 1 + Task 3
   - Backward boundary hint → Task 2
   - Outline-priority prompt rule → Task 4
   - Planner not bridging unrelated threads → Task 5
   - Integration verification → Task 6

2. **Placeholder scan:** No `TODO`, `TBD`, or vague "add error handling" steps remain.

3. **Type consistency:** All functions use `StoryState` from `src/types/story-state.js` and `ChapterOutline` from `src/graph/state.js`. ESM imports include `.js` extensions.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-23-fix-outline-deviation-from-prev-chapter-state.md`.**

Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

Which approach would you like?
