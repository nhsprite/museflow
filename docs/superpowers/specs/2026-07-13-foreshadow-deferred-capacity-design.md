# 顺延伏笔的幕容量协调设计

## 背景

伏笔调度器会按 `foreshadowMaxFulfillmentsPerChapter` 选择本章候选，ChapterOutline
Agent 再把每个候选裁决为本章回收或顺延。当前写前幕容量计算默认本章会消耗完整容量；如果
Agent 将候选放入 `deferredForeshadowIds`，幕边界仍保持不变。finalize 随后严格阻断期限不晚于
幕边界的 required 未回收伏笔，于是形成“规划允许顺延、定稿必然失败”的契约冲突。

## 目标

1. 保留大纲对候选伏笔的自然性裁决，不强制伪造回收。
2. 保留 finalize 的严格幕边界不变量。
3. 在正文起草前，为本章顺延后剩余的到期伏笔重新预留未来章节容量。
4. 复用现有幕边界调整及安全上限，不直接修改任何 `books/` 数据。
5. 所有控制流只使用稳定 ID、章节号、布尔值和配置容量。

## 设计

### 剩余容量计算

在 `story-arc.ts` 增加纯函数，输入当前故事弧、当前 0-based 章节索引、StoryMemory、单章容量及
本章计划回收的稳定伏笔 ID。它从共享的 `getRequiredForeshadowsForScheduling` 获取当前幕边界前
必须回收的伏笔，并排除本章已经声称回收的 ID。

剩余可用槽位只计算当前章之后、当前幕结束之前的章节：

```text
futureSlots = candidateEndChapter - currentChapterNumber
requiredSlots = ceil(remainingBlockingCount / capacity)
```

若 `requiredSlots > futureSlots`，将候选边界推进到
`currentChapterNumber + requiredSlots`，并重新计算新边界是否跨过更多有限 deadline，直到收敛。
最终幕继续把所有 required 未回收伏笔纳入容量计算。

本章的回收声明只用于容量预留，不写入 StoryMemory；只有正文中带证据的
`foreshadow-fulfill` 事件才能真正更新 `fulfilledIn`。

### 大纲与规划集成

`outline-expander.ts` 在大纲完成候选裁决后运行一次剩余容量协调。若大纲顺延导致原幕容量不足，
立即通过现有 `applyActBoundaryAdjustment` 延长当前幕，并同步 `storyArc`、`totalChapters`、story、
outline scaffold 和 chapter scaffold，再生成 ChapterPlan。

章节规划重试耗尽时，现有逻辑会把无法提供结构化证据的回收声明改为顺延。该状态变化后再运行
一次相同容量协调，覆盖规划阶段新产生的顺延。若第二次调整改变幕边界，返回给正文 Agent 的边界
提示必须基于更新后的故事弧重新计算。

### 安全边界

幕延长继续受到单次、单幕累计及全书累计自动延长上限约束。所需容量超过上限时，在正文起草前
抛出包含 `adjust-act` 命令的明确错误，不再消耗正文和摘要模型调用。

finalize 的 `foreshadow_boundary_unresolved` 校验保持不变，继续捕获“计划声称回收但正文没有有效
证据”等真正的提交前违规。

## 测试

- 纯策略：幕末三个候选全部顺延时建议延长一章。
- 纯策略：本章已声明回收的 ID 不占未来槽位。
- 纯策略：边界推进跨过新 deadline 时进行固定点重算。
- outline-expander：幕末 JIT 大纲顺延候选后，在规划调用前同步延长后的故事弧。
- outline-expander：规划证据重试耗尽并自动顺延后，同样扩展边界并刷新返回提示。
- 安全上限：已耗尽自动扩展预算时提前返回人工调整错误。

## 成功标准

- 示例中的第 41 章若顺延三个到期伏笔，会先将第 3 幕扩展至少一个容量槽位，而不是在 finalize
  才产生三个必然错误。
- 若正文确实回收计划中的伏笔，幕边界不会被无谓延长。
- 若正文未兑现已声明的回收，finalize 仍严格阻断。
- 不新增任何基于故事文本或问题描述的语义匹配。
