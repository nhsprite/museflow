import { BaseAgent, type AgentState, type AgentOutput } from './base.js'
import type { ChapterMeta } from '../types/chapter.js'
import type { ForeshadowItem } from '../graph/state.js'
import { generateId } from '../utils/id.js'
import { toDisplayChapterNumber } from '../utils/chapter-display.js'
import type { ChapterPlan } from './chapter-planner.js'

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

    const foreshadowSection = state.foreshadowStack && state.foreshadowStack.length > 0
      ? `【伏笔回收提醒】以下伏笔需要在本章或后续章节中回收：
${state.foreshadowStack.filter(f => !f.fulfilledChapter).map((f, i) => `${i + 1}. "${f.text}"（预期第${f.expectedFulfillChapter}章回收）`).join('\n')}

请注意在写作时自然地呼应或揭示这些伏笔。`
      : ''

    const existingChapterSection = state.chapterContent
      ? `【当前章节正文】（请在原文基础上修改，保留好的部分，修正问题）：
${state.chapterContent}`
      : ''

    const mainCharacterName = state.characters
      ? (state.characters.match(/^【([^】]+)】/m)?.[1] || '（未设定主角）')
      : '（未设定主角）'

    const planSection = state.chapterPlan
      ? `【章节写作规划】（必须严格遵循以下结构）：
${JSON.stringify(state.chapterPlan, null, 2)}`
      : ''

    const outlineKeyPoints = this.extractOutlineKeyPoints(chapterInfo.description)
    const planSections = state.chapterPlan?.sections ?? []

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

${planSection}

${issuesSection}

${foreshadowSection}

${existingChapterSection}

【输出格式要求 - 必须严格遵守】
你的输出必须分为两个部分，用以下标记分隔：

=== PRE_WRITE_CHECK ===
（预写对齐检查表，见下方说明）

=== CHAPTER_CONTENT ===
（正文内容，从这里开始写小说正文）

【第一部分：PRE_WRITE_CHECK - 写正文前必须先完成】
在写正文之前，请先输出预写对齐检查表，逐条确认本章如何落实大纲要求。

必须包含以下检查项（以 Markdown 表格形式输出）：

| 检查项 | 来源 | 具体要求 | 本章执行计划 | 对应段落 |
|--------|------|----------|-------------|----------|
${outlineKeyPoints.map((point, i) => `| 大纲情节点${i + 1} | 大纲 | ${point} | （请填写：本章如何呈现该情节点） | （请填写：第几段） |`).join('\n')}
${planSections.map((section, i) => `| 规划段落${i + 1} | 章节规划 | ${section.title}: ${section.summary} | （请填写：如何展开） | 第${i + 1}段 |`).join('\n')}
| 关键台词 | 大纲 | （如有大纲要求的台词，请列出） | （请填写：由谁说、在什么场景说） | （请填写） |
| 时间线 | 大纲/规划 | （如有时间要求，请列出） | （请填写：时间如何推进） | （请填写） |
| 人物出场 | 大纲/规划 | （列出必须出场的人物） | （请填写：各自承担什么功能） | （请填写） |

在表格之后，必须输出以下自检清单：
- [ ] 大纲中的每个情节点都已在本章找到对应呈现方式
- [ ] 章节规划中的每个段落都有明确的展开计划
- [ ] 关键台词已标注说话人和场景
- [ ] 时间线跨度符合大纲要求
- [ ] 没有遗漏任何大纲要求
- [ ] 没有发现与大纲矛盾的执行计划

【重要】PRE_WRITE_CHECK 完成后，才能开始写正文。PRE_WRITE_CHECK 中的计划必须与正文完全一致，正文必须严格遵循 PRE_WRITE_CHECK 中确认的执行计划。

【第二部分：CHAPTER_CONTENT - 正文写作要求】
1. 【必须】严格按照大纲的每一个情节点展开剧情，大纲中提到的所有事件都必须完整呈现
2. 【必须】主角姓名必须保持为"${mainCharacterName}"，不得擅自为主角起其他名字
3. 【必须】物品名称、功法名称等必须与大纲完全一致
4. 【必须】时间线必须清晰连贯：
   - 时间跨度必须符合大纲要求（如"高烧持续三日"必须描写三日，不能只写一夜）
   - 时间跳跃必须明确标注（如"三日后""次日清晨""又过了两天"）
   - 不能出现时间回退或逻辑矛盾（如先写"烧退了"，后又写"仍在发烧"）
5. 【必须】关键台词必须原样出现：
   - 大纲中明确要求的台词（如"你终于来了"）必须一字不差地出现
   - 不能擅自改写为意思相近但措辞不同的句子
6. 【必须】叙述视角保持一致（第三人称限制性视角），避免出现视角跳跃
7. 【必须】因果关系明确：前一事件的结果必须自然导致后一事件，不能生硬跳转
8. 【必须】信息一致性：本章内所有描述必须自洽，不能前后矛盾
9. 【必须】禁止 AI 惯用腔调，具体包括：
   - 禁止总结性开头：不得以"值得一提的是"、"不难发现"、"众所周知"、"值得注意的是"等句式开头段落
   - 禁止机械过渡：不得使用"让我们回到"、"接下来"、"与此同时"等说教性过渡
   - 禁止抽象概括：不得用"这个故事告诉我们"、"从这件事可以看出"等作者跳出来总结的句式
   - 必须用具体的人物动作、感官细节或场景变化来推动叙事，替代抽象的概括和评价
10. 注重人物对话和心理描写
11. 适时埋下伏笔，为后续章节留下悬念
12. 每章字数建议 2000-5000 字
13. 以自然流畅的段落叙述为主

请严格按照上述格式输出：先输出 === PRE_WRITE_CHECK === 部分，再输出 === CHAPTER_CONTENT === 部分。`

    return [
      this.systemMessage('你是一位专业的小说作家，擅长细腻的描写、丰富的人物刻画和扣人心弦的情节推进。在动笔前，你必须先完成预写对齐检查，确认每个大纲要求都有明确的执行计划，然后严格按照该计划撰写正文。'),
      this.userMessage(userContent),
    ]
  }

  private extractOutlineKeyPoints(description: string): string[] {
    if (!description || description.trim().length === 0) {
      return ['（大纲未提供具体情节点）']
    }
    const sentences = description
      .split(/[。；!！?？]|\n/)
      .map(s => s.trim())
      .filter(s => s.length > 0)
    if (sentences.length === 0) {
      return [description.trim()]
    }
    return sentences
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
    const preWriteMatch = content.match(/===\s*PRE_WRITE_CHECK\s*===([\s\S]*?)(?:===\s*CHAPTER_CONTENT\s*===|$)/i)
    const preWriteCheck = preWriteMatch && preWriteMatch[1] ? preWriteMatch[1].trim() : ''

    const contentMatch = content.match(/===\s*CHAPTER_CONTENT\s*===([\s\S]*)/i)
    let chapterContent: string
    if (contentMatch && contentMatch[1]) {
      chapterContent = contentMatch[1].trim()
    } else {
      chapterContent = content.replace(/===\s*PRE_WRITE_CHECK\s*===[\s\S]*?(?:===\s*CHAPTER_CONTENT\s*===|$)/i, '').trim()
      if (!chapterContent) {
        chapterContent = content.trim()
      }
    }

    const cleaned = chapterContent.replace(/<!--[\s\S]*?-->/g, '').trim()

    return {
      success: true,
      content: cleaned || chapterContent || content,
      data: { preWriteCheck: preWriteCheck || undefined },
    }
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
