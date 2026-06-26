# MuseFlow 叙事状态协调实施方案

## 目标
将“前文已确立事实 vs 后续大纲要求”的冲突管理从隐式错误循环升级为显式、可审计、可自动协调的流程。

## 总体策略
采用**渐进式改造**：先在现有 `reconcileStoryState` 基础上扩展为返回协调报告，再逐步加入自动协调规则、CLI 工具和状态压缩。不一次性重构整个状态系统。

## Phase 1: 类型与接口重构（当前会话完成）

### 1.1 扩展类型定义
**文件**: `src/types/story-state.ts`

新增：
- `StateOverride` 接口
- `Conflict` 联合类型（`retcon | extension | time_jump | alias | contradiction | incomplete`）
- `ReconciliationReport` 接口
- 扩展 `StoryState` 可选字段 `overrides?: StateOverride[]`

### 1.2 改造 `reconcileStoryState` 返回报告
**文件**: `src/graph/utils/story-state.ts`

当前 `reconcileStoryState` 返回 `StoryState`。改造为返回 `ReconciliationReport`：
```typescript
export function reconcileStoryState(...): ReconciliationReport
```

保持内部已有逻辑：
- 字符别名归一化（characterLocations / characterStatus）
- revealedSecrets 与大纲重叠过滤
- 保留 canonicalFacts / supersededFacts

新增报告中字段：
- `state`: 协调后的 `StoryState`
- `conflicts`: 当前检测到的冲突列表（第一阶段可为空数组）
- `autoResolved`: 空数组
- `requiresAuthorDecision`: 空数组

### 1.3 更新所有调用点
**文件**: `src/graph/nodes/planning.ts`, `src/graph/nodes/draft.ts`

将调用改为：
```typescript
const report = reconcileStoryState(state.storyState, outlineItem.description, state.characters, chapterIndex)
let reconciledState = report.state
```

### 1.4 回归测试
**文件**: 相关测试文件
- 确保现有调用点行为不变
- `npm test` 全量通过

## Phase 2: 冲突检测模块（当前会话完成）

### 2.1 新建冲突检测器
**文件**: `src/core/state-reconciliation/conflict-detector.ts`

实现通用检测函数，不硬编码具体故事元素：
- `detectItemLocationConflicts(state, outline)`：扫描 `keyItemsLocation`，从大纲中提取该物品位置变化
- `detectItemStateConflicts(state, outline)`：扫描 `keyItemsState`
- `detectCharacterLocationConflicts(state, outline)`：扫描 `characterLocations`
- `detectCharacterStatusConflicts(state, outline)`：扫描 `characterStatus`
- `detectSecretRevealConflicts(state, outline)`：检查大纲要求首次揭示的秘密是否已在 `revealedSecrets`
- `detectTimeAnchorConflicts(state, outline, chapterIndex)`：检查时间推进是否合理

提取规则基于正则模式，例如：
- 位置模式：`[物品] (?:在|到|被送至|被藏于|被转移至) [地点]`
- 状态模式：`[物品] (?:已|被) (?:毁|碎|焚|激活|封印|丢失)`
- 时间模式：`(?:三日后|次日|翌日|又过了.*天)`

### 2.2 新建冲突分类器
**文件**: `src/core/state-reconciliation/conflict-classifier.ts`

根据冲突特征分配类型和严重程度：
- `alias`：canonical 名称相同 → `auto`
- `retcon`：大纲明确更新旧事实 → `auto`（位置/状态）或 `warning`（核心身份）
- `time_jump`：时间跨度变化 → `auto`
- `contradiction`：无法共存（角色生死、秘密已揭示又要求未揭示）→ `blocking`
- `incomplete`：信息不足 → `warning`

### 2.3 集成到 `reconcileStoryState`
**文件**: `src/graph/utils/story-state.ts`

调用流程：
```typescript
const sanitized = sanitizeStoryState(storyState, characters)
const rawConflicts = [
  ...detectItemLocationConflicts(sanitized.state, outline),
  ...detectItemStateConflicts(sanitized.state, outline),
  ...detectCharacterLocationConflicts(sanitized.state, outline),
  ...detectCharacterStatusConflicts(sanitized.state, outline),
  ...detectSecretRevealConflicts(sanitized.state, outline),
]
const classified = classifyConflicts(rawConflicts)
return {
  state: sanitized.state,
  conflicts: classified,
  autoResolved: [],
  requiresAuthorDecision: classified.filter(c => c.severity === 'blocking'),
}
```

### 2.4 单元测试
**文件**: `tests/core/state-reconciliation/conflict-detector.test.ts`

覆盖：
- 物品位置变化检测
- 角色位置变化检测
- 秘密重复揭示检测
- 分类器 severity 判断

## Phase 3: 自动协调与权威事实生成（当前会话完成）

### 3.1 新建自动协调器
**文件**: `src/core/state-reconciliation/auto-reconciler.ts`

实现 `autoReconcile(conflicts, state)`：
- 对 `alias` 类型：调用 `canonicalizeItemName` 合并别名
- 对 `retcon` 类型（位置/状态）：
  - 旧值生成 `supersededFact`
  - 新值生成 `canonicalFact`，带 `supersedes` 链
- 对 `time_jump` 类型：更新 `storyTime`，不生成冲突
- 对 `contradiction` 类型：保持不变，交给作者决策
- 对 `incomplete` 类型：降级为 `warning`，不阻塞

### 3.2 权威状态构建
**文件**: `src/core/state-reconciliation/authority-builder.ts`

实现 `buildAuthoritativeState(state, canonicalFacts)`：
- 用 `canonicalFacts` 覆盖 `storyState` 中对应字段
- 被覆盖的旧值不删除，但移入 `supersededFacts`
- 未覆盖的字段保持原值

### 3.3 更新 `reconcileStoryState`
**文件**: `src/graph/utils/story-state.ts`

完整流程：
```typescript
const sanitized = sanitizeStoryState(storyState, characters, options)
const conflicts = detectAllConflicts(sanitized.state, outline, chapterIndex)
const classified = classifyConflicts(conflicts)
const { autoResolved, remaining } = autoReconcile(classified, sanitized.state)
const canonicalFacts = buildCanonicalFacts(autoResolved, state.canonicalFacts ?? [])
const reconciledState = buildAuthoritativeState(sanitized.state, canonicalFacts)
return {
  state: reconciledState,
  conflicts: remaining,
  autoResolved,
  requiresAuthorDecision: remaining.filter(c => c.severity === 'blocking'),
  suggestedOverrides: generateOverrideSuggestions(remaining),
}
```

### 3.4 单元测试
**文件**: `tests/core/state-reconciliation/auto-reconciler.test.ts`

覆盖：
- 别名自动合并
- 物品位置 retcon 生成 canonicalFact + supersededFact
- contradiction 不被自动协调

## Phase 4: 集成到写作流程（当前会话完成）

### 4.1 planning.ts 集成
**文件**: `src/graph/nodes/planning.ts`

- 调用 `reconcileStoryState` 获取报告
- 如果 `requiresAuthorDecision.length > 0`：
  - 非交互模式：把 blocking conflicts 加入 `stateConflicts`，继续规划
- 把 `autoResolved` 中的变化记录到日志
- 使用 `report.state` 作为 `storyStateStr`

### 4.2 draft.ts 集成
**文件**: `src/graph/nodes/draft.ts`

- 复用 planning 阶段已协调的 `state`（通过 graph state）
- 如果仍有未解决冲突，注入 `stateConflicts`

### 4.3 finalize_chapter 保存权威事实
**文件**: `src/graph/nodes/finalization.ts`

- 在 SummaryAgent 提取 storyState 后，调用 `sanitizeStoryState`
- `mergeStoryState` 合并时保持 canonicalFacts 去重
- 保存到 `meta.json`

### 4.4 集成测试
**文件**: `tests/graph/state-reconciliation-integration.test.ts`

覆盖端到端流程：
- 检测到 retcon 冲突 → 自动协调 → planner 看到协调后状态
- 检测到 contradiction → 阻塞 → stateConflicts 注入 prompt

## Phase 5: CLI `reconcile` 命令（后续会话）

### 5.1 新建命令实现
**文件**: `src/cli/commands/reconcile.ts`

支持：
- `museflow reconcile <story-id>`：查看当前章节冲突
- `museflow reconcile <story-id> --chapter <n>`：查看指定章节
- `museflow reconcile <story-id> --override "subject:attribute:newValue" --reason "..."`：声明覆盖
- `museflow reconcile <story-id> --interactive`：交互式处理

### 5.2 持久化覆盖声明
**文件**: `src/storage/database/dao/story-state.ts`

- `saveStateOverrides(storyId, overrides)`
- `getStateOverrides(storyId)`
- 覆盖声明存入 `meta.json`

### 5.3 CLI 集成
**文件**: `src/cli/index.ts`

注册 `reconcile` 命令。

### 5.4 CLI 测试
**文件**: `tests/cli/reconcile.test.ts`

## Phase 6: 状态压缩（后续会话，可选）

### 6.1 状态压缩器
**文件**: `src/core/state-reconciliation/state-compactor.ts`

功能：
- 合并所有 canonical 别名
- 归档旧的 `supersededFacts`
- 清理被 `canonicalFacts` 完全覆盖的 `storyState` 条目

### 6.2 CLI 命令扩展
- `museflow reconcile <story-id> --compact`：手动压缩
- 或在 `continue` / `write` 时自动触发（每 N 章）

## 关键文件变更清单

| 文件 | 变更类型 |
|------|----------|
| `src/types/story-state.ts` | 扩展类型 |
| `src/graph/utils/story-state.ts` | 重构 `reconcileStoryState` |
| `src/utils/story-state-validation.ts` | 可能被调用方式微调 |
| `src/core/state-reconciliation/*.ts` | 新增模块 |
| `src/graph/nodes/planning.ts` | 集成协调报告 |
| `src/graph/nodes/draft.ts` | 集成协调报告 |
| `src/graph/nodes/finalization.ts` | 保存权威事实 |
| `src/cli/commands/reconcile.ts` | 新增命令 |
| `src/cli/index.ts` | 注册命令 |
| `tests/core/state-reconciliation/*.test.ts` | 新增测试 |
| `tests/graph/state-reconciliation-integration.test.ts` | 新增测试 |
| `tests/cli/reconcile.test.ts` | 新增测试 |

## 验收标准

1. `npm run typecheck` 通过
2. `npm run lint` 通过
3. `npm test` 全量通过，新增测试覆盖：
   - 冲突检测
   - 冲突分类
   - 自动协调
   - 权威状态构建
   - 与 planning/draft 集成
4. 不硬编码任何具体故事元素
5. 不修改 `books/` 目录
6. 失败章节仍不污染 `storyState`

## 实施顺序

本计划建议在当前会话完成 **Phase 1-4**，即核心协调逻辑和写作流程集成。Phase 5-6 作为后续增强，可在后续会话中实施。
