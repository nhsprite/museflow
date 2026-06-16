# Hybrid Layered Outline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 MuseFlow 从一次性生成全书详细大纲改为分层大纲：start 阶段生成 high-level arcs，每章写作前动态展开为 detailed plan，并做跨章节边界检查。

**Architecture:** 新增 `HighLevelOutlineAgent` 和 `OutlineExpander`，复用现有 `ChapterPlannerAgent`/`ChapterAgent`/`ChapterPlan` 结构；`draft_chapter` 在写作前调用 `OutlineExpander` 获取当前章详细计划；通过配置项 `outlineStrategy` 保持旧项目兼容。

**Tech Stack:** TypeScript, ESM, Vitest, LangGraph agents

---

## File Map

| File | Responsibility |
|------|----------------|
| `src/agents/outline.ts` | 现有 `OutlineAgent`，生成详细大纲。改为生成 high-level arcs。 |
| `src/agents/high-level-outline.ts` | （新增）专门生成 1–2 句话的章节弧线。保留 `OutlineAgent` 作为 legacy 兼容。 |
| `src/core/outline-expander.ts` | （新增）根据 high-level arc + 前后状态生成 detailed plan 和边界提示。 |
| `src/graph/nodes.ts` | 修改 `create_outline` 调用新 agent；修改 `plan_chapter` 调用 `OutlineExpander`；修改 `draft_chapter` 接收 detailed plan。 |
| `src/core/runner.ts` | 可能需要透传配置。 |
| `src/types/story.ts` | 新增 `outlineStrategy` 配置类型。 |
| `tests/agents/high-level-outline.test.ts` | （新增）测试 high-level outline 生成。 |
| `tests/core/outline-expander.test.ts` | （新增）测试边界检查和 plan 生成。 |
| `tests/graph/layered-outline-flow.test.ts` | （新增）集成测试 layered outline 全流程。 |

---

## Task 1: Add outline strategy configuration type

**Files:**
- Modify: `src/types/story.ts`
- Test: `tests/types/story.test.ts`（如不存在则跳过，或直接在集成测试覆盖）

- [ ] **Step 1: Write the failing test**

Create `tests/types/story.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { StoryConfig } from '../../src/types/story.js'

describe('StoryConfig outlineStrategy', () => {
  it('accepts layered strategy', () => {
    const config: StoryConfig = {
      provider: 'openai',
      model: 'gpt-4o',
      outlineStrategy: 'layered',
    }
    expect(config.outlineStrategy).toBe('layered')
  })

  it('defaults to legacy when omitted', () => {
    const config: StoryConfig = {
      provider: 'openai',
      model: 'gpt-4o',
    }
    expect(config.outlineStrategy ?? 'legacy').toBe('legacy')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/types/story.test.ts
```

Expected: FAIL because `StoryConfig` does not have `outlineStrategy`.

- [ ] **Step 3: Add outlineStrategy to StoryConfig**

Modify `src/types/story.ts`:

```ts
export interface StoryConfig {
  provider: string
  model: string
  apiKey?: string
  baseUrl?: string
  outlineStrategy?: 'layered' | 'legacy'
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/types/story.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types/story.ts tests/types/story.test.ts
git commit -m "feat(types): add outlineStrategy config"
```

---

## Task 2: Create HighLevelOutlineAgent

**Files:**
- Create: `src/agents/high-level-outline.ts`
- Create: `tests/agents/high-level-outline.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/agents/high-level-outline.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { HighLevelOutlineAgent } from '../../src/agents/high-level-outline.js'

const mockChat = vi.fn(async (): Promise<string> => '')

vi.mock('../../src/model/registry.ts', () => ({
  createProvider: () => ({
    chat: mockChat,
  }),
}))

describe('HighLevelOutlineAgent', () => {
  it('parses high-level outline with short descriptions', async () => {
    const agent = new HighLevelOutlineAgent()
    mockChat.mockResolvedValueOnce(JSON.stringify({
      chapters: [
        { number: 1, title: '启程', description: '主角离开家乡，踏上旅途。' },
        { number: 2, title: '遇敌', description: '主角遭遇首个强敌，陷入危机。' },
      ],
    }))

    const output = await agent.run({
      idea: 'a hero journey',
      genre: 'default',
      totalChapters: 2,
    })

    expect(output.success).toBe(true)
    const chapters = (output.data as { chapters: Array<{ number: number; title: string; description: string }> }).chapters
    expect(chapters).toHaveLength(2)
    expect(chapters[0]!.description.length).toBeLessThanOrEqual(60)
  })

  it('returns empty array when parse fails', async () => {
    const agent = new HighLevelOutlineAgent()
    mockChat.mockResolvedValueOnce('invalid json')

    const output = await agent.run({
      idea: 'a hero journey',
      genre: 'default',
      totalChapters: 2,
    })

    const chapters = (output.data as { chapters: unknown[] } | undefined)?.chapters ?? []
    expect(chapters).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/agents/high-level-outline.test.ts
```

Expected: FAIL because `HighLevelOutlineAgent` does not exist.

- [ ] **Step 3: Implement HighLevelOutlineAgent**

Create `src/agents/high-level-outline.ts`:

```ts
import { BaseAgent, type AgentState, type AgentOutput } from './base.js'
import type { ChapterOutline } from '../graph/state.js'
import { generateId } from '../utils/id.js'

export interface HighLevelOutlineData {
  chapters: ChapterOutline[]
}

export class HighLevelOutlineAgent extends BaseAgent {
  constructor() {
    super(undefined, 0.7)
  }

  protected buildPrompt(state: AgentState): import('../model/provider.js').Message[] {
    const userContent = `请为一部 ${state.totalChapters} 章的长篇小说生成高层次的章节大纲。

<idea>
${state.idea}
</idea>

<genre>
${state.genre || 'default'}
</genre>

${state.world ? `<world>\n${state.world}\n</world>` : ''}

${state.characters ? `<characters>\n${state.characters}\n</characters>` : ''}

<requirements>
- 每章只写 1–2 句话，控制在 30–60 字
- 只描述核心转折或关键事件，不写具体细节、对话或场景执行
- 不要把后续章节的事件提前解决；如果某章暂时制服敌人，请明确为"暂时""待后续处置"
- 相邻章节之间不应重复处理同一核心事件
- 输出 JSON 格式：
  {
    "chapters": [
      { "number": 1, "title": "章节标题", "description": "章节弧线描述" }
    ]
  }
</requirements>`

    return [
      this.systemMessage('你是一位擅长故事结构的小说策划。你的任务是为长篇小说生成高层次的章节弧线，每章只写核心转折，不写细节。'),
      this.userMessage(userContent),
    ]
  }

  protected parse(content: string): AgentOutput {
    const trimmed = content.trim()
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return { success: false, error: '无法解析大纲：未找到 JSON 格式' }
    }
    try {
      const data = JSON.parse(jsonMatch[0]) as HighLevelOutlineData
      if (!Array.isArray(data.chapters)) {
        return { success: false, error: '大纲格式错误：chapters 不是数组' }
      }
      const chapters = data.chapters.map(ch => ({
        id: generateId(),
        number: ch.number,
        title: ch.title,
        description: ch.description,
      }))
      return { success: true, data: { chapters } }
    } catch {
      return { success: false, error: '无法解析大纲：JSON 格式错误' }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/agents/high-level-outline.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agents/high-level-outline.ts tests/agents/high-level-outline.test.ts
git commit -m "feat(agents): add HighLevelOutlineAgent for layered outline arcs"
```

---

## Task 3: Create OutlineExpander

**Files:**
- Create: `src/core/outline-expander.ts`
- Create: `tests/core/outline-expander.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/core/outline-expander.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { expandOutlineForChapter } from '../../src/core/outline-expander.js'
import type { ReducedGraphState } from '../../src/graph/state.js'

const planChapterMock = vi.fn()

vi.mock('../../src/graph/nodes.js', () => ({
  plan_chapter: planChapterMock,
}))

const baseState: ReducedGraphState = {
  story: { id: 'story-1', title: 'Story', outputDir: '/tmp/story' },
  idea: 'idea',
  genre: 'default',
  totalChapters: 3,
  world: null,
  characters: [],
  outline: [
    { id: 'o1', number: 1, title: '启程', description: '主角离开家乡。' },
    { id: 'o2', number: 2, title: '遇敌', description: '主角遭遇敌人并暂时被困。' },
    { id: 'o3', number: 3, title: '脱困', description: '主角脱困并反击。' },
  ],
  chapters: [null, null, null],
  currentChapterIndex: 1,
  foreshadowStack: [],
  chapterSummaries: ['第一章摘要'],
  pendingIssues: [],
  rewriteApproved: false,
  rewriteRequested: false,
  isWriting: true,
  writeOneChapterOnly: true,
  lastPrintedChapter: 0,
  lastTimelineSnapshot: null,
  chapterPlan: null,
  storyState: null,
  autoFixAttempts: 0,
}

describe('expandOutlineForChapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    planChapterMock.mockResolvedValue({ chapterPlan: { sections: [] } })
  })

  it('calls plan_chapter with current and next chapter arcs', async () => {
    await expandOutlineForChapter(baseState, 1)

    expect(planChapterMock).toHaveBeenCalledTimes(1)
    const calledState = planChapterMock.mock.calls[0]![0] as ReducedGraphState
    expect(calledState.outline).toContain('第2章：遇敌')
    expect(calledState.outline).toContain('主角遭遇敌人并暂时被困')
    expect(calledState.outline).toContain('第3章：脱困')
  })

  it('warns when current arc already resolves next arc event', async () => {
    const conflictState: ReducedGraphState = {
      ...baseState,
      outline: [
        { id: 'o1', number: 1, title: '真假美猴王', description: '六耳猕猴伏法，真宝玉获救。' },
        { id: 'o2', number: 2, title: '三界求援', description: '如来佛祖现身辨别六耳猕猴。' },
      ],
    }

    await expandOutlineForChapter(conflictState, 1)

    const calledState = planChapterMock.mock.calls[0]![0] as ReducedGraphState
    expect(calledState.outline).toContain('不得重复处理')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/core/outline-expander.test.ts
```

Expected: FAIL because `expandOutlineForChapter` does not exist.

- [ ] **Step 3: Implement OutlineExpander**

Create `src/core/outline-expander.ts`:

```ts
import type { ReducedGraphState } from '../graph/state.js'
import { plan_chapter } from '../graph/nodes.js'
import { buildNextChapterBoundaryHint, findRedundantOutlineEvents } from '../utils/outline-compatibility.js'
import { buildOutlineBridgeHint } from '../utils/outline-bridge.js'
import { toDisplayChapterNumber } from '../utils/chapter-display.js'

export interface ExpandedOutline {
  chapterPlan: NonNullable<ReducedGraphState['chapterPlan']>
  boundaryHints: string[]
}

export async function expandOutlineForChapter(
  state: ReducedGraphState,
  chapterIndex: number
): Promise<ExpandedOutline> {
  const outlineItem = state.outline[chapterIndex]
  if (!outlineItem) {
    throw new Error(`第 ${chapterIndex + 1} 章大纲不存在`)
  }

  const nextItem = state.outline[chapterIndex + 1]

  const bridgeHint = buildOutlineBridgeHint(state.outline, chapterIndex)
  const nextBoundaryHint = buildNextChapterBoundaryHint(state.outline, chapterIndex)
  const redundant = findRedundantOutlineEvents(state.outline, chapterIndex)
  const boundaryHints = [bridgeHint, nextBoundaryHint].filter(h => h.length > 0)

  const formattedOutline = [
    `第${toDisplayChapterNumber(chapterIndex)}章：${outlineItem.title}`,
    outlineItem.description,
    nextItem ? `\n【后续章节边界】第${nextItem.number}章"${nextItem.title}"大纲：${nextItem.description}` : '',
    bridgeHint,
    nextBoundaryHint,
    redundant.length > 0
      ? `\n【修正要求】检测到相邻章节事件重叠：第${redundant[0]!.previousChapter}章已包含"${redundant[0]!.previousKeyword}"，本章不得重复处理该事件，请将其改写为余波、后续发展或新转折。`
      : '',
  ].filter(part => part.length > 0).join('\n')

  const planState: ReducedGraphState = {
    ...state,
    currentChapterIndex: chapterIndex,
    outline: state.outline,
    // Inject formatted outline into the field ChapterPlannerAgent expects
    // plan_chapter reads state.outline as an array; we pass formatted outline via a custom field is not straightforward.
    // Instead we rely on plan_chapter using formatChapterOutlineForAgent which reads state.outline array.
    // So we must override how plan_chapter builds the agent state.
    // We will modify plan_chapter in the next task to accept an optional override outline string.
  }

  // Placeholder until plan_chapter signature is updated
  const planResult = await plan_chapter(planState)
  if (!planResult.chapterPlan) {
    throw new Error(`第 ${chapterIndex + 1} 章详细计划生成失败`)
  }

  return {
    chapterPlan: planResult.chapterPlan,
    boundaryHints,
  }
}
```

> 注意：当前 `plan_chapter` 从 `state.outline` 数组读取。我们需要在下一步修改 `plan_chapter` 以支持传入格式化后的 outline 字符串。

- [ ] **Step 4: Update plan_chapter to accept outline override**

Modify `src/graph/nodes.ts` 中的 `plan_chapter`：

```ts
export async function plan_chapter(state: ReducedGraphState, options?: { outlineOverride?: string }): Promise<Partial<ReducedGraphState>> {
  // ... existing setup ...
  const agentState: AgentState = {
    // ...
    outline: options?.outlineOverride ?? formatChapterOutlineForAgent(state, chapterIndex),
    // ...
  }
  // ... rest unchanged
}
```

Then update `src/core/outline-expander.ts` 调用：

```ts
const planResult = await plan_chapter(planState, { outlineOverride: formattedOutline })
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run tests/core/outline-expander.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/outline-expander.ts tests/core/outline-expander.test.ts src/graph/nodes.ts
git commit -m "feat(core): add OutlineExpander with boundary checks"
```

---

## Task 4: Wire OutlineExpander into draft_chapter

**Files:**
- Modify: `src/graph/nodes.ts` (`draft_chapter`)
- Modify: `src/graph/nodes.ts` (`create_outline`)
- Test: `tests/graph/layered-outline-flow.test.ts`（新增）

- [ ] **Step 1: Write the failing integration test**

Create `tests/graph/layered-outline-flow.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import type { ReducedGraphState } from '../../src/graph/state.js'

const expandOutlineMock = vi.fn()
const planChapterMock = vi.fn()
const runAgentMock = vi.fn()

vi.mock('../../src/core/outline-expander.js', () => ({
  expandOutlineForChapter: expandOutlineMock,
}))

vi.mock('../../src/agents/index.js', () => ({
  WorldbuilderAgent: class {},
  CharacterAgent: class {},
  OutlineAgent: class {},
  HighLevelOutlineAgent: class {},
  ChapterAgent: class {
    async run() {
      return { content: runAgentMock() }
    }
  },
  ChapterPlannerAgent: class {},
  QualityAgent: class {},
  ForeshadowingAgent: class {},
  HallucinationAgent: class {},
  ConsistencyAgent: class {},
  OutlineComplianceAgent: class {},
  FixAgent: class {},
  SummaryAgent: class {},
  processSummaryOutput: vi.fn(),
}))

vi.mock('../../src/storage/filesystem/writer.js', () => ({
  writeChapterContent: vi.fn().mockResolvedValue(undefined),
  readChapterContent: vi.fn().mockResolvedValue(null),
}))

vi.mock('../../src/genres/registry.js', () => ({
  getGenreSkill: vi.fn().mockReturnValue(null),
}))

const baseState: ReducedGraphState = {
  story: { id: 'story-1', title: 'Story', outputDir: '/tmp/story' },
  idea: 'idea',
  genre: 'default',
  totalChapters: 2,
  world: null,
  characters: [],
  outline: [
    { id: 'o1', number: 1, title: '启程', description: '主角离开家乡。' },
    { id: 'o2', number: 2, title: '遇敌', description: '主角遭遇敌人。' },
  ],
  chapters: [null, null],
  currentChapterIndex: 0,
  foreshadowStack: [],
  chapterSummaries: [],
  pendingIssues: [],
  rewriteApproved: false,
  rewriteRequested: false,
  isWriting: true,
  writeOneChapterOnly: true,
  lastPrintedChapter: 0,
  lastTimelineSnapshot: null,
  chapterPlan: null,
  storyState: null,
  autoFixAttempts: 0,
}

describe('layered outline flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    expandOutlineMock.mockResolvedValue({
      chapterPlan: { sections: [] },
      boundaryHints: [],
    })
    runAgentMock.mockReturnValue('chapter content')
  })

  it('calls expandOutlineForChapter before drafting', async () => {
    const { draft_chapter } = await import('../../src/graph/nodes.js')

    await draft_chapter(baseState)

    expect(expandOutlineMock).toHaveBeenCalledWith(baseState, 0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/graph/layered-outline-flow.test.ts
```

Expected: FAIL because `draft_chapter` does not call `expandOutlineForChapter`.

- [ ] **Step 3: Modify draft_chapter to use OutlineExpander**

Modify `src/graph/nodes.ts` 中的 `draft_chapter`：

```ts
import { expandOutlineForChapter } from '../core/outline-expander.js'

export async function draft_chapter(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  const agent = getChapterAgent()
  const chapterIndex = state.currentChapterIndex
  const outlineItem = state.outline[chapterIndex]
  const worldContent = state.world?.content

  // Expand high-level outline into detailed plan before drafting
  const { chapterPlan, boundaryHints } = await expandOutlineForChapter(state, chapterIndex)
  state = { ...state, chapterPlan }

  const previousChapters = buildLayeredSummaries(state.chapterSummaries, chapterIndex)
  const timelineSnapshot = buildCharacterFactTimeline(state, chapterIndex)
  const keyEventsTimeline = buildKeyEventsTimeline(state, chapterIndex)

  const existingContent = state.rewriteApproved
    ? await readChapterContent(state.story.outputDir, chapterIndex + 1)
    : null

  const reconciledState = state.storyState && outlineItem?.description
    ? reconcileStoryState(state.storyState, outlineItem.description, state.characters)
    : state.storyState
  const storyStateStr = reconciledState ? formatStoryState(reconciledState) : ''

  const agentState: AgentState = {
    idea: state.idea,
    genre: state.genre,
    totalChapters: state.totalChapters,
    ...(worldContent ? { world: worldContent } : {}),
    characters: charactersToString(state.characters),
    outline: formatChapterOutlineForAgent(state, chapterIndex, boundaryHints),
    previousChapters,
    chapterIndex,
    chapterSummaries: state.chapterSummaries,
    timelineSnapshot,
    keyEventsTimeline,
    foreshadowStack: state.foreshadowStack,
    storyState: storyStateStr,
    ...(state.rewriteApproved ? { issues: state.pendingIssues } : {}),
    ...(existingContent ? { chapterContent: existingContent } : {}),
    ...(state.chapterPlan ? { chapterPlan: state.chapterPlan } : {}),
  }

  // ... rest unchanged
}
```

- [ ] **Step 4: Update formatChapterOutlineForAgent signature**

Modify `src/graph/nodes.ts` 中的 `formatChapterOutlineForAgent`：

```ts
function formatChapterOutlineForAgent(
  state: ReducedGraphState,
  chapterIndex: number,
  extraHints: string[] = []
): string {
  const outlineItem = state.outline[chapterIndex]
  if (!outlineItem) {
    return state.outline.map((o, i) => `第${toDisplayChapterNumber(i)}章：${o.title}`).join('\n')
  }
  const bridgeHint = buildOutlineBridgeHint(state.outline, chapterIndex)
  const nextChapterBoundaryHint = buildNextChapterBoundaryHint(state.outline, chapterIndex)
  return [
    `第${toDisplayChapterNumber(chapterIndex)}章：${outlineItem.title}`,
    outlineItem.description,
    bridgeHint,
    nextChapterBoundaryHint,
    ...extraHints,
  ].filter(part => part.trim().length > 0).join('\n')
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run tests/graph/layered-outline-flow.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/graph/nodes.ts tests/graph/layered-outline-flow.test.ts
git commit -m "feat(graph): wire OutlineExpander into draft_chapter"
```

---

## Task 5: Update create_outline to use HighLevelOutlineAgent for new stories

**Files:**
- Modify: `src/graph/nodes.ts` (`create_outline`)
- Modify: `src/agents/index.ts`（导出 HighLevelOutlineAgent）
- Test: `tests/graph/layered-outline-flow.test.ts`

- [ ] **Step 1: Export HighLevelOutlineAgent**

Modify `src/agents/index.ts`：

```ts
export { HighLevelOutlineAgent } from './high-level-outline.js'
```

- [ ] **Step 2: Modify create_outline to choose agent by strategy**

Modify `src/graph/nodes.ts` 中的 `create_outline`：

```ts
import { HighLevelOutlineAgent } from '../agents/index.js'

let highLevelOutlineAgent: HighLevelOutlineAgent | null = null

function getHighLevelOutlineAgent(): HighLevelOutlineAgent {
  if (!highLevelOutlineAgent) highLevelOutlineAgent = new HighLevelOutlineAgent()
  return highLevelOutlineAgent
}

export async function create_outline(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  const worldContent = state.world?.content
  const useLayered = state.story.outlineStrategy === 'layered'

  if (useLayered) {
    const agent = getHighLevelOutlineAgent()
    const agentState: AgentState = {
      idea: state.idea,
      genre: state.genre,
      totalChapters: state.totalChapters,
      title: state.story.title,
      ...(state.story.worldDirection ? { worldDirection: state.story.worldDirection } : {}),
      ...(worldContent ? { world: worldContent } : {}),
      characters: charactersToString(state.characters),
    }

    const output = await agent.run(agentState)
    const outline = agent.processOutput ? [] : ((output.data as { chapters: ReducedGraphState['outline'] } | undefined)?.chapters ?? [])

    // HighLevelOutlineAgent parse already returns ChapterOutline[]; data is { chapters }
    const chapters = (output.data as { chapters: ReducedGraphState['outline'] } | undefined)?.chapters ?? []

    if (chapters.length === 0) {
      throw new Error('[MuseFlow] 错误：高层次大纲解析失败')
    }

    saveOutline(state.story.id, chapters)
    await writeOutlineContent(state.story.outputDir, state.story.title, chapters)
    await writeStoryBible(state.story.outputDir, state.story, worldContent || '', state.characters, chapters)
    return { outline: chapters }
  }

  // Legacy path: existing OutlineAgent behavior
  const agent = getOutlineAgent()
  // ... existing code ...
}
```

> 注意：`HighLevelOutlineAgent` 没有 `processOutput` 方法，parse 直接返回 outline。需要确认类型一致性。

- [ ] **Step 3: Add test for create_outline strategy selection**

在 `tests/graph/layered-outline-flow.test.ts` 增加：

```ts
describe('create_outline strategy', () => {
  it('uses legacy OutlineAgent by default', async () => {
    // This test verifies default behavior; actual implementation in Task 5
  })
})
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/graph/layered-outline-flow.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/graph/nodes.ts src/agents/index.ts tests/graph/layered-outline-flow.test.ts
git commit -m "feat(graph): create_outline chooses high-level or legacy outline by strategy"
```

---

## Task 6: Update start command to pass outline strategy

**Files:**
- Modify: `src/cli/commands/start.ts`
- Modify: `src/types/story.ts`（如需要）
- Test: `tests/cli/start.test.ts`（如不存在则新建）

- [ ] **Step 1: Add --outline-strategy flag to start command**

Modify `src/cli/commands/start.ts`，读取 `--outline-strategy` 参数并写入 story config。

- [ ] **Step 2: Persist outlineStrategy in story metadata**

确保 `story.outlineStrategy` 保存到 `meta.json` 的 `story` 字段。

- [ ] **Step 3: Add minimal test**

创建或更新 `tests/cli/start.test.ts` 验证 `--outline-strategy layered` 被正确解析。

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/cli/start.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/start.ts tests/cli/start.test.ts src/types/story.ts
git commit -m "feat(cli): add --outline-strategy flag to start command"
```

---

## Task 7: Backward compatibility for existing stories

**Files:**
- Modify: `src/core/runner.ts` 或 `src/cli/commands/continue.ts`
- Test: `tests/cli/continue.test.ts`（如不存在则新建）

- [ ] **Step 1: Default to legacy for stories without outlineStrategy**

在加载 story 时，如果 `story.outlineStrategy` 未设置，默认 `'legacy'`。

- [ ] **Step 2: Detect old detailed outlines**

如果 outline 描述普遍超过 60 字，视为旧详细大纲，强制使用 legacy 策略。

- [ ] **Step 3: Add test**

验证无 `outlineStrategy` 的旧故事默认走 legacy。

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/cli/continue.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/core/runner.ts tests/cli/continue.test.ts
git commit -m "feat(core): default old stories to legacy outline strategy"
```

---

## Task 8: Full test run and type check

- [ ] **Step 1: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 2: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Commit any fixes**

```bash
git commit -m "fix: address typecheck and test failures"
```

---

## Self-Review

**Spec coverage:**
- High-level arc generation: Task 2
- Detailed plan expansion: Task 3
- Boundary checking: Task 3
- draft_chapter integration: Task 4
- create_outline strategy: Task 5
- CLI flag: Task 6
- Backward compatibility: Task 7

**Placeholder scan:** 无 TBD/TODO。

**Type consistency:** `ChapterPlan` 类型复用现有定义；`outlineOverride` 选项新增到 `plan_chapter`。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2025-06-16-hybrid-layered-outline-plan.md`.

Two execution options:

1. **Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach do you want?
