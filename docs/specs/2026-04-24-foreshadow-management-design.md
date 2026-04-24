# 伏笔管理系统设计

> 日期：2026-04-24
> 状态：已实现

## 1. 概述

MuseFlow 的伏笔管理系统负责在故事撰写过程中检测、跟踪和回收伏笔，确保故事中的悬念得到妥善管理和最终揭示。

## 2. 数据结构

### 2.1 ForeshadowItem 接口

```typescript
interface ForeshadowItem {
  id: string
  text: string                    // 伏笔文本内容
  expectedFulfillChapter: number  // 预期回收章节
  createdAt: number              // 创建时间戳
  fulfilledChapter?: number      // 实际回收章节（如果已回收）
}
```

### 2.2 GraphState 中的伏笔栈

```typescript
foreshadowStack: Annotation<ForeshadowItem[]>
```

伏笔栈存储在 GraphState 中，容量限制为 20 条。

## 3. 伏笔检测流程

### 3.1 流程图

```
draft_chapter → validate_chapter → quality_pass → detect_foreshadowing → detect_hallucination → detect_consistency → verify_outline_compliance → auto_fix_warnings
```

### 3.2 detect_foreshadowing 节点

**位置：** 质量检测流程的第 3 步

**职责：**
1. 检测本章新埋的伏笔
2. 检测已埋伏笔是否在本章被回收
3. 标记逾期未回收的伏笔

### 3.3 ForeshadowingAgent

**输入：**
- `chapterContent` - 当前章节内容
- `foreshadowStack` - 已埋伏笔列表（用于检测回收）

**输出：**
```json
{
  "new_foreshadows": [...],
  "fulfilled_foreshadows": ["伏笔1", "伏笔2"],
  "overdue_foreshadows": ["伏笔3"]
}
```

## 4. 伏笔回收机制

### 4.1 AI 检测回收

LLM 分析当前章节内容，判断已埋伏笔是否在本章得到呼应或揭示。

### 4.2 强制回收

超过预期回收章节 3 章仍未回收的伏笔，自动标记为已回收。

```typescript
const isOverdue = currentChapter > item.expectedFulfillChapter + 3
if (isOverdue) {
  return { ...item, fulfilledChapter: currentChapter }
}
```

### 4.3 LLM 提醒回收

在 `draft_chapter` 时，将未回收伏笔列表传递给 LLM，提醒在写作时自然回收。

```typescript
const foreshadowSection = state.foreshadowStack && state.foreshadowStack.length > 0
  ? `【伏笔回收提醒】以下伏笔需要在本章或后续章节中回收：
${state.foreshadowStack.filter(f => !f.fulfilledChapter).map((f, i) => `${i + 1}. "${f.text}"（预期第${f.expectedFulfillChapter}章回收）`).join('\n')}`
  : ''
```

## 5. 容量管理

### 5.1 容量限制

伏笔栈最大容量为 20 条。

### 5.2 优先级排序

当容量超限时，未回收伏笔 > 已回收伏笔 > 新伏笔。

```typescript
const unfufilled = updatedStack.filter(item => !item.fulfilledChapter)
const fulfilled = updatedStack.filter(item => item.fulfilledChapter)
const merged = [...unfufilled, ...fulfilled, ...newItems]
return merged.slice(0, 20)
```

## 6. 持久化

### 6.1 存储位置

伏笔状态存储在故事的 `meta.json` 中：

```json
{
  "foreshadowStack": [
    { "id": "...", "text": "...", "expectedFulfillChapter": 8, "createdAt": 1234567890, "fulfilledChapter": 10 }
  ]
}
```

### 6.2 保存时机

每章完成后 `finalize_chapter` 节点调用 `saveForeshadowStack()` 持久化当前状态。

### 6.3 恢复机制

`write` / `rewrite` 命令执行时，`getState()` 从 `meta.json` 加载伏笔状态，恢复到 GraphState 中。

## 7. 文件结构

```
src/
├── graph/
│   ├── state.ts              # ForeshadowItem 接口定义
│   └── nodes.ts              # detect_foreshadowing 节点实现
├── agents/
│   └── foreshadowing.ts      # ForeshadowingAgent 实现
├── storage/
│   └── database/
│       ├── index.ts          # StoryMeta.foreshadowStack 定义
│       └── dao/
│           └── timeline.ts   # saveForeshadowStack / getForeshadowStack
└── core/
    └── runner.ts             # getState 中伏笔恢复逻辑
```

## 8. 相关命令

| 命令 | 说明 |
|------|------|
| `museflow write <storyId>` | 撰写章节时自动检测和回收伏笔 |
| `museflow rewrite <storyId>` | 重写时保留伏笔上下文 |
| `museflow info <storyId>` | 显示伏笔状态信息 |

## 9. 日志输出

```
[MuseFlow] 步骤 3/7: 检测伏笔...
[MuseFlow] 伏笔回收: 本章回收 2 个伏笔
[MuseFlow] 伏笔逾期: 1 个伏笔超过预期章节仍未回收，已自动标记
```

## 10. 设计决策

### 10.1 为什么伏笔状态要持久化？

LangGraph checkpointer 只保留最近 5 个 checkpoint，如果 checkpoint 被清理，已有的伏笔会丢失。将伏笔状态持久化到 `meta.json` 确保即使 checkpointer 被清理，伏笔数据也不会丢失。

### 10.2 为什么已回收的伏笔要保留？

已回收的伏笔保留在 stack 中可以：
1. 避免重复检测（已回收的不会再次被检测）
2. 提供历史记录（知道哪些伏笔被回收了）

### 10.3 为什么容量限制 20 条？

20 条是一个合理的平衡值：
- 足够跟踪一个中等篇幅故事的伏笔
- 不会因为过多伏笔导致 LLM 上下文膨胀
- 已回收的伏笔可以占据部分空间，未回收的始终优先