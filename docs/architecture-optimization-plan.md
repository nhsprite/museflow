# MuseFlow 架构优化方案：解决跨章节数据一致性

## 问题诊断

### 症状
第27章 rewrite 反复失败，核心错误：
1. "木之灵物在东方灵河旧址"（第18章摘要）vs "木之灵物在昆仑山"（第25-28章大纲）
2. 角色位置陈旧（宝钗仍在潇湘馆，但应已西行）
3. 伏笔管理混乱（创建与回收时机错位）

### 根本原因
系统存在**四个独立的数据源**，它们可以互相矛盾：

| 数据源 | 内容 | 可变性 | 当前问题 |
|--------|------|--------|----------|
| **大纲 (outline)** | 未来章节规划 | 只增不改 | 第25章更新灵物位置 |
| **章节摘要 (chapterSummaries)** | 过去章节压缩记录 | 永久不变 | 第18章记录旧位置 |
| **故事状态 (storyState)** | 结构化状态 | 追加式更新 | 已被代码修复 |
| **时间线快照 (timelineSnapshot)** | 从摘要构建 | 运行时生成 | 使用旧摘要数据 |

**核心矛盾**：大纲更新了事实，但章节摘要永久记录了旧事实，ConsistencyAgent 用旧摘要检查新内容。

## 优化方案

### 方案A：权威事实层（Canonical Facts）⭐ 推荐

#### 设计
在 `storyState` 中添加 `canonicalFacts` 字段，显式追踪哪些事实覆盖了旧事实：

```typescript
interface CanonicalFact {
  id: string
  subject: string      // 主题：如"木之灵物"
  attribute: string    // 属性：如"所在位置"
  value: string        // 值：如"昆仑山西王母处"
  establishedIn: number // 确立章节
  supersedes?: Array<{
    chapter: number
    oldValue: string
  }>
}
```

#### 工作流程

1. **SummaryAgent 提取事实**
   ```
   第25章摘要提取时：
   - 新事实：木之灵物在昆仑山西王母处
   - 检测到与第18章矛盾：覆盖"东方灵河旧址"
   - 输出 canonicalFact：
     {
       subject: "木之灵物",
       attribute: "所在位置", 
       value: "昆仑山西王母处",
       establishedIn: 25,
       supersedes: [{chapter: 18, oldValue: "东方灵河旧址"}]
     }
   ```

2. **mergeStoryState 处理覆盖**
   ```typescript
   function mergeCanonicalFacts(
     existing: CanonicalFact[], 
     delta: CanonicalFact[]
   ): CanonicalFact[] {
     const merged = [...existing]
     for (const newFact of delta) {
       // 移除被覆盖的旧事实
       merged.push(newFact)
     }
     return merged
   }
   ```

3. **buildCharacterFactTimeline 过滤旧事实**
   ```typescript
   function buildCharacterFactTimeline(state, upToChapterIndex) {
     const rawTimeline = buildFromSummaries(state, upToChapterIndex)
     const superseded = getSupersededFacts(state.canonicalFacts)
     return filterSuperseded(rawTimeline, superseded)
   }
   ```

#### 优点
- 显式追踪事实演进
- 不修改历史章节文本
- 自动解决大纲 vs 旧摘要矛盾
- 通用，不依赖特定故事

#### 缺点
- 需要修改 SummaryAgent prompt
- 增加存储复杂度

### 方案B：时间线快照增强过滤

#### 设计
不改存储结构，只在 `buildCharacterFactTimeline` 阶段做过滤：

```typescript
function buildCharacterFactTimeline(state, upToChapterIndex) {
  // 1. 从摘要构建原始时间线
  const rawTimeline = buildFromSummaries(...)
  
  // 2. 从当前及后续大纲提取"当前有效事实"
  const outlineFacts = extractFactsFromOutline(
    state.outline, 
    upToChapterIndex
  )
  
  // 3. 过滤掉与大纲矛盾的旧摘要
  const filteredTimeline = rawTimeline.filter(fact => {
    const outlineFact = outlineFacts.find(f => f.subject === fact.subject)
    if (outlineFact && outlineFact.value !== fact.value) {
      // 旧事实被大纲覆盖，跳过
      return false  
    }
    return true
  })
  
  return filteredTimeline
}
```

#### 优点
- 实现简单，不改存储
- 立即可见效

#### 缺点
- 不是真正修复，只是隐藏问题
- 每次都要重新过滤，性能开销
- 无法处理大纲没提到的隐式矛盾

### 方案C：ConsistencyAgent Prompt 修复

#### 设计
修改一致性检查 prompt，添加规则：

```xml
<rule type="outline_authority">
  大纲优先原则：
  1. outline 是最高权威。如果 outline[第N章] 更新了某个设定，
     而第N章之前的章节有不同的设定，这是正常的情节演进，不是矛盾。
  2. 只有当角色对"已被大纲覆盖的旧事实"表现出不合理的态度时，
     才报 consistency error。
  3. 不要将被大纲明确覆盖的旧事实作为检查当前章节的依据。
</rule>
```

#### 优点
- 零代码改动
- 快速见效

#### 缺点
- LLM 可能不严格遵守规则
- 治标不治本
- 对非大纲导致的矛盾无效

### 方案D：章节摘要自动修正

#### 设计
当系统确认某个事实被覆盖后，自动更新旧摘要：

```typescript
function correctOutdatedSummaries(
  summaries: string[],
  canonicalFacts: CanonicalFact[]
): string[] {
  return summaries.map((summary, idx) => {
    let corrected = summary
    for (const fact of canonicalFacts) {
      for (const old of fact.supersedes || []) {
        if (old.chapter === idx + 1) {
          // 在旧摘要中添加修正注释
          corrected = summary.replace(
            old.oldValue,
            `${old.oldValue}（后于第${fact.establishedIn}章更新为${fact.value}）`
          )
        }
      }
    }
    return corrected
  })
}
```

#### 优点
- 一劳永逸，旧摘要永久修正
- ConsistencyAgent 看到标注后不再报错

#### 缺点
- 修改历史数据，违反只读原则
- 摘要文本修改可能影响其他依赖

## 推荐实施路径

### 第一阶段（本周）：Prompt 修复 + 增强过滤

1. **修改 ConsistencyAgent prompt**（方案C）
   - 添加大纲优先原则
   - 将"大纲 vs 旧摘要"矛盾从 error 降级为 warning

2. **增强 reconcileStoryState**（方案B的简化版）
   - 不仅过滤 revealedSecrets，还过滤 characterLocations
   - 根据 outline 关键词判断哪些旧位置/事实已过时

3. **清理当前 story 的 stale 数据**
   - 在 runner.ts 中，rewrite 模式时重建 storyState

### 第二阶段（2周内）：权威事实层

1. 添加 `CanonicalFact` 类型
2. 修改 `SummaryAgent` prompt，要求输出 canonical facts
3. 修改 `mergeStoryState` 处理事实覆盖
4. 修改 `buildCharacterFactTimeline` 使用 canonical facts 过滤

### 第三阶段（1个月）：摘要自我修正

1. 实现 `correctOutdatedSummaries`
2. 添加事实演进可视化
3. 提供 CLI 命令查看和管理 canonical facts

## 对当前第27章的立即修复

在当前架构约束下，最可行的修复是**方案B + 方案C的组合**：

1. **代码层面**：增强 `reconcileStoryState`，更 aggressively 地清理过时事实
2. **Prompt 层面**：让 ConsistencyAgent 理解"大纲覆盖"是正常演进
3. **数据层面**：在 rewrite 时，根据大纲重建角色位置（而非使用旧 checkpoint 数据）

这样可以在不重构存储架构的情况下，解决 80% 的跨章矛盾问题。
