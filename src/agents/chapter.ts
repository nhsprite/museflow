import type { ModelProvider } from '../model/provider.js'
import { logger } from '../utils/logger.js'
import { BaseAgent, type AgentOutput } from './base.js'
import type { ChapterAgentInput } from './types.js'
import type { ChapterMeta } from '../types/chapter.js'
import { generateId } from '../utils/id.js'
import { toDisplayChapterNumber } from '../utils/chapter-display.js'
import { getChapterPlanningConfig } from '../utils/chapter-planning.js'
import { DEFAULT_CHAPTER_WORD_COUNT_MIN, DEFAULT_CHAPTER_WORD_COUNT_MAX } from '../types/genre.js'
import {
  buildCanonicalFactsSection,
  buildCharacterWhitelistSection,
  FACT_CONSISTENCY_RULES,
} from './prompts/fragments/index.js'
import {
  buildChapterSystemPrompt,
  buildChapterUserPrompt,
  buildBeatMappingSection,
  type BeatMappingEntry,
} from './prompts/chapter-prompt.js'
import { parseStoryEventsBlock } from '../story-memory/parser.js'
import {
  CHAPTER_HEADING_PATTERN,
  CHAPTER_TITLE_ONLY_PATTERN,
} from '../utils/chapter-content-validation.js'
import { getMandatoryBeatEntriesForAct } from '../utils/mandatory-beat-ids.js'

export class ChapterAgent extends BaseAgent<ChapterAgentInput> {
  // Note: currentChapterIndex is stored as instance state because BaseAgent.parse
  // only receives the raw content string. Future refactor should pass a context
  // object (including chapterIndex) into parse.
  private currentChapterIndex = 0

  constructor(provider: ModelProvider) {
    super(provider, 0.7)
  }

  async run(state: ChapterAgentInput): Promise<AgentOutput> {
    // Store chapterIndex for use during parse, since parse only sees content string.
    this.currentChapterIndex = state.chapterIndex ?? 0
    return super.run(state)
  }

  protected buildPrompt(state: ChapterAgentInput): import('../model/provider.js').Message[] {
    const genre = this.getGenre(state.genre)
    const planningConfig = getChapterPlanningConfig(state.genre)
    const chapterSupplement = genre?.chapterPromptSupplement ?? ''
    const chapterIndex = state.chapterIndex ?? 0
    const displayChapterNumber = toDisplayChapterNumber(chapterIndex)

    const outline = state.outline || ''
    const chapterInfo = {
      title: state.chapterTitle?.trim() || `第${displayChapterNumber}章`,
      description: state.chapterSummary?.trim() || outline,
    }

    const previousSummary = state.previousChapters || '（这是第一章）'

    const storyStateSection = state.storyState
      ? `<story_state>
<mandatory>【权威事实 - 本章写作的唯一事实依据】</mandatory>
${state.storyState}

${FACT_CONSISTENCY_RULES}

<note>本章可以根据大纲需要采用回忆、倒叙或跨日叙事。只要本章内部时间推进逻辑自洽，且不违背本章时间锚点，不视为与上一章结束时间矛盾。</note>
</story_state>`
      : ''

    const stateConflictsSection = state.stateConflicts
      ? `<state_conflicts>
<mandatory>【必须处理的上游状态冲突 - 写正文前必须解决】</mandatory>
${state.stateConflicts}

<mandatory>【强制要求】如果上述冲突涉及物品位置矛盾，本章必须明确该物品的唯一当前位置，并通过清晰的角色动作完成转移，不得让同一物品同时出现在两个位置；如果涉及歧义物品名，本章必须使用统一标准名称，禁止同一物品以多个别名并存。</mandatory>
</state_conflicts>`
      : ''

    const chapterContractSection = state.chapterContract
      ? `<chapter_contract>
<mandatory>【章节契约 - 本章规划与正文必须满足】</mandatory>
${state.chapterContract}
</chapter_contract>`
      : ''

    const outlineComplianceSection = `<outline_compliance>
<mandatory>【大纲遵循 - 强制要求】</mandatory>
- 本章只能呈现大纲中明确列出的情节点，不得擅自添加大纲未提及的新情节、新场景或新角色
- 如果大纲中某角色被定位为不在本章公开登场的角色，该角色不得在本章中公开出现在主角团队面前，不得与主角团队公开互动
- 不得擅自增加大纲未提及的、以考验或测试角色为核心目的的情节
- 不得擅自改变大纲中明确指定的角色关系
- 如果本章规划（chapterPlan）将某条前章遗留差事标记为 postponed 或 background，本章只需一句话带过或承认其待办状态，不得展开为完整场景
- 如果大纲中出现"后续章节边界提示"或"跨章节边界冲突"，必须严格遵守其中的强制要求：不要把后续章节的核心事件提前解决、不要重复处理前章已解决的事件
</outline_compliance>`

    const issuesSection =
      state.issues && state.issues.length > 0
        ? `<issues>
<important>【重要】本章需要修复的问题：</important>
${state.issues.map((issue, i) => `${i + 1}. [${issue.type}] ${issue.description}${issue.location ? `\n   位置: ${issue.location}` : ''}${issue.suggestion ? `\n   建议: ${issue.suggestion}` : ''}`).join('\n')}

<important>【重要】请务必按照上述问题描述修复本章内容，严格遵循大纲设定。</important>
</issues>`
        : ''

    const currentChapterIndex = (state.chapterIndex ?? 0) + 1
    const activeForeshadows = state.foreshadowStack?.filter((f) => !f.fulfilledChapter) ?? []

    const overdueForeshadows = activeForeshadows.filter(
      (f) => currentChapterIndex > f.expectedFulfillChapter + 1
    )
    const urgentForeshadows = activeForeshadows.filter(
      (f) =>
        currentChapterIndex >= f.expectedFulfillChapter - 1 &&
        currentChapterIndex <= f.expectedFulfillChapter + 1
    )
    const normalForeshadows = activeForeshadows.filter(
      (f) => currentChapterIndex < f.expectedFulfillChapter - 1
    )

    const foreshadowSection =
      activeForeshadows.length > 0
        ? `<foreshadow_reminder>
<title>【伏笔回收提醒】</title>
${
  overdueForeshadows.length > 0
    ? `<overdue>⚠️ 已逾期伏笔（必须在本章回收）：
${overdueForeshadows.map((f, i) => `  ${i + 1}. "${f.text}"（预期第${f.expectedFulfillChapter}章，已逾期${currentChapterIndex - f.expectedFulfillChapter}章）`).join('\n')}

<mandatory>【强制要求】以上逾期伏笔已严重超期，必须在本章明确回收。如果本章无法自然回收，请通过角色回忆、对话揭示或场景呼应的方式处理，绝不可继续拖延。</mandatory></overdue>\n\n`
    : ''
}${
            urgentForeshadows.length > 0
              ? `<urgent>🔔 即将到期伏笔（建议在本章回收）：
${urgentForeshadows.map((f, i) => `  ${i + 1}. "${f.text}"（预期第${f.expectedFulfillChapter}章）`).join('\n')}
</urgent>\n\n`
              : ''
          }${
            normalForeshadows.length > 0
              ? `<normal>⏳ 正常伏笔（后续章节回收）：
${normalForeshadows.map((f, i) => `  ${i + 1}. "${f.text}"（预期第${f.expectedFulfillChapter}章）`).join('\n')}
</normal>\n\n`
              : ''
          }请注意在写作时自然地呼应或揭示需要回收的伏笔。
</foreshadow_reminder>`
        : ''

    const existingChapterSection = state.chapterContent
      ? `<existing_chapter>
<instruction>【当前章节正文】（请在原文基础上修改，保留好的部分，修正问题）：</instruction>
${state.chapterContent}
</existing_chapter>`
      : ''

    const chapterTimeAnchor = state.chapterPlan?.chapterTimeAnchor || state.chapterTimeAnchor
    const timeAnchorSection = chapterTimeAnchor
      ? `<chapter_time_anchor>
<mandatory>【本章时间锚点 - 必须以此作为本章叙事起点】</mandatory>
本章叙事从以下时间点开始：${chapterTimeAnchor}

<important>本章允许采用回忆、倒叙或跨日叙事，只要时间推进逻辑自洽，且与本章时间锚点一致。不要因上一章结束时间而限制本章的时间范围。</important>
</chapter_time_anchor>`
      : ''

    const mainCharacterName = state.charactersList?.[0]?.name ?? '（未设定主角）'

    const characterWhitelistSection = buildCharacterWhitelistSection({
      charactersList: state.charactersList,
      outlineCharacters: state.outlineCharacters,
      establishedCharacters: state.establishedCharacters,
    })

    const planSection = state.chapterPlan
      ? `<chapter_plan>
<instruction>【章节写作规划】（必须严格遵循以下结构）：</instruction>
${JSON.stringify(state.chapterPlan, null, 2)}
</chapter_plan>`
      : ''

    const taskResolutions = state.chapterPlan?.taskResolutions
    const taskResolutionSection =
      taskResolutions && taskResolutions.length > 0
        ? `<task_resolutions>
<instruction>【前章遗留差事处理 - 必须遵循】</instruction>
${taskResolutions.map((t, i) => `${i + 1}. [${t.resolution}] ${t.assignee}：${t.description}\n   原因：${t.reason}${t.section ? `\n   对应段落：${t.section}` : ''}`).join('\n')}

<mandatory>【强制要求】</mandatory>
- 标记为 executed 的差事：本章必须完整呈现其执行过程
- 标记为 postponed 的差事：本章只需承认其待办/推迟状态，不得展开执行
- 标记为 superseded 的差事：本章不得提及，已被后续大纲覆盖
- 标记为 background 的差事：本章只能用一句话带过，不得超过 {MAX_BACKGROUND_TASK_WORD_COUNT} 字，不得写成独立场景
</task_resolutions>`
        : ''

    const outlineKeyPoints = this.extractOutlineKeyPoints(chapterInfo.description)
    const planSections = state.chapterPlan?.sections ?? []

    const remainingChapters = state.totalChapters - chapterIndex - 1
    const closingReminder =
      remainingChapters === 0
        ? `<closing_phase>
<title>【完结期提示】</title>
<content>这是最后一章，必须完成以下任务：
- 回收所有主要伏笔，不得遗留未解决的悬念
- 给出明确的结局（人物命运、冲突结果、世界状态）
- 避免仓促收尾，给读者完整的收束感</content>
</closing_phase>`
        : remainingChapters === 1
          ? `<closing_phase>
<title>【冲突期提示】</title>
<content>还有最后一章就完结了，本章必须：
- 推进最终对决/高潮冲突到临界点
- 回收至少 {CLOSING_FORESHADOW_RECOVERY_PERCENT}% 的主要伏笔
- 为结局做好所有铺垫，不要在最后一章引入新线索</content>
</closing_phase>`
          : remainingChapters <= 3
            ? `<closing_phase>
<title>【铺垫期提示】</title>
<content>还有 ${remainingChapters + 1} 章完结，请注意：
- 开始加速主线节奏，减少无关支线
- 为主要冲突的最终爆发积蓄张力
- 有选择地回收部分伏笔，保留核心悬念到结局</content>
</closing_phase>`
            : ''

    const factVerificationSection = this.buildFactVerificationSection(state)
    const absoluteConstraintsSection = this.buildAbsoluteConstraints(state)
    const beatMappingSection = this.buildBeatMappingSection(state)

    const userContent = buildChapterUserPrompt(
      {
        absoluteConstraintsSection,
        characterWhitelistSection,
        chapterSupplement,
        previousSummary,
        storyStateSection,
        chapterContractSection,
        stateConflictsSection,
        timeAnchorSection,
        factVerificationSection,
        beatMappingSection,
        planSection,
        taskResolutionSection,
        outlineComplianceSection,
        issuesSection,
        foreshadowSection,
        closingReminder: closingReminder ? closingReminder + '\n\n' : '',
        existingChapterSection,
        outlineKeyPointsRows: outlineKeyPoints
          .map(
            (point, i) =>
              `| 大纲情节点${i + 1} | 大纲 | ${point} | （请填写：本章如何呈现该情节点） | （请填写：第几段） |`
          )
          .join('\n'),
        planSectionsRows: planSections
          .map(
            (section, i) =>
              `| 规划段落${i + 1} | 章节规划 | ${section.title}: ${section.summary} | （请填写：如何展开） | 第${i + 1}段 |`
          )
          .join('\n'),
        stateConflictsRow: state.stateConflicts
          ? `| 大纲-权威事实冲突 | stateConflicts | 本章存在需要处理的冲突：${state.stateConflicts.replace(/\n/g, '；')} | （请填写：每个冲突选择以谁为准、通过什么角色动作或叙事过渡实现） | （请填写） |`
          : '',
      },
      {
        displayChapterNumber,
        mainCharacterName,
        chapterTitle: chapterInfo.title,
        chapterDescription: chapterInfo.description,
        worldSetting: state.world || '（尚未构建）',
        characterSetting: state.characters || '（尚未创建）',
        CHAPTER_WORD_COUNT_MIN: genre?.chapterWordCountMin ?? DEFAULT_CHAPTER_WORD_COUNT_MIN,
        CHAPTER_WORD_COUNT_MAX: genre?.chapterWordCountMax ?? DEFAULT_CHAPTER_WORD_COUNT_MAX,
        MAX_BACKGROUND_TASK_WORD_COUNT: planningConfig.maxBackgroundTaskWordCount,
        CLOSING_FORESHADOW_RECOVERY_PERCENT: Math.round(
          planningConfig.closingForeshadowRecoveryRatio * 100
        ),
      }
    )

    return [this.systemMessage(buildChapterSystemPrompt()), this.userMessage(userContent)]
  }

  private extractOutlineKeyPoints(description: string): string[] {
    if (!description || description.trim().length === 0) {
      return ['（大纲未提供具体情节点）']
    }
    return [description.trim()]
  }

  private buildFactVerificationSection(state: ChapterAgentInput): string {
    const storyState = state.storyState
    if (!storyState) {
      return ''
    }

    const extractSection = (label: string, content: string): string | null => {
      const pattern = new RegExp(`【${label}】\\n([\\s\\S]*?)(?=【|$)`)
      const match = content.match(pattern)
      return match && match[1] ? match[1].trim() : null
    }

    const revealedSecrets = extractSection('已揭示的秘密', storyState)
    const supersededFacts = extractSection('已被覆盖的旧事实', storyState)
    const canonicalFacts = extractSection('权威事实', storyState)
    const characterLocations = extractSection('角色位置', storyState)
    const characterStatuses = extractSection('角色状态', storyState)
    const keyItems = extractSection('关键物品', storyState)
    const keyItemStates = extractSection('关键物品状态', storyState)

    const facts: string[] = []
    if (canonicalFacts) {
      facts.push(
        `【权威事实】\n${this.sortCanonicalFactsByOutlineRelevance(canonicalFacts, state.outline ?? '')}`
      )
    }
    if (characterLocations) {
      facts.push(`【角色位置】\n${characterLocations}`)
    }
    if (characterStatuses) {
      facts.push(`【角色状态】\n${characterStatuses}`)
    }
    if (keyItems) {
      facts.push(
        `【关键物品】\n${keyItems}\n${keyItemStates ? `【关键物品状态】\n${keyItemStates}\n` : ''}`
      )
    }
    if (revealedSecrets) {
      facts.push(`【已揭示的秘密】\n${revealedSecrets}`)
    }
    if (supersededFacts) {
      facts.push(`【已被覆盖的旧事实】\n${supersededFacts}`)
    }

    return buildCanonicalFactsSection(facts)
  }

  private sortCanonicalFactsByOutlineRelevance(
    canonicalFactsText: string,
    _outline: string
  ): string {
    const lines = canonicalFactsText.split('\n').filter((line) => line.trim().length > 0)
    if (lines.length === 0) return ''
    return lines.join('\n')
  }

  private buildAbsoluteConstraints(state: ChapterAgentInput): string {
    const constraints: string[] = [
      '本章不得提前完成或彻底收尾下一章大纲中的核心行动。',
      '本章不得重复呈现上一章已标记为"已完成/已揭示"的核心事件。',
      '本章对关键物品状态的改变必须与上一章结束时的权威事实一致，并有明确的角色动作支撑。',
      '涉及关键物品/设定的来源、制造者、来历、赠予者时，必须与【权威事实】中的记录一致；若权威事实未记录且大纲未明确引入新来源，必须保持来源未说明，严禁 invent 具体来源。',
      '本章执行大纲动作所需的新执行者/地点，必须优先从已建立角色、大纲登场角色或前文已登场角色中选择；若均不适合，只能虚构一个无姓名、无背景、不进入 storyState 的功能性角色，且不得在 storyState 中留下记录。',
    ]

    if (state.nextChapterBoundary) {
      constraints.push(
        '本章必须遵守【后续章节边界提示】：只能推进到合适的中转状态，不得替代下一章完成其核心行动或最终揭示。'
      )
    }

    return `<absolute_constraints>\n<mandatory>【绝对约束 - 优先级最高】</mandatory>\n${constraints.map((c) => `- ${c}`).join('\n')}\n</absolute_constraints>`
  }

  private buildBeatMappingSection(state: ChapterAgentInput): string {
    const storyArc = state.storyArc
    const chapterIndex = state.chapterIndex ?? 0
    if (!storyArc) return ''

    const currentAct = storyArc.acts.find(
      (act) => chapterIndex + 1 >= act.startChapter && chapterIndex + 1 <= act.endChapter
    )
    if (!currentAct) return ''

    const currentActMandatoryBeats = getMandatoryBeatEntriesForAct(currentAct)
    if (currentActMandatoryBeats.length === 0) return ''

    const claimedMandatoryBeatIds = new Set(state.chapterPlan?.claimedMandatoryBeatIds ?? [])
    const entries: BeatMappingEntry[] = currentActMandatoryBeats.map((beat) => ({
      beatId: beat.id,
      description: beat.beat,
      claimed: claimedMandatoryBeatIds.has(beat.id),
    }))

    return buildBeatMappingSection(currentAct.index, entries)
  }

  protected parse(content: string): AgentOutput {
    const standardPreWriteMatch = content.match(
      /===\s*PRE_WRITE_CHECK\s*===([\s\S]*?)(?:===\s*STORY_EVENTS\s*===|===\s*CHAPTER_CONTENT\s*===|$)/i
    )
    const standardPreWriteCheck =
      standardPreWriteMatch && standardPreWriteMatch[1] ? standardPreWriteMatch[1].trim() : ''

    const standardContentMatch = content.match(/===\s*CHAPTER_CONTENT\s*===([\s\S]*)/i)
    let extractedContent: string

    if (standardContentMatch && standardContentMatch[1]) {
      extractedContent = standardContentMatch[1].trim()
    } else {
      logger.warn('[MuseFlow] 警告: 未检测到标准的 === CHAPTER_CONTENT === 标记，尝试智能截断...')
      extractedContent = this.extractContentWithoutMarkers(content)
    }

    if (this.hasPreWriteCheckArtifacts(extractedContent)) {
      logger.warn('[MuseFlow] 警告: 正文中检测到检查表残留，执行清理...')
      extractedContent = this.truncateToChapterHeading(extractedContent)
    }

    const headingMatch = extractedContent.match(CHAPTER_HEADING_PATTERN)
    if (headingMatch && headingMatch.index !== undefined && headingMatch.index > 0) {
      const detectedPreWrite = extractedContent.slice(0, headingMatch.index).trim()
      extractedContent = extractedContent.slice(headingMatch.index).trim()
      if (detectedPreWrite && !standardPreWriteCheck) {
        return {
          success: true,
          content: extractedContent,
          data: {
            preWriteCheck: detectedPreWrite,
            storyEvents: parseStoryEventsBlock(content, this.currentChapterIndex),
          },
        }
      }
    }

    const cleaned = extractedContent.replace(/<!--[\s\S]*?-->/g, '').trim()

    return {
      success: true,
      content: cleaned || extractedContent || content,
      data: {
        preWriteCheck: standardPreWriteCheck || undefined,
        storyEvents: parseStoryEventsBlock(content, this.currentChapterIndex),
      },
    }
  }

  private extractContentWithoutMarkers(rawContent: string): string {
    const contentAfterPreWriteRemoval = rawContent
      .replace(
        /===\s*PRE_WRITE_CHECK\s*===[\s\S]*?(?===\s*STORY_EVENTS\s*===|===\s*CHAPTER_CONTENT\s*===|#{1,2}\s+第|$)/i,
        ''
      )
      .trim()

    if (this.hasPreWriteCheckArtifacts(contentAfterPreWriteRemoval)) {
      const headingMatch = contentAfterPreWriteRemoval.match(CHAPTER_TITLE_ONLY_PATTERN)
      if (headingMatch && headingMatch.index !== undefined && headingMatch.index > 0) {
        return contentAfterPreWriteRemoval.slice(headingMatch.index).trim()
      }
    }

    if (
      !contentAfterPreWriteRemoval ||
      this.hasPreWriteCheckArtifacts(contentAfterPreWriteRemoval)
    ) {
      const rawHeadingMatch = rawContent.match(CHAPTER_TITLE_ONLY_PATTERN)
      if (rawHeadingMatch && rawHeadingMatch.index !== undefined) {
        return rawContent.slice(rawHeadingMatch.index).trim()
      }
      logger.error('[MuseFlow] 错误: 无法分离检查表和正文，检查表可能已混入正文')
      return rawContent.trim()
    }

    return contentAfterPreWriteRemoval
  }

  private hasPreWriteCheckArtifacts(text: string): boolean {
    const artifactPatterns = [/===\s*PRE_WRITE_CHECK\s*===/]
    return artifactPatterns.some((pattern) => pattern.test(text))
  }

  private truncateToChapterHeading(text: string): string {
    const match = text.match(CHAPTER_TITLE_ONLY_PATTERN)
    if (match && match.index !== undefined) {
      return text.slice(match.index).trim()
    }
    return text
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
}
