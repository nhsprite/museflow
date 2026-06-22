# MuseFlow Auto-Fix 输出校验与修复路径重构设计

## 1. 背景与问题

在 `rewrite story_mqoope2735602be08dfa` 第 4 章时，系统经历了三次重写循环：

1. 第一次完整起草后，质量与一致性检查报出多个 error 和 warning。
2. 第二次尝试进入段落级修复，但受影响段落过多（60/142），回退到 `runLegacyFix` 完整重写。
3. 第三次尝试在 `auto_fix_warnings` 阶段，再次因 warning 触发 `runLegacyFix`，模型将抽象的 quality warning 理解为"修改建议"，输出了一段"作者修改计划"而非正文。
4. 该输出被直接写入 `chapter_4.md`，导致字数仅 203 字，并触发 `word_count` 和 `outline_violation` error，最终失败。

根因不是某个单一 agent 的幻觉，而是 `FixAgent` 的 legacy 修复模式被错误地用于处理抽象 quality warning，且输出缺少内容形态校验。

## 2. 目标

- 防止抽象/风格类 quality warning 通过 FixAgent 产生非正文输出。
- 让 FixAgent 的完整重写输出受结构化格式约束，并具备可靠校验。
- 明确 `fix_chapter` 与 `auto_fix_warnings` 的职责边界：只有可精确定位、可 patch 的问题才走 FixAgent；抽象写作问题应作为下一轮完整重写的输入提示。
- 当 auto-fix 失败时，安全回退，不把畸形输出写进章节文件。

## 3. 设计方案

### 3.1 职责边界重构

| 问题类型 | 修复路径 | 说明 |
|---------|---------|------|
| consistency / hallucination error（跨章节事实错误） | 段落级修复优先；影响过大时完整重写 | 可定位、可 patch |
| local error（字数不足、具体事实矛盾） | 完整重写 | 由 `draft_chapter` 处理 |
| quality / style warning（情感层次、节奏、人物单薄） | **不走 FixAgent**，转为下一轮 `draft_chapter` 的 `issuesSection` 输入 | 抽象写作指导，需要作家重新组织叙事 |
| outline_violation / timeline_mismatch 等结构性 error | 完整重写 | 已在现有流程中处理 |

`auto_fix_warnings` 不再无条件调用 `fix_chapter`。它只应处理那些：

- severity 为 warning
- type 为 `consistency` 或 `hallucination`（或可精确定位的具体 quality 问题）
- 能够通过段落/句子级 patch 解决的问题

抽象的 `quality` warning（如文笔、节奏、人物刻画）由下一轮 `draft_chapter` 处理。

### 3.2 FixAgent 结构化输出约束

为 `runLegacyFix`（完整重写模式）增加强制输出格式：

```text
=== FIXED_CHAPTER ===
# 第X章 章节标题
（正文内容，段落之间用空行分隔）
=== END_FIXED_CHAPTER ===
```

`FixAgent.parse()` 按以下规则解析：

1. 优先匹配 `=== FIXED_CHAPTER ===` 与 `=== END_FIXED_CHAPTER ===` 之间的内容。
2. 如果未找到结束标记，则匹配 `=== FIXED_CHAPTER ===` 之后的全部内容。
3. 提取内容后，去除首尾空白。
4. 将 `output.content` 设为提取后的正文。

### 3.3 输出形态校验层

新增 `validateFixedChapterContent(content: string, chapterIndex: number, options: ValidationOptions): ValidationResult` 函数，在 `runLegacyFix` 和 `runParagraphFix` / `runSentenceFix` 的回退路径中调用。

校验项：

1. **非空**：内容不能为 `null`、空字符串或仅空白。
2. **章节标题存在**：必须包含 `# 第X章` 或 `## 第X章：标题` 形式的标题。
3. **字数达标**：中文字符数不低于 genre 配置的 `chapterWordCountMin`（默认 1500）。
4. **非修改计划形态**：内容不能主要由"建议"、"应该"、"可以"、"问题分析"、"修复方案"等指导性语言构成。使用关键词集合与启发式规则检测。
5. **无预写检查表残留**：不包含 `预写对齐检查表`、`自检清单`、`| 检查项 |` 等 ChapterAgent 的检查表残留标记。

如果校验失败：

- 不写入章节文件。
- 返回 `{ valid: false, error: '具体原因' }`。
- 调用方根据上下文决定是重试、放弃 auto-fix，还是升级为 error。

### 3.4 auto_fix_warnings 失败回退

`auto_fix_warnings` 的执行流程调整为：

1. 过滤 warnings：只保留 `consistency` / `hallucination` 类型，或明确带有段落/句子位置的 `quality` warning。
2. 如果没有可处理的 warning，直接返回 `{ autoFixAttempts: attempts, pendingIssues: state.pendingIssues }`。
3. 调用 `fix_chapter`。
4. 如果 `fix_chapter` 返回失败或输出校验失败：
   - 记录警告日志。
   - **不覆盖**原 `pendingIssues`。
   - 返回 `{ autoFixAttempts: attempts + 1, pendingIssues: state.pendingIssues }`。
5. 如果成功，返回 `{ ...fixResult, pendingIssues: [], autoFixAttempts: attempts + 1 }`。

### 3.5 抽象 quality warning 进入下一轮重写

在 `executeChapterGeneration` 的主循环中，当本轮因 error 需要再次重写时：

- 本轮未被清空的 `quality` warning 仍然保留在 `workingState.pendingIssues` 中。
- 下一轮 `draft_chapter` 的 `issuesSection` 会自然接收这些 warning，作为 ChapterAgent 重新起草时的提示。
- 这样抽象写作问题由完整重写解决，而不是被 patch。

注意：此处不是新增 warning，而是确保 `auto_fix_warnings` 失败回退后不会把它们清空。

## 4. 数据流

```text
[校验流水线] → pendingIssues
                ↓
        [auto_fix_warnings]
                ↓
    过滤可 patch 的问题
                ↓
      ┌─────────┴─────────┐
   无匹配              有可 patch 问题
      ↓                      ↓
  保留 warnings      调用 fix_chapter
      ↓                      ↓
  等待下次 draft    [结构化输出 + 形态校验]
                            ↓
                    成功 → 写入文件，清空 warnings
                            ↓
                    失败 → 保留 warnings，不写入文件
```

## 5. 关键改动文件

| 文件 | 改动 |
|------|------|
| `src/agents/fix.ts` | `buildLegacyPrompt` 增加 `=== FIXED_CHAPTER ===` 输出格式要求；`parse()` 按标记提取内容 |
| `src/graph/nodes.ts` | `runLegacyFix` 调用新增校验函数；`fix_chapter` 的 warning 分支调整；`auto_fix_warnings` 增加过滤与失败回退 |
| `src/core/chapter-generation.ts` | 主循环中把未处理的 quality warning 带入下一轮 `draft_chapter` |
| 新增 `src/utils/chapter-content-validation.ts` | 输出形态校验函数 |

## 6. 接口设计

### 6.1 `validateFixedChapterContent`

```typescript
export interface ValidationOptions {
  chapterIndex: number
  minWordCount?: number
  maxWordCount?: number
}

export interface ValidationResult {
  valid: boolean
  content?: string
  error?: string
}

export function validateFixedChapterContent(
  rawContent: string,
  options: ValidationOptions
): ValidationResult
```

### 6.2 `auto_fix_warnings` 返回语义不变

仍然返回 `Partial<ReducedGraphState>`，但当修复失败时 `pendingIssues` 不被清空。

## 7. 测试策略

- 单元测试 `validateFixedChapterContent`：
  - 正常章节内容通过
  - 修改计划文本失败
  - 无标题失败
  - 字数不足失败
  - 检查表残留失败
- 单元测试 `fix_chapter`：
  - quality warning 被过滤，不触发 FixAgent
  - consistency warning 触发段落修复
  - 失败时保留 pendingIssues
- 集成测试：模拟一次 abstract quality warning 的 rewrite 流程，验证最终不写入畸形内容。

## 8. 风险与回退

- **模型适应性**：部分模型可能不严格遵守 `=== FIXED_CHAPTER ===` 标记。对策：在 `FixAgent.parse()` 中保留宽松的 fallback，但如果 fallback 提取的内容未通过形态校验，仍视为失败。
- **误伤正常内容**："修改计划"检测是启发式的，可能误伤角色对话。对策：使用多指标组合（情态动词密度、列表符号、第二人称/祈使句比例），不依赖单一关键词。
- **用户体验变化**：抽象 quality warning 不再被自动 patch，可能导致某些 chapter 需要多一轮完整重写。但这是正确行为，避免产生更糟的畸形输出。

## 9. 验收标准

- [ ] `FixAgent` 完整重写模式输出必须包含 `=== FIXED_CHAPTER ===` 标记。
- [ ] `runLegacyFix` 写入文件前必须通过 `validateFixedChapterContent`。
- [ ] `auto_fix_warnings` 不再对抽象 `quality` warning 调用 `fix_chapter`。
- [ ] 当 auto-fix 输出校验失败时，原 `pendingIssues` 被保留，畸形内容不写入文件。
- [ ] 下一轮 `draft_chapter` 的 prompt 中能看到未处理的 quality warning。
- [ ] 所有现有测试通过，新增测试覆盖上述场景。
