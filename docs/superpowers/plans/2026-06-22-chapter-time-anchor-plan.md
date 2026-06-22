# Chapter Time Anchor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-chapter `chapterTimeAnchor` so the planner decides when the current chapter's narrative starts, decoupling it from the previous chapter's `storyState.storyTime`.

**Architecture:** Extend `GraphState`, `ChapterPlan`, and `AgentState` with an optional `chapterTimeAnchor`. Feed it from the planner through the drafter to the consistency checker. Update prompts so `storyState.storyTime` is treated as "previous chapter end time" and `chapterTimeAnchor` as "this chapter's narrative time origin".

**Tech Stack:** TypeScript, Node 20, Vitest, LangGraph, ESM.

---

## File Map

| File | Responsibility |
|------|---------------|
| `src/graph/state.ts` | Graph state shape; add `chapterTimeAnchor` annotation |
| `src/agents/base.ts` | `AgentState` interface; add `chapterTimeAnchor` field |
| `src/agents/chapter-planner.ts` | Planner prompt/output; add `chapterTimeAnchor` inference |
| `src/agents/chapter.ts` | Drafter prompt; render `chapterTimeAnchor` and soften `storyTime` label |
| `src/agents/consistency.ts` | Consistency prompt; use `chapterTimeAnchor` as time origin |
| `src/graph/nodes.ts` | Pass `chapterTimeAnchor` between agents and state |
| `src/cli/commands/rewrite.ts` | Reset `chapterTimeAnchor` on rewrite |
| `src/core/runner.ts` | Reset `chapterTimeAnchor` on continue |
| `tests/agents/chapter-planner.test.ts` | Add planner prompt tests for `chapterTimeAnchor` |
| `tests/agents/chapter.test.ts` | Add drafter prompt tests for `chapterTimeAnchor` |

---

## Task 1: Extend State and Agent Types

**Files:**
- Modify: `src/graph/state.ts`
- Modify: `src/agents/base.ts`
- Test: `npm run typecheck`

- [ ] **Step 1: Add `chapterTimeAnchor` to `GraphState`**

Edit `src/graph/state.ts` and add a new annotation after `chapterPlan`:

```typescript
export const GraphState = Annotation.Root({
  // ... existing fields ...
  chapterPlan: Annotation<ChapterPlan | null>,
  storyState: Annotation<StoryState>,
  chapterTimeAnchor: Annotation<string | undefined>,
  autoFixAttempts: Annotation<number>,
})
```

- [ ] **Step 2: Add `chapterTimeAnchor` to `AgentState`**

Edit `src/agents/base.ts` and extend the interface:

```typescript
export interface AgentState {
  // ... existing fields ...
  chapterPlan?: ChapterPlan
  storyState?: string
  chapterTimeAnchor?: string
  supersededFacts?: string
  nextChapterBoundary?: string
}
```

- [ ] **Step 3: Add `chapterTimeAnchor` to `ChapterPlan`**

Edit `src/agents/chapter-planner.ts` and extend the interface:

```typescript
export interface ChapterPlan {
  sections: Array<{
    title: string
    summary: string
    wordCount: number
    events: string[]
    characters: string[]
    timeMark?: string
  }>
  timeline: Array<{
    event: string
    time: string
    notes: string
  }>
  outlineCheck: Array<{
    requirement: string
    fulfilled: boolean
    section: string
  }>
  chapterTimeAnchor?: string
}
```

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/graph/state.ts src/agents/base.ts src/agents/chapter-planner.ts
git commit -m "feat: add chapterTimeAnchor to state and agent types"
```

---

## Task 2: Planner Infers and Outputs `chapterTimeAnchor`

**Files:**
- Modify: `src/agents/chapter-planner.ts`
- Modify: `src/graph/nodes.ts`
- Test: `tests/agents/chapter-planner.test.ts`

- [ ] **Step 1: Add failing test for storyState input**

Edit `tests/agents/chapter-planner.test.ts` and append:

```typescript
  it('includes storyState and time anchor guidance when provided', () => {
    const agent = new TestableChapterPlannerAgent()

    const messages = agent.exposePrompt({
      idea: '测试',
      genre: 'default',
      totalChapters: 2,
      world: '',
      characters: '',
      outline: '第2章：追查真相\n主角继续调查上一章遗留的问题',
      previousChapters: '第1章：主角发现线索。',
      chapterIndex: 1,
      foreshadowStack: [],
      chapterSummaries: [],
      storyState: '【故事时间】\n第三天傍晚',
    })

    const userMessage = messages[1]?.content ?? ''
    expect(userMessage).toContain('【上一章结束时间】')
    expect(userMessage).toContain('第三天傍晚')
    expect(userMessage).toContain('chapterTimeAnchor')
    expect(userMessage).toContain('本章时间锚点')
  })
```

Run: `npm test -- tests/agents/chapter-planner.test.ts`

Expected: FAIL because the prompt does not yet include these strings.

- [ ] **Step 2: Update planner prompt to receive storyState and emit chapterTimeAnchor**

Edit `src/agents/chapter-planner.ts`:

1. In `buildPrompt`, build a `storyStateSection` from `state.storyState`:

```typescript
const storyStateSection = state.storyState
  ? `【上一章结束时间】
${state.storyState}

请根据本章大纲，判断本章叙事应该从何时开始。如果本章只是正常继续推进，chapterTimeAnchor 等于上一章结束时间；如果本章需要回溯、倒叙或跨越一段时间，请在 chapterTimeAnchor 中明确说明。`
  : '（暂无上一章状态）'
```

2. Insert `storyStateSection` into the `<context>` block after `<previous_summary>`.

3. In `<instruction>` add a new point (after existing point 6):

```typescript
7. 【时间锚点 - 必须输出】
   在输出 JSON 的根级别增加字段 "chapterTimeAnchor"（字符串）。
   规则：
   - 如果本章从上一章结束时间继续推进：chapterTimeAnchor = 上一章结束时间（或写"继续推进：{storyTime}"）。
   - 如果本章大纲要求回溯、倒叙或跨越一段时间：chapterTimeAnchor = 本章叙事起点时间，并注明时间模式（如"三日期限第一日卯时（回溯覆盖第5章后三日）"）。
   - 如果无法判断：chapterTimeAnchor = "未指定"。
   - chapterTimeAnchor 将成为本章写作者和一致性检查者的时间原点，必须准确。
```

4. Update `<output_format>` JSON example to include:

```typescript
  "chapterTimeAnchor": "本章叙事起点时间",
```

- [ ] **Step 3: Add test for chapterTimeAnchor in output parsing**

Append another test to `tests/agents/chapter-planner.test.ts`:

```typescript
  it('parses chapterTimeAnchor from planner JSON output', async () => {
    mockChat.mockResolvedValueOnce(JSON.stringify({
      sections: [
        {
          title: '开头',
          summary: '主角醒来',
          wordCount: 500,
          events: ['主角醒来'],
          characters: ['主角'],
          timeMark: '三日后',
        },
      ],
      timeline: [{ event: '主角醒来', time: '三日后', notes: '' }],
      outlineCheck: [{ requirement: '主角醒来', fulfilled: true, section: '开头' }],
      chapterTimeAnchor: '三日后（跨越三日）',
    }))

    const agent = new TestableChapterPlannerAgent()
    const output = await agent.run({
      idea: '测试',
      genre: 'default',
      totalChapters: 1,
      outline: '第1章：主角醒来',
      previousChapters: '',
      chapterIndex: 0,
      foreshadowStack: [],
      chapterSummaries: [],
    })

    expect(output.success).toBe(true)
    const data = output.data as { chapterTimeAnchor?: string }
    expect(data.chapterTimeAnchor).toBe('三日后（跨越三日）')
  })
```

Run: `npm test -- tests/agents/chapter-planner.test.ts`

Expected: PASS.

- [ ] **Step 4: Pass storyState to planner in nodes.ts**

Edit `src/graph/nodes.ts` in `runPlanChapter` (`src/graph/nodes.ts:331-368`).

Current agentState construction should include `storyState`. Add:

```typescript
const storyStateStr = state.storyState ? formatStoryState(state.storyState) : ''

const agentState: AgentState = {
  // ... existing fields ...
  storyState: storyStateStr,
  foreshadowStack: state.foreshadowStack,
  // ...
}
```

Also update the function signature of `runPlanChapter` so it can read state directly (already does).

- [ ] **Step 5: Commit**

```bash
git add src/agents/chapter-planner.ts src/graph/nodes.ts tests/agents/chapter-planner.test.ts
git commit -m "feat: planner infers chapterTimeAnchor from storyState and outline"
```

---

## Task 3: Drafter Uses `chapterTimeAnchor`

**Files:**
- Modify: `src/agents/chapter.ts`
- Modify: `src/graph/nodes.ts`
- Test: `tests/agents/chapter.test.ts`

- [ ] **Step 1: Add failing test for chapterTimeAnchor rendering**

Edit `tests/agents/chapter.test.ts` and append:

```typescript
  it('includes chapterTimeAnchor when provided in chapterPlan', () => {
    const agent = new TestableChapterAgent()

    const messages = agent.exposePrompt({
      idea: '测试',
      genre: 'default',
      totalChapters: 2,
      world: '',
      characters: '【苏半城】主角',
      outline: '第2章：茶楼暗访\n三日期限内展开调查',
      previousChapters: '第1章：主角会见亲王，获三日期限。',
      chapterContent: '',
      chapterIndex: 1,
      foreshadowStack: [],
      chapterSummaries: [],
      storyState: '【上一章结束时间】\n出殡后第三日午时',
      chapterPlan: {
        sections: [
          {
            title: '第一日',
            summary: '主角开始调查',
            wordCount: 1000,
            events: ['开始调查'],
            characters: ['苏半城'],
            timeMark: '三日期限第一日',
          },
        ],
        timeline: [{ event: '开始调查', time: '第一日', notes: '' }],
        outlineCheck: [],
        chapterTimeAnchor: '三日期限第一日卯时（回溯覆盖第5章后三日）',
      },
    })

    const userMessage = messages[1]?.content ?? ''
    expect(userMessage).toContain('【本章时间锚点】')
    expect(userMessage).toContain('三日期限第一日卯时')
    expect(userMessage).toContain('本章允许采用回忆、倒叙或跨日叙事')
    expect(userMessage).toContain('【上一章结束时间】')
    expect(userMessage).not.toContain('【故事时间】')
  })
```

Run: `npm test -- tests/agents/chapter.test.ts`

Expected: FAIL.

- [ ] **Step 2: Render chapterTimeAnchor and relabel storyTime in ChapterAgent**

Edit `src/agents/chapter.ts`:

1. In `buildPrompt`, locate `storyStateSection`. Change the label:

```typescript
const storyStateSection = state.storyState
  ? `<story_state>
<mandatory>【上一章结束时间 - 叙事参考起点】</mandatory>
${state.storyState}

${FACT_CONSISTENCY_RULES}

<note>本章可以根据大纲需要采用回忆、倒叙或跨日叙事。只要本章内部时间推进逻辑自洽，且不违背本章时间锚点，不视为与上一章结束时间矛盾。</note>
</story_state>`
  : ''
```

2. In `buildFactVerificationSection`, keep extraction logic as-is (it already extracts by bracket labels).

3. Add a new section after `storyStateSection`:

```typescript
const chapterTimeAnchor = state.chapterPlan?.chapterTimeAnchor || state.chapterTimeAnchor
const timeAnchorSection = chapterTimeAnchor
  ? `<chapter_time_anchor>
<mandatory>【本章时间锚点 - 必须以此作为本章叙事起点】</mandatory>
本章叙事从以下时间点开始：${chapterTimeAnchor}

<important>本章允许采用回忆、倒叙或跨日叙事，只要时间推进逻辑自洽，且与本章时间锚点一致。不要因上一章结束时间而限制本章的时间范围。</important>
</chapter_time_anchor>`
  : ''
```

4. Insert `${timeAnchorSection}` into `userContent` after `${storyStateSection}`.

- [ ] **Step 3: Pass chapterTimeAnchor through nodes.ts**

Edit `src/graph/nodes.ts` in `draft_chapter` (`src/graph/nodes.ts:421-517`):

Ensure `agentState` includes `chapterTimeAnchor`. After building `chapterPlan`, set:

```typescript
const chapterTimeAnchor = state.chapterPlan?.chapterTimeAnchor ?? state.chapterTimeAnchor
```

Add `chapterTimeAnchor` to `agentState`:

```typescript
const agentState: AgentState = {
  // ... existing fields ...
  chapterPlan: state.chapterPlan ?? undefined,
  chapterTimeAnchor,
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/agents/chapter.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agents/chapter.ts src/graph/nodes.ts tests/agents/chapter.test.ts
git commit -m "feat: drafter uses chapterTimeAnchor and softens storyTime label"
```

---

## Task 4: Consistency Checker Uses `chapterTimeAnchor`

**Files:**
- Modify: `src/agents/consistency.ts`
- Modify: `src/graph/nodes.ts`
- Test: add new test file `tests/agents/consistency.test.ts`

- [ ] **Step 1: Create failing test for consistency prompt**

Create `tests/agents/consistency.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Message, ModelProvider } from '../../src/model/provider.ts'
import type { AgentState } from '../../src/agents/base.ts'

const mockChat = vi.fn(async (): Promise<string> => '')

vi.mock('../../src/model/registry.ts', () => ({
  createProvider: (): ModelProvider => ({
    chat: mockChat,
  }),
}))

class TestableConsistencyAgent extends (await import('../../src/agents/consistency.ts')).ConsistencyAgent {
  public exposePrompt(state: Required<AgentState>): Message[] {
    return this.buildPrompt(state)
  }
}

describe('ConsistencyAgent time anchor', () => {
  beforeEach(() => {
    mockChat.mockClear()
  })

  it('uses chapterTimeAnchor as the time origin when provided', () => {
    const agent = new TestableConsistencyAgent()

    const messages = agent.exposePrompt({
      idea: '测试',
      genre: 'default',
      totalChapters: 2,
      world: '',
      characters: '【苏半城】主角',
      outline: '第2章：茶楼暗访\n三日期限内展开调查',
      chapterContent: '三日期限第一日，主角开始调查。',
      chapterIndex: 1,
      foreshadowStack: [],
      chapterSummaries: ['第1章：主角会见亲王，获三日期限。'],
      storyState: '【上一章结束时间】\n出殡后第三日午时',
      chapterPlan: {
        sections: [],
        timeline: [],
        outlineCheck: [],
        chapterTimeAnchor: '三日期限第一日卯时（回溯覆盖第5章后三日）',
      },
      chapterTimeAnchor: '三日期限第一日卯时（回溯覆盖第5章后三日）',
    })

    const userMessage = messages[1]?.content ?? ''
    expect(userMessage).toContain('【本章时间锚点】')
    expect(userMessage).toContain('三日期限第一日卯时')
    expect(userMessage).toContain('【上一章结束时间】')
    expect(userMessage).not.toContain('【故事时间】')
    expect(userMessage).toContain('以本章时间锚点作为判断时间推进是否合理的依据')
  })
})
```

Run: `npm test -- tests/agents/consistency.test.ts`

Expected: FAIL.

- [ ] **Step 2: Update ConsistencyAgent prompt**

Edit `src/agents/consistency.ts`:

1. In `buildPrompt`, construct a `chapterTimeAnchorSection`:

```typescript
const chapterTimeAnchor = state.chapterPlan?.chapterTimeAnchor || state.chapterTimeAnchor
const chapterTimeAnchorSection = chapterTimeAnchor
  ? `<chapter_time_anchor>
<mandatory>【本章时间锚点 - 判断时间推进的原点】</mandatory>
本章叙事从以下时间点开始：${chapterTimeAnchor}

<important>以本章时间锚点作为判断时间推进是否合理的依据。本章允许采用回忆、倒叙或跨日叙事，只要与本章时间锚点一致，不视为与上一章结束时间矛盾。</important>
</chapter_time_anchor>`
  : ''
```

2. Change `<story_state>` label:

```typescript
  <story_state>
    <mandatory>【上一章结束时间参考】</mandatory>
    ${state.storyState || '（暂无状态记录）'}
  </story_state>
```

3. Insert `${chapterTimeAnchorSection}` into `userContent` after `</story_state>`.

4. Update `data_source_priority` rule:

```text
  <rule type="data_source_priority">
    数据来源优先级（非常重要）：
    1. chapterTimeAnchor（本章时间锚点）是本章时间推进的最高权威。如果本章有明确的 chapterTimeAnchor，以它判断时间是否合理，而不是以 storyState.storyTime。
    2. storyState（上一章结束时间参考）是角色位置、物品状态、已揭示秘密的最高权威，但不是本章唯一时间原点。
    3. outline（大纲）是未来章节事实规划的最高权威。
    4. timelineSnapshot 和 chapter summaries 是历史章节的压缩记录，可能包含已被覆盖或修正的旧认知。
    
    判定跨章节矛盾时：
    - 如果当前章节与 chapterTimeAnchor 冲突 → 报 error
    - 如果当前章节与 storyState 冲突，但与 chapterTimeAnchor 一致 → 不视为时间矛盾
    - 如果当前章节与 storyState 冲突，且无 chapterTimeAnchor → 报 error
    - 如果当前章节与 outline 冲突 → 报 error
    - 只有当角色对已被 storyState/outline 确立的事实表现出矛盾态度时，才报 error
  </rule>
```

- [ ] **Step 3: Pass chapterTimeAnchor to ConsistencyAgent in nodes.ts**

Edit `src/graph/nodes.ts` in `detect_consistency` (`src/graph/nodes.ts:1398-1436`):

Add to `agentState`:

```typescript
const chapterTimeAnchor = state.chapterPlan?.chapterTimeAnchor ?? state.chapterTimeAnchor

const agentState: AgentState = {
  // ... existing fields ...
  chapterPlan: state.chapterPlan ?? undefined,
  chapterTimeAnchor,
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/agents/consistency.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agents/consistency.ts src/graph/nodes.ts tests/agents/consistency.test.ts
git commit -m "feat: consistency checker uses chapterTimeAnchor as time origin"
```

---

## Task 5: Reset `chapterTimeAnchor` on Rewrite and Continue

**Files:**
- Modify: `src/cli/commands/rewrite.ts`
- Modify: `src/core/runner.ts`
- Test: existing CLI/runner tests if available; otherwise run typecheck

- [ ] **Step 1: Reset in rewriteChapter**

Edit `src/cli/commands/rewrite.ts` around line 248 and line 286. Add `chapterTimeAnchor: undefined` to both `workingState` objects:

```typescript
workingState = {
  ...checkpointState,
  currentChapterIndex: targetChapterIndex,
  chapters: rewrittenChapters,
  chapterSummaries: cleanedSummaries,
  foreshadowStack: cleanedForeshadowStack,
  chapterTimeAnchor: undefined,
  pendingIssues: retryIssues.length > 0 ? retryIssues : checkpointState.pendingIssues,
  // ...
}
```

And similarly for the non-targeted rewrite branch.

- [ ] **Step 2: Reset in continueStory**

Edit `src/core/runner.ts` around line 140. Add `chapterTimeAnchor: undefined` to `workingState`:

```typescript
const workingState: ReducedGraphState = {
  ...checkpointState,
  currentChapterIndex: targetIndex,
  chapters: rewrittenChapters,
  pendingIssues: cleanedPendingIssues,
  chapterTimeAnchor: undefined,
  rewriteApproved: userResponse ?? false,
  // ...
}
```

- [ ] **Step 3: Run typecheck and full test suite**

Run: `npm run typecheck`

Expected: no errors.

Run: `npm test`

Expected: all existing tests pass plus new tests.

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/rewrite.ts src/core/runner.ts
git commit -m "feat: reset chapterTimeAnchor on rewrite and continue"
```

---

## Task 6: Integration Validation

**Files:**
- N/A (runtime validation)

- [ ] **Step 1: Run the failing rewrite command**

Run: `npm start -- rewrite story_mqoope2735602be08dfa -c 6`

Expected: the rewrite completes without getting stuck in the "time line contradiction" loop.

- [ ] **Step 2: Inspect generated chapter and pending issues**

Check `books/story_mqoope2735602be08dfa/chapters/chapter_6.md` and confirm the narrative spans the intended three-day period without consistency errors about time flowing backward.

- [ ] **Step 3: Commit or revert depending on result**

If validation passes:

```bash
git add -A
git commit -m "feat: chapter time anchor resolves rewrite timeline loop"
```

If validation fails, open a follow-up task to refine planner prompt or adjust consistency rules.

---

## Spec Coverage Check

| Spec Requirement | Plan Task |
|------------------|-----------|
| `GraphState` 新增 `chapterTimeAnchor` 字段 | Task 1 |
| `ChapterPlannerAgent` 根据 `storyState.storyTime` 输出 `chapterTimeAnchor` | Task 2 |
| `draft_chapter` 把 `chapterTimeAnchor` 注入 ChapterAgent prompt | Task 3 |
| `detect_consistency` 把 `chapterTimeAnchor` 注入 ConsistencyAgent prompt | Task 4 |
| `rewriteChapter` 和 `continueStory` 重置 `chapterTimeAnchor` | Task 5 |
| 第 6 章 rewrite 不再因时间线矛盾反复失败 | Task 6 |
| 新增测试覆盖时间锚点推断 | Task 2, 3, 4 |

## Placeholder Scan

No TBD, TODO, or vague steps. All code snippets and commands are concrete.

## Type Consistency Check

- Field name: `chapterTimeAnchor` used everywhere (state, AgentState, ChapterPlan).
- Optional type: `string | undefined` in state annotations and AgentState.
- Fallback chain: `state.chapterPlan?.chapterTimeAnchor ?? state.chapterTimeAnchor`.
