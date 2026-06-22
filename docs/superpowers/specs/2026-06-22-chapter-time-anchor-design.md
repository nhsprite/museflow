# MuseFlow 章节时间锚点修复设计

## 1. 背景与问题

在 `rewrite story_mqoope2735602be08dfa -c 6` 时，系统三次重写均未通过 consistency/hallucination 检查。日志显示核心矛盾集中在时间线：

- 第 5 章结束时，`SummaryAgent` 把 `storyState.storyTime` 记录为「出殡后第三日午时」。
- 第 6 章大纲要求描写「三日期限」内的行动，自然需要跨越第一天到第三天。
- `ChapterAgent` 和 `ConsistencyAgent` 都把 `storyTime` 当作不可违背的「当前唯一时间原点」。
- 当正文出现「三日期限第一日」「第二日」时，`ConsistencyAgent` 判定为时间倒流，报出大量 error。

根因不是 AI 写得差，而是**系统把「上一章结束时间」误用为「本章叙事起点」**，两者在跨越时间的章节里必然冲突。

## 2. 目标

- 让 `storyTime` 恢复其原本语义：**上一章结束时的故事时间**，不再被当作本章唯一锚点。
- 引入一个明确的「本章时间锚点」决策，由规划器根据大纲和上一章状态共同决定。
- 让写作者和一致性检查者都基于同一锚点工作，消除时间线误判。
- 保持对线性推进章节的兼容性：如果本章只是继续推进，`chapterTimeAnchor` 等于 `storyTime`。

## 3. 设计方案

### 3.1 新增 `chapterTimeAnchor` 字段

在 `ReducedGraphState` 中新增：

```typescript
chapterTimeAnchor?: string
```

语义：**本章叙事所采用的时间起点/时间模式说明**。例如：

- `"出殡后第三日午时（继续推进）"`
- `"三日期限第一日卯时（回溯覆盖第5章会面后三日）"`
- `"未指定"`

`storyTime` 保持不变，继续记录「上一章结束时的客观时间」。

### 3.2 规划器决定本章时间锚点

`ChapterPlannerAgent` 的输入中增加 `storyState`，使其能看到上一章结束时间。

规划器在生成 `ChapterPlan` 时，根据以下信息决定 `chapterTimeAnchor`：

1. `storyState.storyTime`：上一章结束时间。
2. 本章大纲描述中的时间词：如「三日后」「次日」「当晚」「回忆三年前」等。
3. 上一章遗留的未完成任务：如「明日辰时定轿」「后日卯时末停轿」。

规划器输出新增字段：

```typescript
interface ChapterPlan {
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
  chapterTimeAnchor?: string  // 新增
}
```

如果规划器判断本章是正常继续推进，则 `chapterTimeAnchor` 等于 `storyState.storyTime`；
如果判断本章需要回溯或跨越一段时间，则输出明确的时间锚点说明。

### 3.3 写作者基于 `chapterTimeAnchor` 写作

`ChapterAgent` 的 prompt 中：

- 把 `storyState` 里的 `【故事时间】` 改名为 `【上一章结束时间】`，避免被误解为当前时间。
- 如果 `chapterPlan.chapterTimeAnchor` 存在，在 prompt 中显式加入：

```text
【本章时间锚点】
本章叙事从以下时间点开始：{chapterTimeAnchor}
本章允许采用回忆、倒叙或跨日叙事，只要时间推进逻辑自洽，不视为与上一章结束时间矛盾。
```

- `timelineSection` 中的「上一章结束时的状态」改为「上一章结束时的参考状态」，并补充说明本章时间锚点可能不同。

### 3.4 一致性检查者基于 `chapterTimeAnchor` 检查

`ConsistencyAgent` 的 prompt 中：

- 把 `storyState.storyTime` 解释为「上一章结束时间参考」。
- 如果 `chapterPlan.chapterTimeAnchor` 存在，以它作为本章时间原点。
- 修改 `data_source_priority` 规则：
  - 当本章有明确的 `chapterTimeAnchor` 时，以此判断时间推进是否合理。
  - 只有当正文与 `chapterTimeAnchor` 矛盾时，才报时间线 error。
  - 不要以 `storyTime` 为由，否定 `chapterTimeAnchor` 所允许的跨日/回溯叙事。

### 3.5 Rewrite 时重置时间锚点

`rewriteChapter`（`src/cli/commands/rewrite.ts`）在构建 `workingState` 时：

```typescript
workingState = {
  ...checkpointState,
  currentChapterIndex: targetChapterIndex,
  chapters: rewrittenChapters,
  chapterSummaries: cleanedSummaries,
  foreshadowStack: cleanedForeshadowStack,
  chapterTimeAnchor: undefined,  // 新增：重置，让规划器重新决定
  pendingIssues: retryIssues.length > 0 ? retryIssues : checkpointState.pendingIssues,
  rewriteApproved: userResponse,
  rewriteRequested: false,
  isWriting: true,
  writeOneChapterOnly: true,
  chapterPlan: null,
}
```

`continueStory`（`src/core/runner.ts`）同样重置 `chapterTimeAnchor`，因为继续写当前章时也需要重新规划。

### 3.6 降级兜底：Prompt 规则补充

即使 `chapterTimeAnchor` 因某种原因缺失，也要通过 prompt 规则避免误判：

- `ChapterAgent` 和 `ConsistencyAgent` 的 prompt 中统一增加：

```text
【时间规则】
- `storyState` 中的「上一章结束时间」只是叙事参考起点。
- 本章可以根据大纲需要采用回忆、倒叙或跨日叙事。
- 只要本章内部时间推进逻辑自洽，且与大纲要求一致，不视为与「上一章结束时间」矛盾。
```

这对应方案 1 的轻量规则，作为兜底保护。

## 4. 数据流

```text
第 N 章结束
    │
    ▼
SummaryAgent 提取 storyState.storyTime = "第 N 章结束时间"
    │
    ▼
存入 meta.json
    │
    ▼
第 N+1 章启动 / rewrite
    │
    ▼
恢复 checkpoint 和 storyState
    │
    ▼
ChapterPlannerAgent
输入：storyState.storyTime + 本章大纲 + 前章摘要
输出：chapterPlan.chapterTimeAnchor
    │
    ├─ 正常继续 → chapterTimeAnchor = storyTime.storyTime
    └─ 跨越/回溯 → chapterTimeAnchor = 明确的时间锚点说明
    │
    ▼
ChapterAgent
输入：chapterPlan.chapterTimeAnchor + storyState
输出：本章正文
    │
    ▼
ConsistencyAgent
输入：chapterPlan.chapterTimeAnchor + storyState + 正文
检查：正文时间是否与 chapterTimeAnchor 矛盾
```

## 5. 关键改动文件

| 文件 | 改动 |
|------|------|
| `src/graph/state.ts` | `GraphState` 新增 `chapterTimeAnchor?: string` |
| `src/agents/chapter-planner.ts` | prompt 增加 `storyState` 输入；输出增加 `chapterTimeAnchor`；要求根据大纲时间词推断本章锚点 |
| `src/graph/nodes.ts` | `runPlanChapter` 把 `storyState` 传给 planner；`draft_chapter` 把 `chapterTimeAnchor` 注入 ChapterAgent prompt；`detect_consistency` 把 `chapterTimeAnchor` 注入 ConsistencyAgent prompt |
| `src/agents/chapter.ts` | prompt 中解释 `storyTime` 为上一章结束时间；根据 `chapterTimeAnchor` 输出时间锚点说明 |
| `src/agents/consistency.ts` | prompt 中以 `chapterTimeAnchor` 为时间原点；放宽对 `storyTime` 的绝对化解读 |
| `src/cli/commands/rewrite.ts` | `workingState` 中重置 `chapterTimeAnchor: undefined` |
| `src/core/runner.ts` | `continueStory` 的 `workingState` 中重置 `chapterTimeAnchor: undefined` |

## 6. 接口设计

### 6.1 GraphState 扩展

```typescript
export const GraphState = Annotation.Root({
  // ... existing fields
  chapterPlan: Annotation<ChapterPlan | null>,
  storyState: Annotation<StoryState>,
  chapterTimeAnchor: Annotation<string | undefined>,  // 新增
  autoFixAttempts: Annotation<number>,
})
```

### 6.2 ChapterPlan 扩展

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
  chapterTimeAnchor?: string  // 新增
}
```

### 6.3 AgentState 扩展

```typescript
export interface AgentState {
  // ... existing fields
  storyState?: string
  chapterPlan?: ChapterPlan
  chapterTimeAnchor?: string  // 新增
}
```

## 7. 测试策略

- 单元测试 `ChapterPlannerAgent`：
  - 输入含「三日后」的大纲，输出 `chapterTimeAnchor` 应为回溯模式。
  - 输入线性推进大纲，输出 `chapterTimeAnchor` 应等于 `storyTime`。
- 单元测试 `ConsistencyAgent`：
  - 给定 `chapterTimeAnchor` 为「三日期限第一日」，正文写第一日到第三日，不报时间线 error。
  - 给定 `chapterTimeAnchor` 为「第三日午时」，正文写第一日事件且无倒叙说明，报 error。
- 集成测试：
  - 模拟第 5 章结束 `storyTime = "出殡后第三日午时"`，第 6 章大纲含「三日期限」。
  - 验证 rewrite 不再因时间线问题反复失败。

## 8. 风险与回退

- **规划器无法正确推断锚点**：模型可能输出空或不合理的 `chapterTimeAnchor`。对策：
  - 如果输出为空，回退到 `storyTime`。
  - 如果包含「继续」「推进」等词，视为与 `storyTime` 一致。
- **ConsistencyAgent 仍按旧规则判错**：prompt 规则补充作为兜底，若仍误判，可进一步把 `chapterTimeAnchor` 的权重提到最高。
- **数据结构兼容性**：`chapterTimeAnchor` 是可选字段，不影响旧 checkpoint。

## 9. 验收标准

- [ ] `GraphState` 包含 `chapterTimeAnchor` 字段。
- [ ] `ChapterPlannerAgent` 能根据大纲和 `storyState.storyTime` 输出 `chapterTimeAnchor`。
- [ ] `draft_chapter` 把 `chapterTimeAnchor` 注入 ChapterAgent prompt。
- [ ] `detect_consistency` 把 `chapterTimeAnchor` 注入 ConsistencyAgent prompt，并以其为时间原点。
- [ ] `rewriteChapter` 和 `continueStory` 重置 `chapterTimeAnchor`。
- [ ] 第 6 章 rewrite 不再因「时间线严重矛盾」反复失败。
- [ ] 所有现有测试通过，新增测试覆盖时间锚点推断。
