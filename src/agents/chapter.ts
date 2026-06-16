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
<mandatory>【故事当前状态 - 必须严格保持】</mandatory>
${state.storyState}

<mandatory>【强制要求】以上状态是截至上一章结束时已确立的事实。本章写作时必须：
- 角色位置：如果角色位置发生变化，必须有合理的移动过程描写，不能瞬间转移
- 角色状态：如果角色处于受伤/中毒/虚弱等状态，本章必须承认这些状态，除非有明确的恢复描写
- 关键物品：物品的位置和持有者必须与前文一致，转移时必须有明确交接过程
- 故事时间：时间推进必须符合逻辑，不能跳回过去</mandatory>
</story_state>`
      : ''

    const outlineComplianceSection = `<outline_compliance>
<mandatory>【大纲遵循 - 强制要求】</mandatory>
- 本章只能呈现大纲中明确列出的情节点，不得擅自添加大纲未提及的新情节、新场景或新角色
- 如果大纲中某角色被描述为"暗中跟踪"、"暗中观察"或类似定位，该角色不得在本章中公开出现在主角团队面前，不得与主角团队公开互动
- 如果大纲中指定了某个守护者/神明的身份（如"西王母"），不得擅自改为"弟子"、"使者"或其他替代身份
- 不得擅自增加大纲未提及的考验、试炼、关卡等情节
- 不得擅自改变大纲中明确指定的角色关系（如"暗中护法"不得变为"正式入队"）
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

    const mainCharacterName = state.characters
      ? (state.characters.match(/^【([^】]+)】/m)?.[1] || '（未设定主角）')
      : '（未设定主角）'

    const planSection = state.chapterPlan
      ? `<chapter_plan>
<instruction>【章节写作规划】（必须严格遵循以下结构）：</instruction>
${JSON.stringify(state.chapterPlan, null, 2)}
</chapter_plan>`
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
- 回收至少 60% 的主要伏笔
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

    const userContent = `<task>
<instruction>请撰写第 ${displayChapterNumber} 章的正文内容。</instruction>

<main_character>
<important>【重要】本章主角姓名是"${mainCharacterName}"，主角的姓名在整章中必须保持一致，不得擅自更改为主角起其他名字！</important>
</main_character>

<chapter_outline>
<requirement>【必须严格遵循】本章大纲：</requirement>
<title>标题：${chapterInfo.title}</title>
<description>核心事件：${chapterInfo.description}</description>

<important>【重要】大纲中的每个情节点都必须完整呈现！如果大纲中提到"与此同时"、"另外"、"并且"等连接的多个事件，必须在章节中呈现所有事件，不可遗漏任何情节点！</important>
</chapter_outline>

<world_setting>
<requirement>【必须严格遵循】世界观设定：</requirement>
${state.world || '（尚未构建）'}
</world_setting>

<character_setting>
<requirement>【必须严格遵循】人物设定：</requirement>
${state.characters || '（尚未创建）'}
</character_setting>

<previous_summary>
前几章摘要：
${previousSummary}
</previous_summary>

${chapterSupplement}

${timelineSection}

${keyEventsSection}

${storyStateSection}

${factVerificationSection}

${planSection}

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
<rule id="0"><mandatory>【必须】</mandatory>正文开头必须包含章节标题，格式为：
   # 第X章 章节标题
   或
   ## 第X章：章节标题
   标题必须与大纲中的章节标题一致，不得省略。</rule>
<rule id="1"><mandatory>【必须】</mandatory>严格按照大纲的每一个情节点展开剧情，大纲中提到的所有事件都必须完整呈现</rule>
<rule id="2"><mandatory>【必须】</mandatory>主角姓名必须保持为"${mainCharacterName}"，不得擅自为主角起其他名字</rule>
<rule id="3"><mandatory>【必须】</mandatory>物品名称、功法名称等必须与大纲完全一致</rule>
<rule id="4"><mandatory>【必须】</mandatory>时间线必须清晰连贯：
   - 时间跨度必须符合大纲要求（如"高烧持续三日"必须描写三日，不能只写一夜）
   - 时间跳跃必须明确标注（如"三日后""次日清晨""又过了两天"）
   - 不能出现时间回退或逻辑矛盾（如先写"烧退了"，后又写"仍在发烧"）</rule>
<rule id="5"><mandatory>【必须】</mandatory>关键台词必须原样出现：
   - 大纲中明确要求的台词（如大纲标注的特定对话）必须一字不差地出现
   - 不能擅自改写为意思相近但措辞不同的句子</rule>
<rule id="6"><mandatory>【必须】</mandatory>叙述视角保持一致（第三人称限制性视角），避免出现视角跳跃</rule>
<rule id="7"><mandatory>【必须】</mandatory>因果关系明确：前一事件的结果必须自然导致后一事件，不能生硬跳转</rule>
<rule id="8"><mandatory>【必须】</mandatory>信息一致性：本章内所有描述必须自洽，不能前后矛盾</rule>
<rule id="9"><mandatory>【必须】</mandatory>禁止 AI 惯用腔调，具体包括：
   - 禁止总结性开头：不得以"值得一提的是"、"不难发现"、"众所周知"、"值得注意的是"等句式开头段落
   - 禁止机械过渡：不得使用"让我们回到"、"接下来"、"与此同时"等说教性过渡
   - 禁止抽象概括：不得用"这个故事告诉我们"、"从这件事可以看出"等作者跳出来总结的句式
   - 必须用具体的人物动作、感官细节或场景变化来推动叙事，替代抽象的概括和评价</rule>
<rule id="10">注重人物对话和心理描写</rule>
<rule id="11">适时埋下伏笔，为后续章节留下悬念</rule>
<rule id="12"><mandatory>【必须】</mandatory>每章字数要求：
    - 每章字数应均匀分布，避免出现过短章节
    - 如果本章字数明显少于其他章节，必须扩充内容直至篇幅均衡
    - 严禁用几句话草率收尾，每章都必须有充实的情节展开</rule>
<rule id="13"><mandatory>【必须】</mandatory>章节结尾要求：
    - 章节结尾必须是情节的自然收束，不得使用任何显式的章节结束标记
    - 禁止在结尾添加总结性诗句、对联、套语或任何形式的"本章完"标注
    - 结尾应当留给读者余韵，而非刻意宣告叙事中断</rule>
<rule id="14"><mandatory>【必须】</mandatory>跨章节衔接要求：
    - 本章结尾的动作、对话或场景，不得与上一章结尾重复
    - 禁止连续两章以相同角色做相同或高度相似的事情作为结尾
    - 本章开头应当自然承接上一章的结尾，但不得简单重复上一章最后一段的内容</rule>
<rule id="15"><mandatory>【必须】</mandatory>时间线一致性：
    - 角色在叙述、回忆、内心独白中提及的事件，必须是该角色已经经历过的、或明确被告知的
    - 严禁角色将尚未发生的事件描述为已发生的回忆
    - 如果角色提及未来事件，必须使用前瞻性的措辞（如"将要"、"等待"），且必须是在明确的预言、梦境或超现实场景中</rule>
<rule id="16">以自然流畅的段落叙述为主</rule>
</content>
</chapter_content_section>

请严格按照上述格式输出：先输出 === PRE_WRITE_CHECK === 部分，再输出 === CHAPTER_CONTENT === 部分。
</output_format>
</task>`

    return [
      this.systemMessage(`<system>
<role>专业小说作家</role>
<capability>擅长细腻的描写、丰富的人物刻画和扣人心弦的情节推进</capability>
<requirement>在动笔前，你必须先完成预写对齐检查，确认每个大纲要求都有明确的执行计划，然后严格按照该计划撰写正文</requirement>
</system>`),
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
    const characterLocations = extractSection('角色位置', storyState)
    const characterStatuses = extractSection('角色状态', storyState)
    const keyItems = extractSection('关键物品', storyState)

    const facts: string[] = []
    if (characterLocations) {
      facts.push(`<established_locations>\n【角色位置】\n${characterLocations}\n</established_locations>`)
    }
    if (characterStatuses) {
      facts.push(`<established_statuses>\n【角色状态】\n${characterStatuses}\n</established_statuses>`)
    }
    if (keyItems) {
      facts.push(`<established_items>\n【关键物品】\n${keyItems}\n</established_items>`)
    }
    if (revealedSecrets) {
      facts.push(`<established_secrets>\n【已揭示的秘密】\n${revealedSecrets}\n</established_secrets>`)
    }
    if (supersededFacts) {
      facts.push(`<superseded_facts>\n【已被覆盖的旧事实】\n${supersededFacts}\n</superseded_facts>`)
    }

    if (facts.length === 0) {
      return ''
    }

    return `<canonical_facts>\n<mandatory>【事实核查 - 写正文前必须完成】</mandatory>\n以下是截至上一章结束时已确立的权威事实。本章涉及以下主题时，必须与这些事实保持一致：\n\n${facts.join('\n\n')}\n\n<mandatory>【强制要求】\n- 涉及物品来源、制造者、材质时，必须与上述事实一致\n- 涉及角色关系、身份、起源时，必须与上述事实一致\n- 涉及角色位置、状态时，必须与上述事实一致\n- 涉及世界设定、规则、历史时，必须与上述事实一致\n- 如果大纲引入新设定与已确立事实冲突，必须标注为"大纲新设定"并说明区别\n- 严禁 invent 新的事实来支持情节</mandatory>\n</canonical_facts>`
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
    const standardPreWriteMatch = content.match(/===\s*PRE_WRITE_CHECK\s*===([\s\S]*?)(?:===\s*CHAPTER_CONTENT\s*===|$)/i)
    const standardPreWriteCheck = standardPreWriteMatch && standardPreWriteMatch[1] ? standardPreWriteMatch[1].trim() : ''

    const standardContentMatch = content.match(/===\s*CHAPTER_CONTENT\s*===([\s\S]*)/i)
    let extractedContent: string

    if (standardContentMatch && standardContentMatch[1]) {
      extractedContent = standardContentMatch[1].trim()
    } else {
      console.warn('[MuseFlow] 警告: 未检测到标准的 === CHAPTER_CONTENT === 标记，尝试智能截断...')
      extractedContent = this.extractContentWithoutMarkers(content)
    }

    if (this.hasPreWriteCheckArtifacts(extractedContent)) {
      console.warn('[MuseFlow] 警告: 正文中检测到检查表残留，执行清理...')
      extractedContent = this.truncateToChapterHeading(extractedContent)
    }

    const chapterHeadingPattern = /^(#{1,2}\s+第\s*\d+\s*章[\s:：]|#{1,2}\s+第\s*\d+\s*部分[\s:：]|#{1,2}\s+\d+[\.、]\s+|#{1,2}\s+章节?\s*\d+)/m
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
      console.error('[MuseFlow] 错误: 无法分离检查表和正文，检查表可能已混入正文')
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
            createdAtChapter: chapterIndex + 1,
            status: 'planted',
            isExplicit: false,
          })
        }
      }
    }

    return foreshadows.slice(0, 5)
  }
}
