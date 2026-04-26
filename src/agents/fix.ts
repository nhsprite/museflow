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

【重要要求】
1. 只修改与上述问题直接相关的段落或句子
2. 保留所有未涉及问题的原文内容，不得删减、改动或重新组织
3. 修复后的内容必须与大纲、世界观、人物设定保持一致
4. 保持原文的语言风格、叙事节奏和人物语气
5. 输出完整的章节正文，包括未修改的部分

请输出修复后的完整第 ${displayChapterNumber} 章正文。`

    return [
      this.systemMessage('你是一位专业的小说编辑，擅长精准定位问题并进行最小化修改。你的任务是只修复指定的问题，绝不动无关内容。'),
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
