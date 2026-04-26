import { BaseAgent, type AgentState, type AgentOutput } from './base.js'
import type { ChapterMeta } from '../types/chapter.js'
import { generateId } from '../utils/id.js'
import { toDisplayChapterNumber } from '../utils/chapter-display.js'

export class FixAgent extends BaseAgent {
  constructor() {
    super(undefined, 0.5)
  }

  protected buildPrompt(state: Required<AgentState>): import('../model/provider.js').Message[] {
    const chapterIndex = state.chapterIndex ?? 0
    const displayChapterNumber = toDisplayChapterNumber(chapterIndex)

    const issuesSection = state.issues && state.issues.length > 0
      ? `【必须修复的问题】
${state.issues.map((issue, i) => `${i + 1}. [${issue.type}] ${issue.description}${issue.location ? `\n   位置: ${issue.location}` : ''}`).join('\n')}`
      : ''

    const existingChapterSection = state.chapterContent
      ? `【当前章节正文】（请仅修改与上述问题相关的部分，保留所有其他内容不变）：
${state.chapterContent}`
      : ''

    const userContent = `请对第 ${displayChapterNumber} 章进行针对性修复。

${issuesSection}

${existingChapterSection}

【修复策略】
1. 先分析每个问题的根因，找出最简洁的修复方式
2. 优先使用"补充说明""调整措辞"等最小改动，避免大幅重写段落
3. 修改时必须考虑对全文逻辑的影响，确保不引入新的时间线、空间或因果矛盾
4. 如果多个问题指向同一段落，请一次性综合修复，避免反复修改同一处

【硬性约束 — 违反任何一条即不合格】
1. 只修改与上述问题直接相关的段落或句子
2. 保留所有未涉及问题的原文内容，不得删减、改动或重新组织
3. 宁可少改，不要多改。如果你不确定某个句子是否需要修改，不要修改它
4. 修复后的内容必须与大纲、世界观、人物设定保持一致
5. 保持原文的语言风格、叙事节奏和人物语气
6. 不得引入新的角色、地点、物品、时间线或因果关系

【输出格式】
先列出你修改了哪些句子（原句 → 修改后），然后输出完整的章节正文。

请输出修复后的完整第 ${displayChapterNumber} 章正文。`

    return [
      this.systemMessage('你是一位极其谨慎的小说编辑，擅长精准定位问题并进行最小化修改。你的核心原则是：宁可少改，不要多改。你只修复指定的问题，绝不动无关内容。如果你不确定某个句子是否需要修改，保留原句。修改前请先分析问题根因，选择影响最小的修复方式，避免引入新的逻辑矛盾。'),
      this.userMessage(userContent),
    ]
  }

  protected parse(content: string): AgentOutput {
    return { success: true, content }
  }

  processOutput(output: AgentOutput, _storyId: string, _chapterIndex: number): ChapterMeta {
    const now = Date.now()
    return {
      id: generateId(),
      storyId: _storyId,
      number: _chapterIndex,
      title: null,
      outline: null,
      summary: null,
      foreshadows: null,
      status: 'drafting',
      createdAt: now,
      updatedAt: now,
    }
  }
}
