import { logger } from '../utils/logger.js'
import { BaseAgent, type AgentState, type AgentOutput } from './base.js'
import type { ChapterMeta } from '../types/chapter.js'
import { generateId } from '../utils/id.js'
import { toDisplayChapterNumber } from '../utils/chapter-display.js'
import { getChapterPlanningConfig } from '../utils/chapter-planning.js'
import { calculateKeywordOverlap } from '../utils/text-similarity.js'
import { DEFAULT_CHAPTER_WORD_COUNT_MIN, DEFAULT_CHAPTER_WORD_COUNT_MAX } from '../types/genre.js'
import {
  AI_PHRASE_PROHIBITIONS,
  TIMELINE_RULES,
  FACT_CONSISTENCY_RULES,
  CAPABILITY_CONSISTENCY_RULES,
  CROSS_CHAPTER_CONTINUITY_RULES,
  FORESHADOW_BOUNDARY_RULES,
  CHAPTER_OUTPUT_RULES,
  OFFICIAL_CHARACTER_RULES,
  FORESHADOW_DISCIPLINE_RULES,
  ABSTRACT_OUTCOME_RULES,
  PENDING_TASK_AUTHORITY_RULES,
  TIME_ANCHOR_AUTHORITY_RULES,
  buildCanonicalFactsSection,
  buildCharacterWhitelistSection,
} from './prompt-fragments.js'

export class ChapterAgent extends BaseAgent {
  constructor() {
    super(undefined, 0.7)
  }
  protected buildPrompt(state: Required<AgentState>): import('../model/provider.js').Message[] {
    const genre = this.getGenre(state.genre)
    const planningConfig = getChapterPlanningConfig(state.genre)
    const chapterSupplement = genre?.chapterPromptSupplement ?? ''
    const chapterIndex = state.chapterIndex ?? 0
    const displayChapterNumber = toDisplayChapterNumber(chapterIndex)

    const outline = state.outline || ''
    const chapterInfo = this.extractChapterOutline(outline, displayChapterNumber)

    const previousSummary = state.previousChapters || '（这是第一章）'

    const timelineSection = state.timelineSnapshot
      ? `<timeline_state>
上一章结束时的状态：
${state.timelineSnapshot}

请在继续写作时保持与上述状态的一致性。</timeline_state>`
      : ''

    const keyEventsSection = state.keyEventsTimeline
      ? `<key_events>
<important>【重要 - 已发生的关键事件】以下事件已在前面章节中发生，后续章节必须承认并遵循这些事实，不可遗漏、遗忘或矛盾：</important>
${state.keyEventsTimeline}

<mandatory>【强制要求】以上关键事件是已确立的叙事事实，本章写作时必须保持一致。如果本章涉及这些事件的后续发展，必须给出合理的因果衔接，不可凭空改变事件结果。</mandatory>
</key_events>`
      : ''

    const storyStateSection = state.storyState
      ? `<story_state>
<mandatory>【上一章结束时间 - 叙事参考起点】</mandatory>
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

    const outlineComplianceSection = `<outline_compliance>
<mandatory>【大纲遵循 - 强制要求】</mandatory>
- 本章只能呈现大纲中明确列出的情节点，不得擅自添加大纲未提及的新情节、新场景或新角色
- 如果大纲中某角色被定位为不在本章公开登场的角色，该角色不得在本章中公开出现在主角团队面前，不得与主角团队公开互动
- 不得擅自增加大纲未提及的、以考验或测试角色为核心目的的情节
- 不得擅自改变大纲中明确指定的角色关系
- 如果本章规划（chapterPlan）将某条前章遗留差事标记为 postponed 或 background，本章只需一句话带过或承认其待办状态，不得展开为完整场景
- 如果大纲中出现"后续章节边界提示"或"跨章节边界冲突"，必须严格遵守其中的强制要求：不要把后续章节的核心事件提前解决、不要重复处理前章已解决的事件
</outline_compliance>`

    const issuesSection = state.issues && state.issues.length > 0
      ? `<issues>
<important>【重要】本章需要修复的问题：</important>
${state.issues.map((issue, i) => `${i + 1}. [${issue.type}] ${issue.description}${issue.location ? `\n   位置: ${issue.location}` : ''}${issue.suggestion ? `\n   建议: ${issue.suggestion}` : ''}`).join('\n')}

<important>【重要】请务必按照上述问题描述修复本章内容，严格遵循大纲设定。</important>
</issues>`
      : ''

    const currentChapterIndex = (state.chapterIndex ?? 0) + 1
    const activeForeshadows = state.foreshadowStack?.filter(f => !f.fulfilledChapter) ?? []
    
    const overdueForeshadows = activeForeshadows.filter(
      f => currentChapterIndex > f.expectedFulfillChapter + 1
    )
    const urgentForeshadows = activeForeshadows.filter(
      f => currentChapterIndex >= f.expectedFulfillChapter - 1 && currentChapterIndex <= f.expectedFulfillChapter + 1
    )
    const normalForeshadows = activeForeshadows.filter(
      f => currentChapterIndex < f.expectedFulfillChapter - 1
    )

    const foreshadowSection = activeForeshadows.length > 0
      ? `<foreshadow_reminder>
<title>【伏笔回收提醒】</title>
${overdueForeshadows.length > 0 ? `<overdue>⚠️ 已逾期伏笔（必须在本章回收）：
${overdueForeshadows.map((f, i) => `  ${i + 1}. "${f.text}"（预期第${f.expectedFulfillChapter}章，已逾期${currentChapterIndex - f.expectedFulfillChapter}章）`).join('\n')}

<mandatory>【强制要求】以上逾期伏笔已严重超期，必须在本章明确回收。如果本章无法自然回收，请通过角色回忆、对话揭示或场景呼应的方式处理，绝不可继续拖延。</mandatory></overdue>\n\n` : ''}${urgentForeshadows.length > 0 ? `<urgent>🔔 即将到期伏笔（建议在本章回收）：
${urgentForeshadows.map((f, i) => `  ${i + 1}. "${f.text}"（预期第${f.expectedFulfillChapter}章）`).join('\n')}
</urgent>\n\n` : ''}${normalForeshadows.length > 0 ? `<normal>⏳ 正常伏笔（后续章节回收）：
${normalForeshadows.map((f, i) => `  ${i + 1}. "${f.text}"（预期第${f.expectedFulfillChapter}章）`).join('\n')}
</normal>\n\n` : ''}请注意在写作时自然地呼应或揭示需要回收的伏笔。
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

    const mainCharacterName = state.characters
      ? (state.characters.match(/^【([^】]+)】/m)?.[1] || '（未设定主角）')
      : '（未设定主角）'

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
    const taskResolutionSection = taskResolutions && taskResolutions.length > 0
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
    const closingReminder = remainingChapters === 0
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

    const userContent = `${absoluteConstraintsSection}

<task>
<instruction>请撰写第 ${displayChapterNumber} 章的正文内容。</instruction>

<main_character>
<important>【重要】本章主角姓名是"${mainCharacterName}"，主角的姓名在整章中必须保持一致，不得擅自更改为主角起其他名字！</important>
</main_character>

<chapter_outline>
<requirement>【必须严格遵循】本章大纲：</requirement>
<title>标题：${chapterInfo.title}</title>
<description>核心事件：${chapterInfo.description}</description>

<important>【重要】大纲中的每个情节点都必须完整呈现！如果大纲中用连接词串联多个事件，必须在章节中呈现所有事件，不可遗漏任何情节点！</important>
</chapter_outline>

<world_setting>
<requirement>【必须严格遵循】世界观设定：</requirement>
${state.world || '（尚未构建）'}
</world_setting>

<character_setting>
<requirement>【必须严格遵循】人物设定：</requirement>
${state.characters || '（尚未创建）'}
</character_setting>

${characterWhitelistSection}

<previous_summary>
前几章摘要：
${previousSummary}
</previous_summary>

${chapterSupplement}

${timelineSection}

${keyEventsSection}

${storyStateSection}

${stateConflictsSection}

${timeAnchorSection}

${factVerificationSection}

${planSection}

${taskResolutionSection}

${outlineComplianceSection}

${issuesSection}

${foreshadowSection}

${closingReminder ? closingReminder + '\n\n' : ''}${existingChapterSection}

<output_format>
<requirement>【输出格式要求 - 必须严格遵守】</requirement>
你的输出必须分为两个部分，用以下标记分隔：

=== PRE_WRITE_CHECK ===
（预写对齐检查表，见下方说明）

=== CHAPTER_CONTENT ===
（正文内容，从这里开始写小说正文）

<pre_write_check_section>
<title>【第一部分：PRE_WRITE_CHECK - 写正文前必须先完成】</title>
<content>在写正文之前，请先输出预写对齐检查表，逐条确认本章如何落实大纲要求。

必须包含以下检查项（以 Markdown 表格形式输出）：

| 检查项 | 来源 | 具体要求 | 本章执行计划 | 对应段落 |
|--------|------|----------|-------------|----------|
${outlineKeyPoints.map((point, i) => `| 大纲情节点${i + 1} | 大纲 | ${point} | （请填写：本章如何呈现该情节点） | （请填写：第几段） |`).join('\n')}
${planSections.map((section, i) => `| 规划段落${i + 1} | 章节规划 | ${section.title}: ${section.summary} | （请填写：如何展开） | 第${i + 1}段 |`).join('\n')}
${state.stateConflicts ? `| 大纲-权威事实冲突 | stateConflicts | 本章存在需要处理的冲突：${state.stateConflicts.replace(/\n/g, '；')} | （请填写：每个冲突选择以谁为准、通过什么角色动作或叙事过渡实现） | （请填写） |` : ''}
| 关键台词 | 大纲 | （如有大纲要求的台词，请列出） | （请填写：由谁说、在什么场景说） | （请填写） |
| 事实核查 | 权威事实 | 本章涉及的事实是否已核对？ | （请填写：核对结果） | （请填写） |
| 时间线 | 大纲/规划 | （如有时间要求，请列出） | （请填写：时间如何推进） | （请填写） |
| 人物出场 | 大纲/规划 | （列出必须出场的人物） | （请填写：各自承担什么功能） | （请填写） |

在表格之后，必须输出以下自检清单：
- [ ] 所有涉及物品来源、角色关系、世界规则的描述都与已确立事实一致
- [ ] 没有 invent 新的事实
- [ ] 如果大纲有新设定，已明确标注并与旧事实区分
- [ ] 大纲中的每个情节点都已在本章找到对应呈现方式
- [ ] 章节规划中的每个段落都有明确的展开计划
- [ ] 关键台词已标注说话人和场景
- [ ] 时间线跨度符合大纲要求
- [ ] 没有遗漏任何大纲要求
- [ ] 没有发现与大纲矛盾的执行计划

<important>【重要】PRE_WRITE_CHECK 完成后，才能开始写正文。PRE_WRITE_CHECK 中的计划必须与正文完全一致，正文必须严格遵循 PRE_WRITE_CHECK 中确认的执行计划。</important>
</content>
</pre_write_check_section>

<chapter_content_section>
<title>【第二部分：CHAPTER_CONTENT - 正文写作要求】</title>
<content>
${CHAPTER_OUTPUT_RULES}
<rule id="1"><mandatory>【必须】</mandatory>严格按照大纲的每一个情节点展开剧情，大纲中提到的所有事件都必须完整呈现</rule>
<rule id="2"><mandatory>【必须】</mandatory>主角姓名必须保持为"${mainCharacterName}"，不得擅自为主角起其他名字</rule>
<rule id="3"><mandatory>【必须】</mandatory>物品名称、专有名词、特殊设定名称等必须与大纲完全一致</rule>
${TIMELINE_RULES}
<rule id="5"><mandatory>【必须】</mandatory>关键台词必须原样出现：
   - 大纲中明确要求的台词必须一字不差地出现
   - 不能擅自改写为意思相近但措辞不同的句子</rule>
<rule id="6"><mandatory>【必须】</mandatory>叙述视角保持一致，避免出现视角跳跃</rule>
<rule id="7"><mandatory>【必须】</mandatory>因果关系明确：前一事件的结果必须自然导致后一事件，不能生硬跳转</rule>
<rule id="8"><mandatory>【必须】</mandatory>信息一致性：本章内所有描述必须自洽，不能前后矛盾</rule>
${AI_PHRASE_PROHIBITIONS}
<rule id="10">注重人物对话和心理描写</rule>
<rule id="11">适时埋下伏笔，为后续章节留下悬念</rule>
<rule id="12"><mandatory>【必须】</mandatory>每章字数要求：
     - 本章总字数应控制在 {CHAPTER_WORD_COUNT_MIN}-{CHAPTER_WORD_COUNT_MAX} 字之间
     - 每章字数应均匀分布，避免出现过短章节
     - 严禁用几句话草率收尾，每章都必须有充实的情节展开</rule>
${CROSS_CHAPTER_CONTINUITY_RULES}
${FACT_CONSISTENCY_RULES}
${FORESHADOW_BOUNDARY_RULES}
${CAPABILITY_CONSISTENCY_RULES}
${ABSTRACT_OUTCOME_RULES}
${PENDING_TASK_AUTHORITY_RULES}
${TIME_ANCHOR_AUTHORITY_RULES}
<rule id="16">以自然流畅的段落叙述为主</rule>
${OFFICIAL_CHARACTER_RULES}
${FORESHADOW_DISCIPLINE_RULES}
</content>
</chapter_content_section>

请严格按照上述格式输出：先输出 === PRE_WRITE_CHECK === 部分，再输出 === CHAPTER_CONTENT === 部分。
</output_format>
</task>`

    const templatedContent = this.fillTemplate(userContent, {
      MAX_BACKGROUND_TASK_WORD_COUNT: planningConfig.maxBackgroundTaskWordCount,
      CLOSING_FORESHADOW_RECOVERY_PERCENT: Math.round(planningConfig.closingForeshadowRecoveryRatio * 100),
      CHAPTER_WORD_COUNT_MIN: genre?.chapterWordCountMin ?? DEFAULT_CHAPTER_WORD_COUNT_MIN,
      CHAPTER_WORD_COUNT_MAX: genre?.chapterWordCountMax ?? DEFAULT_CHAPTER_WORD_COUNT_MAX,
    })

    return [
      this.systemMessage(`<system>
<role>专业小说作家</role>
<capability>擅长细腻的描写、丰富的人物刻画和扣人心弦的情节推进</capability>
<requirement>在动笔前，你必须先完成预写对齐检查，确认每个大纲要求都有明确的执行计划，然后严格按照该计划撰写正文</requirement>
</system>`),
      this.userMessage(templatedContent),
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

  private buildFactVerificationSection(state: Required<AgentState>): string {
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
      facts.push(`【权威事实】\n${this.sortCanonicalFactsByOutlineRelevance(canonicalFacts, state.outline)}`)
    }
    if (characterLocations) {
      facts.push(`【角色位置】\n${characterLocations}`)
    }
    if (characterStatuses) {
      facts.push(`【角色状态】\n${characterStatuses}`)
    }
    if (keyItems) {
      facts.push(`【关键物品】\n${keyItems}\n${keyItemStates ? `【关键物品状态】\n${keyItemStates}\n` : ''}`)
    }
    if (revealedSecrets) {
      facts.push(`【已揭示的秘密】\n${revealedSecrets}`)
    }
    if (supersededFacts) {
      facts.push(`【已被覆盖的旧事实】\n${supersededFacts}`)
    }

    return buildCanonicalFactsSection(facts)
  }

  private sortCanonicalFactsByOutlineRelevance(canonicalFactsText: string, outline: string): string {
    const lines = canonicalFactsText.split('\n').filter(line => line.trim().length > 0)
    if (lines.length === 0) return ''

    const scored = lines.map(line => ({
      line,
      score: calculateKeywordOverlap(line, outline),
    }))

    scored.sort((a, b) => b.score - a.score)
    return scored.map(s => s.line).join('\n')
  }

  private buildAbsoluteConstraints(state: Required<AgentState>): string {
    const constraints: string[] = [
      '本章不得提前完成或彻底收尾下一章大纲中的核心行动。',
      '本章不得重复呈现上一章已标记为"已完成/已揭示"的核心事件。',
      '本章对关键物品状态的改变必须与上一章结束时的权威事实一致，并有明确的角色动作支撑。',
      '涉及关键物品/设定的来源、制造者、来历、赠予者时，必须与【权威事实】中的记录一致；若权威事实未记录且大纲未明确引入新来源，必须保持来源未说明，严禁 invent 具体来源。',
      '本章执行大纲动作所需的新执行者/地点，必须优先从已建立角色、大纲登场角色或前文已登场角色中选择；若均不适合，只能虚构一个无姓名、无背景、不进入 storyState 的功能性角色，且不得在 storyState 中留下记录。',
    ]

    if (state.nextChapterBoundary) {
      constraints.push('本章必须遵守【后续章节边界提示】：只能推进到合适的中转状态，不得替代下一章完成其核心行动或最终揭示。')
    }

    return `<absolute_constraints>\n<mandatory>【绝对约束 - 优先级最高】</mandatory>\n${constraints.map(c => `- ${c}`).join('\n')}\n</absolute_constraints>`
  }

  private extractChapterOutline(outline: string, chapterIndex: number): { title: string; description: string } {
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
    const standardPreWriteMatch = content.match(/===\s*PRE_WRITE_CHECK\s*===([\s\S]*?)(?:===\s*CHAPTER_CONTENT\s*===|$)/i)
    const standardPreWriteCheck = standardPreWriteMatch && standardPreWriteMatch[1] ? standardPreWriteMatch[1].trim() : ''

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

    const chapterHeadingPattern = /^(#{1,2}\s+第\s*\d+\s*章[\s:：]|#{1,2}\s+第\s*\d+\s*部分[\s:：]|#{1,2}\s+\d+[.、]\s+|#{1,2}\s+章节?\s*\d+)/m
    const headingMatch = extractedContent.match(chapterHeadingPattern)
    if (headingMatch && headingMatch.index !== undefined && headingMatch.index > 0) {
      const detectedPreWrite = extractedContent.slice(0, headingMatch.index).trim()
      extractedContent = extractedContent.slice(headingMatch.index).trim()
      if (detectedPreWrite && !standardPreWriteCheck) {
        return {
          success: true,
          content: extractedContent,
          data: { preWriteCheck: detectedPreWrite },
        }
      }
    }

    const cleaned = extractedContent.replace(/<!--[\s\S]*?-->/g, '').trim()

    return {
      success: true,
      content: cleaned || extractedContent || content,
      data: { preWriteCheck: standardPreWriteCheck || undefined },
    }
  }

  private extractContentWithoutMarkers(rawContent: string): string {
    const contentAfterPreWriteRemoval = rawContent.replace(/===\s*PRE_WRITE_CHECK\s*===[\s\S]*?(?===\s*CHAPTER_CONTENT\s*===|#{1,2}\s+第|$)/i, '').trim()

    if (this.hasPreWriteCheckArtifacts(contentAfterPreWriteRemoval)) {
      const headingMatch = contentAfterPreWriteRemoval.match(/^(#{1,2}\s+第\s*\d+\s*章[\s:：])/m)
      if (headingMatch && headingMatch.index !== undefined && headingMatch.index > 0) {
        return contentAfterPreWriteRemoval.slice(headingMatch.index).trim()
      }
    }

    if (!contentAfterPreWriteRemoval || this.hasPreWriteCheckArtifacts(contentAfterPreWriteRemoval)) {
      const rawHeadingMatch = rawContent.match(/^(#{1,2}\s+第\s*\d+\s*章[\s:：])/m)
      if (rawHeadingMatch && rawHeadingMatch.index !== undefined) {
        return rawContent.slice(rawHeadingMatch.index).trim()
      }
      logger.error('[MuseFlow] 错误: 无法分离检查表和正文，检查表可能已混入正文')
      return rawContent.trim()
    }

    return contentAfterPreWriteRemoval
  }

  private hasPreWriteCheckArtifacts(text: string): boolean {
    const artifactPatterns = [
      /预写对齐检查表/,
      /自检清单/,
      /大纲中的每个情节点/,
      /章节规划中的每个段落/,
      /关键台词已标注/,
      /时间线跨度符合/,
      /没有发现与大纲矛盾/,
      /\|\s*检查项\s*\|\s*来源\s*\|/,
      /\[[x\s]\]\s*大纲中的每个情节点/,
      /【段落\s*\d+\s*·\s*第/,
      /【需要修改的段落】/,
      /原文内容缺失，无法准确修复/,
      /问题分析：/,
      /修复建议：/,
      /对应段落/,
    ]
    return artifactPatterns.some(pattern => pattern.test(text))
  }

  private truncateToChapterHeading(text: string): string {
    const headingPattern = /^(#{1,2}\s+第\s*\d+\s*章[\s:：])/m
    const match = text.match(headingPattern)
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
}
