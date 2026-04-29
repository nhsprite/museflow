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
    const displayChapterNumber = String(toDisplayChapterNumber(chapterIndex))

    if (state.sentenceFix && state.sentenceFix.sentences.length > 0) {
      return this.buildSentencePrompt(state, displayChapterNumber)
    }

    if (state.paragraphFix && state.paragraphFix.paragraphs.length > 0) {
      return this.buildParagraphPrompt(state, displayChapterNumber)
    }

    return this.buildLegacyPrompt(state, displayChapterNumber)
  }

  private buildSentencePrompt(state: Required<AgentState>, displayChapterNumber: string): import('../model/provider.js').Message[] {
    const { sentences, context } = state.sentenceFix!

    const issuesSection = state.issues && state.issues.length > 0
      ? `【必须修复的问题】
${state.issues.map((issue, i) => `${i + 1}. [${issue.type}] ${issue.description}${issue.location ? `\n   位置: ${issue.location}` : ''}`).join('\n')}`
      : ''

    const sentencesSection = sentences.map((s) =>
      `【段落 ${s.paragraphIndex} · 第 ${s.sentenceIndex + 1} 句】
原句：${s.original}
问题：${s.issue.description}`
    ).join('\n\n')

    const userContent = `请对第 ${displayChapterNumber} 章的指定句子进行精准修复。

${issuesSection}

【上下文】（仅供参考，不要修改）
${context}

【需要修改的句子】（只能修改这些句子，同一段落的其他句子不可触碰）
${sentencesSection}

【硬性约束 — 违反任何一条即不合格】
1. 你只能修改上面标记的【段落 N · 第 M 句】，同一段落的其他句子必须原样保留
2. 修改后的句子必须在意思上能独立成立，与前后句衔接自然
3. 修改时必须彻底替换原句，绝不允许原句和新句同时存在
4. 不得引入新的角色、地点、物品、时间线或因果关系
5. 保持原文的语言风格、叙事节奏和人物语气
6. 消除 AI 痕迹：如原句包含"值得一提的是"、"不难发现"等 AI 惯用句式，必须用具体动作或感官细节替代，不能用另一个 AI 句式替换
7. 修改后通读段落，确保没有句子重复出现
8. 你不需要输出完整章节或完整段落，只需要输出修改后的句子

【输出格式】
对每个需要修改的句子，按以下格式输出：

【段落 N · 第 M 句】
[修改后的句子内容]

如果某个句子不需要修改，也按格式输出原内容：

【段落 N · 第 M 句】
[原句内容]

请只输出需要修改的句子，不要输出任何其他内容。`

    return [
      this.systemMessage('你是一位极其谨慎的小说编辑。你的唯一任务是修改指定的句子。你绝对不可以修改未指定的句子，不可以添加新句子，不可以删除句子。你只能修改标记为【段落 N · 第 M 句】的内容。修改时彻底替换原句，不要残留。'),
      this.userMessage(userContent),
    ]
  }

  private buildParagraphPrompt(state: Required<AgentState>, displayChapterNumber: string): import('../model/provider.js').Message[] {
    const { paragraphs, context } = state.paragraphFix!

    const issuesSection = state.issues && state.issues.length > 0
      ? `【必须修复的问题】
${state.issues.map((issue, i) => `${i + 1}. [${issue.type}] ${issue.description}${issue.location ? `\n   位置: ${issue.location}` : ''}`).join('\n')}`
      : ''

    const issueIndexMap = new Map(state.issues?.map((issue, idx) => [issue, idx + 1]) ?? [])
    const paragraphsSection = paragraphs.map((p) =>
      `【段落 ${p.index}】${p.issues.length > 0 ? ` (涉及问题: ${p.issues.map(issue => issueIndexMap.get(issue) ?? '?').join(', ')})` : ''}
${p.content}`
    ).join('\n\n')

    const userContent = `请对第 ${displayChapterNumber} 章的指定段落进行精准修复。

${issuesSection}

【上下文】（仅供参考，不要修改）
${context}

【需要修改的段落】（只能修改这些段落，其他内容不可触碰）
${paragraphsSection}

【硬性约束 — 违反任何一条即不合格】
1. 你只能修改上面标记为【需要修改的段落】的内容
2. 每个段落的修改必须是独立的：修改段落A时不能引用或改变段落B的内容
3. 修改后的段落必须在意思上能独立成立，与上下文衔接自然
4. 修改时必须彻底替换原句，绝不允许原句和新句同时存在
5. 不得引入新的角色、地点、物品、时间线或因果关系
6. 保持原文的语言风格、叙事节奏和人物语气
7. 消除 AI 痕迹：如段落中包含"值得一提的是"、"不难发现"等 AI 惯用句式，必须用具体动作或感官细节替代，不能用另一个 AI 句式替换
8. 修改后通读段落，确保没有句子重复出现
9. 你不需要输出完整章节，只需要输出修改后的段落

【输出格式】
对每个需要修改的段落，按以下格式输出：

【段落 N】
[修改后的段落内容]

如果某个段落不需要修改，也按格式输出原内容：

【段落 N】
[原内容]

请只输出需要修改的段落，不要输出任何其他内容。`

    return [
      this.systemMessage('你是一位极其谨慎的小说编辑。你的唯一任务是修改指定的段落。你绝对不可以修改未指定的段落，不可以添加新段落，不可以删除段落。你只能修改标记为【需要修改的段落】的内容。修改时彻底替换原句，不要残留。'),
      this.userMessage(userContent),
    ]
  }

  private buildLegacyPrompt(state: Required<AgentState>, displayChapterNumber: string): import('../model/provider.js').Message[] {
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

【硬性约束】
1. 只修改与上述问题直接相关的段落或句子
2. 保留所有未涉及问题的原文内容，不得删减、改动或重新组织
3. 宁可少改，不要多改
4. 不得引入新的角色、地点、物品、时间线或因果关系
5. 用"替换"而非"追加"：修改时必须彻底删除原句，用新句替代
6. 消除 AI 痕迹：如原文包含"值得一提的是"、"不难发现"等 AI 惯用句式，必须用具体动作或感官细节替代
7. 修改后确保没有任何句子重复出现

请输出修复后的完整第 ${displayChapterNumber} 章正文。`

    return [
      this.systemMessage('你是一位极其谨慎的小说编辑，擅长精准定位问题并进行最小化修改。'),
      this.userMessage(userContent),
    ]
  }

  protected parse(content: string): AgentOutput {
    const sentencePattern = /【段落\s*(\d+)\s*·\s*第\s*(\d+)\s*句】\n([\s\S]*?)(?=\n【段落\s*\d+\s*·|$)/g
    const modifiedSentences: Array<{ paragraphIndex: number; sentenceIndex: number; content: string }> = []

    let sentenceMatch
    while ((sentenceMatch = sentencePattern.exec(content)) !== null) {
      const paragraphIndex = parseInt(sentenceMatch[1] ?? '0', 10)
      const sentenceIndex = parseInt(sentenceMatch[2] ?? '0', 10) - 1
      const sentenceContent = (sentenceMatch[3] ?? '').trim()
      modifiedSentences.push({ paragraphIndex, sentenceIndex, content: sentenceContent })
    }

    if (modifiedSentences.length > 0) {
      return { success: true, content, data: { modifiedSentences } }
    }

    const paragraphPattern = /【段落\s*(\d+)】\n([\s\S]*?)(?=\n【段落\s*\d+】|$)/g
    const modifiedParagraphs: Array<{ index: number; content: string }> = []

    let match
    while ((match = paragraphPattern.exec(content)) !== null) {
      const index = parseInt(match[1] ?? '0', 10)
      const paragraphContent = (match[2] ?? '').trim()
      modifiedParagraphs.push({ index, content: paragraphContent })
    }

    if (modifiedParagraphs.length > 0) {
      return { success: true, content, data: { modifiedParagraphs } }
    }

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
