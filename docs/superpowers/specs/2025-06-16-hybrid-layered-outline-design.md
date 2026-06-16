# Hybrid Layered Outline Design

## Goal

重构 MuseFlow 的大纲生成与使用方式：`start` 阶段只生成全书的 high-level 章节轮廓（每章 1–2 句话），每章写作前再动态展开为 detailed chapter plan；展开时基于前章实际内容与后章 high-level 意图做边界检查，自动避免前后章节事件重复或提前收尾。

## Background

当前 MuseFlow 在 `start` 阶段由 `OutlineAgent` 直接生成 totalChapters 条详细大纲，保存到 `meta.json`。后续 `write`/`rewrite` 按章写作时只能基于这条静态大纲。问题包括：

1. 前面章节实际生成内容可能与后续大纲冲突（如第 29 章把六耳猕猴封入锦囊，第 30 章大纲仍要求如来辨真假、金钵伏妖）。
2. 一次性生成 40 章详细文本，长程一致性难以保证。
3. 大纲无法根据已写正文动态调整，导致漂移累积。
4. 对超长故事/连载不友好，必须一开始定死全书细节。

## Architecture

引入两层大纲：

- **High-level outline（chapter arcs）**：由 `start` 生成，每章包含 number、title、description（1–2 句话）。作为全书骨架，不直接用于写作。
- **Detailed chapter plan**：每章写作前由 `ChapterPlannerAgent` 根据当前章 high-level arc + 前章摘要/状态 + 下章 high-level arc 临时生成。用于本章正文生成。

新增 `OutlineExpander` 模块负责：

1. 读取 high-level outline 与当前故事状态。
2. 执行边界检查：若当前章 arc 与下一章 arc 存在事件重叠或前后冲突，生成修正提示。
3. 调用 `ChapterPlannerAgent` 生成 `ChapterPlan`。

`draft_chapter` 不再直接读取 `state.outline[chapterIndex].description` 作为写作依据，而是调用 `OutlineExpander` 获得 detailed plan 和边界提示后再交给 `ChapterAgent`。

## Data Model Changes

### ChapterOutline

现有 `ChapterOutline` 保留为 high-level arc：

```ts
interface ChapterOutline {
  id: string
  number: number
  title: string
  description: string // 1–2 句话的 arc
}
```

### ChapterPlan

现有 `ChapterPlan` 继续作为 detailed plan：

```ts
interface ChapterPlan {
  sections: ChapterPlanSection[]
}
```

不需要新增类型，但 `state.chapterPlan` 的含义从「可选缓存」变为「每章写作前必须生成的临时计划」。

### Storage

- `meta.json` 中 `outline` 字段仍保存 high-level outline。
- detailed plan 不落盘，只存在于单次写作的内存状态中。

## Component Design

### 1. HighLevelOutlineAgent

替代现有 `OutlineAgent` 的职责，生成更短的章节弧线。

- 输入：idea、genre、totalChapters、world、characters
- 输出：high-level outline
- prompt 调整：明确要求每条 description 控制在 30–60 字，只写核心转折，不写细节执行。

### 2. OutlineExpander

新模块，路径建议 `src/core/outline-expander.ts`。

职责：

- 接受 `state: ReducedGraphState` 和 `chapterIndex`
- 构造 `ChapterPlannerAgent` 的输入：
  - 当前章 high-level arc
  - 下一章 high-level arc（作为边界）
  - 前章摘要/状态
  - 边界检查提示
- 调用 `plan_chapter` 获得 `ChapterPlan`
- 返回 `{ chapterPlan: ChapterPlan, boundaryHints: string[] }`

### 3. ChapterPlannerAgent

现有 `ChapterPlannerAgent` 的 prompt 需要增强：

- 输入中增加 `nextChapterArc`
- prompt 中增加：「本章 detailed plan 必须服务于当前 high-level arc，同时为 nextChapterArc 预留空间，不得提前完成 nextChapterArc 中的事件」

### 4. ChapterAgent

- prompt 中 `outline` 字段改为「当前章 high-level arc + detailed plan + boundary hints」
- 已有 `outlineComplianceSection` 已支持边界提示

### 5. formatChapterOutlineForAgent

从 `src/graph/nodes.ts` 中拆分或重构：

- 输入：state, chapterIndex, chapterPlan, boundaryHints
- 输出：组合后的 outline 字符串给 `ChapterAgent`

## Flow Changes

### start

```
idea -> world -> characters -> HighLevelOutlineAgent -> outline (high-level)
```

### write / rewrite per chapter

```
1. load state
2. OutlineExpander(chapterIndex) -> detailed plan + boundary hints
3. draft_chapter(plan, hints) -> content
4. validation pipeline
5. finalize
```

## Backward Compatibility

- 旧项目中的 `meta.json` 已有详细大纲。需要检测：
  - 如果 outline 描述过长或包含多个事件，视为旧详细大纲。
  - 提供兼容路径：直接用作 high-level arc，或自动压缩。
- 新增配置项 `outlineStrategy: 'layered' | 'legacy'`，默认 `'layered'`。
- 旧项目未配置时，自动使用 legacy 模式，避免破坏既有故事。

## Testing Strategy

1. 单元测试 `OutlineExpander`：
   - 输入包含冲突 arc，输出包含修正边界提示
   - 输入正常 arc，输出普通边界提示
2. 单元测试 `HighLevelOutlineAgent`：
   - 生成 description 不超过 60 字
3. 集成测试 `draft_chapter`：
   - 使用 layered outline 时调用 `OutlineExpander`
   - 使用 legacy outline 时保持原行为
4. 端到端测试：
   - 模拟类似 29/30 章冲突场景，验证 detailed plan 不会要求重复处理

## Migration

- 新创建的故事自动使用 layered outline。
- 现有故事通过配置项保留原行为，可手动切换。

## Open Questions

1. 是否需要把 high-level outline 也暴露给 `verify_outline_compliance`？目前该节点仍检查 detailed plan 是否覆盖当前章 high-level arc。
2. 用户是否可以在 `start` 后手动编辑 high-level arc？编辑后 detailed plan 如何同步？
3. 长连载如何分卷？high-level outline 是否允许后续再追加？
