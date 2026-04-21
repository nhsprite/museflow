import { BaseAgent, type AgentState, type AgentOutput } from './base.js'
import type { ChapterMeta } from '../types/chapter.js'
import type { ForeshadowItem } from '../graph/state.js'
import { generateId } from '../utils/id.js'
import { toDisplayChapterNumber } from '../utils/chapter-display.js'

export class ChapterAgent extends BaseAgent {
  constructor() {
    super(undefined, 0.7)
  }
  protected buildPrompt(state: Required<AgentState>): import('../model/provider.js').Message[] {
    const genre = this.getGenre(state.genre)
    const chapterSupplement = genre?.chapterPromptSupplement ?? ''
    const chapterIndex = state.chapterIndex ?? 0
    const displayChapterNumber = toDisplayChapterNumber(chapterIndex)

    const outline = state.outline || ''
    const chapterInfo = this.extractChapterOutline(outline, displayChapterNumber)

    const previousSummary = state.previousChapters || '（这是第一章）'

    const timelineSection = state.timelineSnapshot
      ? `上一章结束时的状态：
${state.timelineSnapshot}

请在继续写作时保持与上述状态的一致性。`
      : ''

    const issuesSection = state.issues && state.issues.length > 0
      ? `【重要】本章需要修复的问题：
${state.issues.map((issue, i) => `${i + 1}. [${issue.type}] ${issue.description}${issue.location ? `\n   位置: ${issue.location}` : ''}`).join('\n')}

【重要】请务必按照上述问题描述修复本章内容，严格遵循大纲设定。`
      : ''

    // Extract first character name from formatted string like "【林渊】描述..."
    const mainCharacterName = state.characters
      ? (state.characters.match(/^【([^】]+)】/m)?.[1] || '（未设定主角）')
      : '（未设定主角）'

    const userContent = `请撰写第 ${displayChapterNumber} 章的正文内容。

【重要】本章主角姓名是"${mainCharacterName}"，主角的姓名在整章中必须保持一致，不得擅自更改为主角起其他名字！

【必须严格遵循】本章大纲：
标题：${chapterInfo.title}
核心事件：${chapterInfo.description}

【重要】大纲中的每个情节点都必须完整呈现！如果大纲中提到"与此同时"、"另外"、"并且"等连接的多个事件，必须在章节中呈现所有事件，不可遗漏任何情节点！

【必须严格遵循】世界观设定：
${state.world || '（尚未构建）'}

【必须严格遵循】人物设定：
${state.characters || '（尚未创建）'}

前几章摘要：
${previousSummary}

${chapterSupplement}

${timelineSection}

${issuesSection}

写作要求：
1. 【必须】严格按照大纲的每一个情节点展开剧情，大纲中提到的所有事件都必须完整呈现
2. 【必须】主角姓名必须保持为"${mainCharacterName}"，不得擅自为主角起其他名字
3. 【必须】物品名称、功法名称等必须与大纲完全一致
4. 注重人物对话和心理描写
5. 适时埋下伏笔，为后续章节留下悬念
6. 每章字数建议 2000-5000 字
7. 以自然流畅的段落叙述为主

请开始撰写第 ${displayChapterNumber} 章。`

    return [
      this.systemMessage('你是一位专业的小说作家，擅长细腻的描写、丰富的人物刻画和扣人心弦的情节推进。'),
      this.userMessage(userContent),
    ]
  }

  private extractChapterOutline(outline: string, chapterIndex: number): { title: string; description: string } {
    const lines = outline.split('\n').filter(l => l.trim())
    const chapterPatterns = [
      new RegExp(`第\\s*${chapterIndex}\\s*章?[:：]?\\s*(.+)`),
      new RegExp(`第\\s*${chapterIndex}\\s*节?[:：]?\\s*(.+)`),
      new RegExp(`chapter\\s*${chapterIndex}[:：]?\\s*(.+)`),
    ]

    for (const pattern of chapterPatterns) {
      const match = outline.match(pattern)
      if (match && match[1]) {
        return { title: match[1].trim(), description: '' }
      }
    }

    const chapterBlocks = outline.split(/(?=第\s*\d+\s*[章节])/i)
    for (const block of chapterBlocks) {
      const numMatch = block.match(/第\s*(\d+)\s*[章节]/)
      if (numMatch && numMatch[1] && parseInt(numMatch[1]) === chapterIndex) {
        const blockLines = block.split('\n').filter(l => l.trim())
        const firstLine = blockLines[0]
        const title = firstLine ? firstLine.replace(/^第\s*\d+\s*[章节][:：]?\s*/, '').trim() : `第${chapterIndex}章`
        const description = blockLines.slice(1).join('\n').trim()
        return { title, description }
      }
    }

    return { title: `第${chapterIndex}章`, description: outline.substring(0, 200) }
  }

  protected parse(content: string): AgentOutput {
    return { success: true, content }
  }

  processOutput(output: AgentOutput, storyId: string, chapterIndex: number): ChapterMeta {
    const now = Date.now()
    return {
      id: generateId(),
      storyId,
      number: chapterIndex,
      title: null,
      outline: null,
      summary: null,
      foreshadows: null,
      status: 'drafting',
      createdAt: now,
      updatedAt: now,
    }
  }

  extractTitle(content: string): string | null {
    const lines = content.split('\n').filter(l => l.trim())
    if (lines.length === 0) return null
    const firstLine = lines[0]
    if (firstLine && firstLine.length > 3 && firstLine.length < 50) {
      return firstLine.trim()
    }
    return null
  }

  extractSummary(content: string): string {
    const paragraphs = content.split(/\n\n+/).filter(p => p.trim().length > 50)
    if (paragraphs.length <= 3) {
      return content.substring(0, 200)
    }
    const middle = paragraphs.slice(1, -1)
    return middle.join(' ').substring(0, 300) + '...'
  }

  extractForeshadows(content: string, chapterIndex: number): ForeshadowItem[] {
    const foreshadowPatterns = [
      /(?:注意到?|发现|觉察到?|预感到?|感觉到?)(.+)（为(.+)埋下伏笔）/gi,
      /(.+)似乎暗示着(.+)/gi,
      /(?:他|她|它|他们)(?:似乎?|仿佛)?(.+)（这为(.+)留下了悬念）/gi,
    ]

    const foreshadows: ForeshadowItem[] = []
    const seen = new Set<string>()

    for (const pattern of foreshadowPatterns) {
      let match
      while ((match = pattern.exec(content)) !== null) {
        const text = match[1]?.trim() || match[0]
        const futureChapter = match[3] ? parseInt(match[3]) : chapterIndex + 5
        if (!seen.has(text) && text.length > 5) {
          seen.add(text)
          foreshadows.push({
            id: generateId(),
            text,
            expectedFulfillChapter: Math.min(futureChapter, chapterIndex + 10),
            createdAt: Date.now(),
          })
        }
      }
    }

    return foreshadows.slice(0, 5)
  }
}
