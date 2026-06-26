import { BaseAgent, type AgentState, type AgentOutput } from './base.js'
import type { Issue } from '../types/agent.js'
import { generateId } from '../utils/id.js'
import { buildLayeredSummaries } from '../utils/summary-compressor.js'
import { TIMELINE_RULES, FACT_CONSISTENCY_RULES, FORESHADOW_BOUNDARY_RULES, POWER_SYSTEM_RULES, SEVERITY_INSTRUCTIONS, OFFICIAL_CHARACTER_RULES } from './prompt-fragments.js'

export class ConsistencyAgent extends BaseAgent {
  constructor() {
    super(undefined, 0.3)
  }
  protected buildPrompt(state: AgentState): import('../model/provider.js').Message[] {
    const chapterIndex = (state.chapterIndex ?? 0) + 1
    const existingForeshadows = state.foreshadowStack || []
    const activeForeshadows = existingForeshadows.filter(f => !f.fulfilledChapter)
    const overdueForeshadows = activeForeshadows.filter(
      f => chapterIndex > f.expectedFulfillChapter + 1
    )
    const mustFulfillForeshadows = activeForeshadows.filter(
      f => !f.fulfilledChapter && chapterIndex >= f.expectedFulfillChapter && chapterIndex <= f.expectedFulfillChapter + 1
    )

    const establishedCharactersSection = state.establishedCharacters && state.establishedCharacters.length > 0
      ? `<established_characters>
<mandatory>【前文已建立角色】以下角色已在前面章节的摘要或故事状态中出现，不属于 invented character：</mandatory>
${state.establishedCharacters.map(c => `- ${c.name}${c.description ? `：${c.description}` : ''}`).join('\n')}
</established_characters>`
      : ''

    const characterWhitelistSection = state.charactersList && state.charactersList.length > 0
      ? `<official_characters>
<mandatory>【必须】以下为本故事官方角色。本章出现的所有有名有姓、有亲属关系、有 POV 或持久身份的角色必须来自此列表、下方【大纲登场角色】列表或【前文已建立角色】列表：</mandatory>
${state.charactersList.map(c => `- ${c.name}${c.description ? `：${c.description}` : ''}`).join('\n')}
</official_characters>${state.outlineCharacters && state.outlineCharacters.length > 0 ? `
<outline_characters>
<mandatory>【大纲登场角色】以下角色由大纲明确命名并将在本章或之前章节登场，不属于 invented character：</mandatory>
${state.outlineCharacters.map(c => `- ${c.name}${c.description ? `：${c.description}` : ''}`).join('\n')}
</outline_characters>` : ''}${establishedCharactersSection}`
      : establishedCharactersSection

    const userContent = `<instruction>
  你是一位逻辑严谨的编辑，擅长发现故事中的逻辑漏洞，尤其擅长发现跨章节的角色知识和对话矛盾。
  ${SEVERITY_INSTRUCTIONS}
  特别注意：不要因措辞不同、合理情绪反应或本章正常引入的新信息而误报 error。
</instruction>

  <scope>
  你需要检测两类问题：
  <internal>当前章节内部的逻辑矛盾（时间、空间、因果）</internal>
  <cross_chapter>当前章节与前面章节之间的逻辑矛盾（角色知识、对话内容、事件描述、信息传递）</cross_chapter>
  <note>对于跨章节矛盾：如果当前章节的写法与前面章节已经确立的事实冲突，即使"问题看起来根源于前面章节"，也必须报告。这类跨章节角色知识矛盾是严重的叙事漏洞，必须被发现。</note>
  <note type="pending_tasks">前章角色领受的差事属于"待办"而非"已发生事实"。本章如果明确推迟、改期或取消该差事，并有合理说明，不视为矛盾。只有当差事完全未出现、未解释，且已到截止时间时，才报 error。</note>
</scope>

<context>
  <world_setting>
    ${state.world || '（暂无世界观设定）'}
  </world_setting>

  <characters>
    ${state.characters || '（暂无人物设定）'}
  </characters>

  <outline>
    ${state.outline || '（暂无大纲）'}
  </outline>

  <timeline>
    ${state.timelineSnapshot || '（暂无历史记录）'}
  </timeline>

  <chapter_summaries>
    ${buildLayeredSummaries(state.chapterSummaries ?? [], state.chapterIndex ?? 0)}
  </chapter_summaries>

  <story_state>
    【上一章结束时间参考】
    ${state.storyState || '（暂无状态记录）'}
  </story_state>

  <chapter_time_anchor>
    <mandatory>【本章时间锚点 - 判断时间推进的原点】</mandatory>
    ${state.chapterPlan?.chapterTimeAnchor || state.chapterTimeAnchor || '（未指定，默认以本章自身时间线为准）'}

    <important>以本章时间锚点作为判断时间推进是否合理的依据。本章允许采用回忆、倒叙或跨日叙事，只要与本章时间锚点一致，不视为与上一章结束时间矛盾。</important>
    <important>如果本章时间锚点明确标注了"三日期限第 X 天"、"还剩 Y 天"等信息，正文中的倒计时表述必须与此一致。如有冲突，报 error。</important>
  </chapter_time_anchor>

  <superseded_facts>
    以下事实已被后续大纲覆盖或更新，不应视为矛盾：
    ${state.supersededFacts || '（无）'}
    
    判定规则：
    - 如果当前章节与上述 supersededFacts 中的旧事实冲突 → 不要报 error（这是大纲演进导致的正常差异）
    - 只有当角色对已确立的新事实表现出矛盾态度时，才报 error
  </superseded_facts>

  <foreshadows>
    <active>
      ${activeForeshadows.length > 0
        ? activeForeshadows.map((f, i) => `  <item index="${i + 1}" created_at="${f.createdAtChapter ?? '?'}" expected="${f.expectedFulfillChapter}">${f.text}</item>`).join('\n')
        : '（暂无未回收伏笔）'}
    </active>
    ${mustFulfillForeshadows.length > 0 ? `
    <must_fulfill>
      ${mustFulfillForeshadows.map((f, i) => `  <item index="${i + 1}" expected="${f.expectedFulfillChapter}" current="${chapterIndex}">${f.text}</item>`).join('\n')}
    </must_fulfill>` : ''}
    ${overdueForeshadows.length > 0 ? `
    <overdue>
      ${overdueForeshadows.map((f, i) => `  <item index="${i + 1}" expected="${f.expectedFulfillChapter}" current="${chapterIndex}" overdue="${chapterIndex - f.expectedFulfillChapter}">${f.text}</item>`).join('\n')}
    </overdue>` : ''}
  </foreshadows>

  ${characterWhitelistSection}

  ${OFFICIAL_CHARACTER_RULES}
</context>

<content_to_check>
  ${state.chapterContent || '（无内容）'}
</content_to_check>

  <check_dimensions>
    <dimension name="time" priority="high">事件时间顺序是否合理，是否存在时间跳跃未标注、同一时间点发生矛盾事件等问题</dimension>
    <dimension name="space" priority="high">人物移动、位置变化是否连贯</dimension>
    <dimension name="causality" priority="high">事件因果关系是否合理</dimension>
    <dimension name="character_knowledge" priority="critical">角色对某信息的了解/态度是否与前章矛盾。检查每个角色在前章中已知/承认/说过的事实，对比该角色在本章中对这些事实的态度/反应。标记"角色在前章已知某事实，本章却表现得像第一次听说"这类严重矛盾。注意：如果角色故意装作不知道，必须有合理的动机铺垫（如欺骗、试探），否则视为矛盾。参见 supplementary_rules 中的 "deliberation_vs_discovery" 和 "inference_from_limited_information"：角色对已知情形的沉思推演和合理推断不视为矛盾。</dimension>
    <dimension name="character_whitelist" priority="critical">
      检查本章出现的所有有名有姓、有亲属关系、有 POV 或持续身份的角色是否都在【官方角色】、【大纲登场角色】或【前文已建立角色】列表中。
      如果本章 introduces 新名字（如"某个未登记的路人"、"某个未说明身份的亲戚"），且不在上述任一列表中，报 error。
      如果本章把某个已建立角色冠以新的亲属关系（如称"胞兄"），而该关系未被官方设定、前文摘要或故事状态确认，报 error。
      临时龙套（柜上伙计、轿夫、门房等无名角色）不构成 invented character，前提是他们没有名字、没有亲属关系、不进入 storyState。
    </dimension>
    <dimension name="timeline_anchor" priority="critical">
      角色在叙述、回忆、内心独白中提及的事件，必须是该角色已经经历过的、或明确被告知的、或在超现实场景（如预言、梦境、幻象）中看到的。
      严禁角色将尚未发生的事件描述为已发生的回忆。
      如果角色提及未来事件，必须使用前瞻性的措辞，且必须是在明确的超现实场景中。
      特别注意：涉及非线性叙事（如闪回、预言、多重时间线）时，必须严格区分"已发生的回忆"和"未发生的预示"。
    </dimension>
    <dimension name="dialogue" priority="critical">角色说过的话是否前后矛盾。前一章角色亲口说的内容，本章不能自相矛盾</dimension>
    <dimension name="information" priority="high">关键信息（物品、消息、秘密）的传递和知悉情况是否前后一致</dimension>
    <dimension name="foreshadowing" priority="critical">
      必须回收的伏笔：检查上述"必须在本章回收"和"已逾期"的伏笔是否在本章得到回收。如果未回收，报 error
      伏笔提前剧透：检查本章是否提前泄露了尚未到期的伏笔内容
      伏笔回收一致性：如果本章回收了某个伏笔，检查回收内容是否与埋下时的暗示方向一致
      正常伏笔：检查"正常伏笔"是否被不当地提前揭示
      ${FORESHADOW_BOUNDARY_RULES}
    </dimension>
    <dimension name="pace" priority="medium">本章节奏是否与整体故事节奏一致</dimension>
    <dimension name="structured_state" priority="critical">
      ${FACT_CONSISTENCY_RULES}
      情节推进一致性：本章的情节发展是否遵循"进行中的情节"列表，不应无故中断或偏离
      秘密揭示一致性：本章新揭示的秘密是否已经被记录在"已揭示的秘密"中，或是否属于合理的新揭示
      时间推进一致性：故事时间是否合理推进，不能倒退或与"故事当前状态"中的时间标记矛盾
    </dimension>
    <dimension name="power_system" priority="high">${POWER_SYSTEM_RULES}</dimension>
  </check_dimensions>

  <supplementary_rules>
    <rule type="knowledge_vs_reaction">
      区分"已知事实"与"对事实的反应/措辞"：
      - 如果角色在前章已经知道某个事实（如自己的使命、身份），本章中对该事实产生情绪反应（震惊、沉思、感慨）是正常的人物刻画，不要报 error。
      - 如果本章只是用不同的措辞表达与前章相同的概念，不要报 error。
      - 只有当角色对某个事实的认知本身发生矛盾（前章明确不知道，本章却表现得像已知道；或前章已否认，本章却断言为真）时，才报 error。
    </rule>

    <rule type="deliberation_vs_discovery">
      区分"对已知情形的沉思推演"与"首次发现/认知"：
      - 角色对已经知道的条件、计划、风险进行反复掂量、权衡、在心里过秤，属于正常的人物刻画和决策描写，**不是**知识矛盾。
      - 例如：角色已知前章明确告知的交易条件或约定，本章开头仍在心里"把条件过了一遍"、"掂量利弊"、"比较两害相权"，这是合理的沉思过程，不应视为"仿佛第一次推演"。
      - 只有当角色表现出对前章已明确告知的信息感到陌生、意外、或需要重新学习时，才构成知识矛盾。
      - 判断标准：角色的内心活动是否使用了"已知信息"作为前提进行推演（合理），还是把已知信息当作新发现来呈现（矛盾）。
    </rule>

    <rule type="inference_from_limited_information">
      区分"合理推断"与"无来源全知"：
      - 角色可以根据本章新获得的信息、前章已揭示的事实、以及人物自身的经验和智力，做出合理的推断或猜测。
      - 如果推断过程有清晰的逻辑链条（即使链条较短），不应视为 knowledge 矛盾。
      - 只有当角色突然掌握其不可能知道的具体细节（如他人秘密计划的具体步骤、未出现人物的真实身份、未发生事件的精确结果）时，才报 error。
      - 对于"知道某人大致意图"与"知道其全部具体布局"之间的灰色地带，应报 warning 而非 error，除非细节精确到不可能。
    </rule>

    <rule type="pending_tasks">
      前章角色领受的差事属于"待办"而非"已发生事实"：
      - 如果本章通过角色对话、旁白或规划说明该差事被推迟、取消、改期或已完成 → 不要报 consistency error。
      - 只有当差事完全未出现、未解释，且本章时间已到截止日期时 → 才报 error。
      - 判断是否有解释：检查本章是否有任何文字说明该差事"改日再办"、"已被其他事取代"、"不必办了"或"已办毕"。
    </rule>

    ${FORESHADOW_BOUNDARY_RULES}

    <rule type="character_reaction_scope">
      角色反应的选择性：
      - 角色对某个信息或刺激有反应，而对另一个信息或刺激没有反应，属于人物刻画和注意力聚焦，不一定构成矛盾。
      - 只有当角色**必须**知道/感应某事（基于前文明确 establish 的能力或义务），且本章中完全无视并因此导致剧情断裂时，才报 error。
      - 如果角色的感知能力在本章被描述为对特定对象有感应，但没有被描述为对所有相关对象都有感应，不要因选择性反应而报 error。
    </rule>

    <rule type="expression_vs_knowledge">
      区分"角色知道某事"与"角色是否表达出来"：
      - 角色已经知道某事，但选择大声说出来、嘲讽、质问，属于性格驱动的表达方式，不是 knowledge 矛盾。
      - 只有当角色对某事的认知本身前后矛盾（前章不知道，本章却知道；或前章否认，本章却断言）时，才报 error。
      - 角色对同一事实的不同情绪反应或表达方式，不应视为 consistency 错误。
    </rule>

    <rule type="outline_visibility">
      大纲可见性说明：你看到的 outline 仅包含当前章节及之前章节的完整内容，以及下一章的标题。后续章节的具体剧情对你不可见。因此，你不应以"后续大纲会如何揭示"为由判定当前章节剧透。
    </rule>

    <rule type="chapter_explanation">
    当前章节可以通过以下方式补充前面章节缺失的铺垫，这些情况不应视为剧情断裂：
    - 回忆/倒叙：本章开头用回忆补充说明"昨夜发生了X事件"
    - 角色对话揭示：本章中角色说"三日前我已安排人手..."
    - 旁白补充：作者在本章用旁白交代"原来在读者不知道的时候，X已经发生了"
    - 秘密行动揭示：本章揭示前面章节未写的秘密行动（如营救、潜入、调查）
    判定标准：
    - 如果本章明确给出了解释（无论这个解释是通过回忆、对话还是旁白），说明角色状态变化的原因 → 不要报 error
    - 如果本章完全没有解释，角色状态突然改变且没有任何说明 → 报 error
  </rule>

  <rule type="data_source_priority">
    数据来源优先级（非常重要）：
    1. chapterTimeAnchor（本章时间锚点）是本章时间推进的最高权威。如果本章有明确的 chapterTimeAnchor，以它判断时间是否合理，而不是以 storyState.storyTime。
    2. storyState（上一章结束时间参考）是角色位置、物品状态、已揭示秘密的最高权威，但不是本章唯一时间原点。
    3. outline（大纲）是未来章节事实规划的最高权威。
    4. timelineSnapshot 和 chapter summaries 是历史章节的压缩记录，可能包含已被覆盖或修正的旧认知。
    
    判定跨章节矛盾时：
    - 如果当前章节与 chapterTimeAnchor 冲突 → 报 error
    - 如果当前章节与 storyState 冲突，但与 chapterTimeAnchor 一致 → 不视为时间矛盾
    - 如果当前章节与 storyState 冲突，且无 chapterTimeAnchor → 报 error
    - 如果当前章节与 outline 冲突 → 报 error
    - 只有当角色对已被 storyState/outline 确立的事实表现出矛盾态度时，才报 error
  </rule>

  <rule type="canonical_facts_authority">
    权威事实层（canonical facts）是最高权威：
    1. 如果 story_state 中的【权威事实】与 timelineSnapshot 或 chapter summaries 中的旧事实冲突，以【权威事实】为准。
    2. 被权威事实明确标记为"覆盖"的旧事实，不应作为当前章节的矛盾依据。
    3. 只有当角色对权威事实中当前有效的值表现出不合理态度时，才报 consistency error。
    4. 本章内容若与权威事实中的当前值一致，即使与旧摘要中的旧值不同，也不构成矛盾。
  </rule>

  <rule type="addressing_consistency">
    人物称呼一致性：检查角色对彼此的称呼是否与前文已建立的称呼习惯一致。如果本章中某角色突然用新的称呼指代另一角色，且没有明确交代原因，报 error。
  </rule>

  <rule type="item_origin_consistency">
    关键物品来源一致性：如果本章中角色使用了一件关键物品（尤其是武器、法宝、重要道具），而该物品在前文中尚未明确出现或回归，本章又没有交代其来源或回归过程，则报 error。
  </rule>

  <rule type="future_information_boundary">
    未来信息边界：角色不得在本章明确提及或确认尚未发生的事件，除非处于明确的预言、梦境或超现实场景中。如果角色提前计算章节进度、提前揭示未来章节的核心反派或核心事件，且没有合理的知识来源铺垫，报 error。
  </rule>

  <rule type="core_actor_consistency">
    大纲核心动作执行者一致性：如果大纲明确指出某个动作由特定角色完成，本章必须让该角色作为核心执行者。如果核心动作被改由其他角色主导完成，报 error。
  </rule>

<severity_levels>
  <error>以下严重逻辑矛盾：跨章节的角色知识/对话矛盾、时间线严重矛盾、关键信息前后矛盾、因果关系完全断裂、必须回收的伏笔未回收、伏笔被提前剧透、伏笔回收方向矛盾、结构化状态矛盾。报 error 前请确认：该问题确实会让读者产生困惑，而不是作者刻意留下的叙事张力或 gradual revelation。</error>
  <warning>一般性不一致：细节描述有轻微出入、时间标记不够明确、表述歧义、前面章节缺少铺垫但本章已补充说明、伏笔回收方式可以更好、角色对新信息的反应/联想存在多种解读可能</warning>
  <info>建议性意见：可以加强因果关联、可以补充过渡段落、可以改进伏笔回收的冲击力</info>
</severity_levels>

<output_format>
  请输出 JSON 格式的检测结果。注意：每个 issue 的 type 字段必须固定为字符串 "consistency"，不要写成 "quality" 或其他类型：
  {
    "is_consistent": true,
    "issues": [
      {
        "type": "consistency",
        "severity": "error|warning|info",
        "description": "问题描述（请明确指出涉及哪些章节的哪些内容）",
        "aspect": "time|space|causality|character_knowledge|dialogue|information|foreshadowing|pace",
        "location": "具体位置",
        "suggestion": "具体的修复建议（指明如何修改以消除矛盾）"
      }
    ]
  }
  如果没有任何逻辑问题，请返回 {"is_consistent": true, "issues": []}。
</output_format>`

    return [
      this.systemMessage(`<role>你是一位逻辑严谨的编辑，擅长发现故事中的逻辑漏洞，尤其擅长发现跨章节的角色知识和对话矛盾。</role>\n<standard>${SEVERITY_INSTRUCTIONS}</standard>`),
      this.userMessage(userContent),
    ]
  }

  protected parse(content: string): AgentOutput {
    const trimmed = content.trim()
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return { success: false, error: '无法解析检测数据：未找到 JSON 格式' }
    }
    try {
      const data = JSON.parse(jsonMatch[0])
      return { success: true, data }
    } catch {
      return { success: false, error: '无法解析检测数据：JSON 格式错误' }
    }
  }

  processOutput(output: AgentOutput): Issue[] {
    console.log('[MuseFlow] DEBUG: ConsistencyAgent.processOutput called')
    if (!output.success || !output.data) return []
    const data = output.data as {
      is_consistent?: boolean
      issues?: Array<{
        type?: string
        severity?: string
        description?: string
        aspect?: string
        location?: string
        suggestion?: string
      }>
    }

    if (data.is_consistent === true) {
      return []
    }

    const rawIssues = data.issues || []
    console.log(`[MuseFlow] DEBUG: Raw consistency issues count: ${rawIssues.length}`)

    const withdrawnPattern = /撤回|不成立|不构成严重矛盾|此条不成立|重新审视后|不构成.*矛盾|不视为/i
    const activeIssues = rawIssues.filter(issue => {
      const desc = `${issue.description ?? ''} ${issue.suggestion ?? ''}`
      return !withdrawnPattern.test(desc)
    })
    
    return activeIssues.map(issue => {
      const result: Issue = {
        id: generateId(),
        type: 'consistency',
        severity: (issue.severity as IssueSeverity) || 'warning',
        description: issue.description || '',
      }
      if (issue.location) {
        result.location = issue.location
      }
      if (issue.suggestion) {
        result.suggestion = issue.suggestion
      }
      return result
    })
  }
}

type IssueSeverity = 'error' | 'warning' | 'info'
