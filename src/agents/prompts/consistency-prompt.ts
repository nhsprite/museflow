import { renderTemplate } from '../../utils/template.js'
import {
  FACT_CONSISTENCY_RULES,
  FORESHADOW_BOUNDARY_RULES,
  CAPABILITY_CONSISTENCY_RULES,
  AI_PHRASE_PROHIBITIONS,
  SEVERITY_INSTRUCTIONS,
  OFFICIAL_CHARACTER_RULES,
} from './fragments/index.js'

const CONSISTENCY_SYSTEM_PROMPT = `<role>你是一位逻辑严谨的编辑，擅长发现故事中的逻辑漏洞，尤其擅长发现跨章节的角色知识和对话矛盾。</role>\n<standard>${SEVERITY_INSTRUCTIONS}</standard>`

export function buildConsistencySystemPrompt(): string {
  return CONSISTENCY_SYSTEM_PROMPT
}

const CONSISTENCY_USER_PROMPT_TEMPLATE = `<instruction>
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
    {worldSetting}
  </world_setting>

  <characters>
    {characterSetting}
  </characters>

  <outline>
    {outline}
  </outline>

  <story_state>
    【权威事实 - 一致性检查的唯一事实依据】
    {storyState}

    <mandatory>【执行约束】一致性检查必须以本区域中的【权威事实】和【已被覆盖的旧事实】为准。如果本章内容与【权威事实】中的当前有效值一致，即使与旧摘要或旧时间线中的旧值不同，也不构成矛盾。</mandatory>
  </story_state>

  <chapter_time_anchor>
    <mandatory>【本章时间锚点 - 判断时间推进的原点】</mandatory>
    {chapterTimeAnchor}

    <important>以本章时间锚点作为判断时间推进是否合理的依据。本章允许采用回忆、倒叙或跨日叙事，只要与本章时间锚点一致，不视为与上一章结束时间矛盾。</important>
    <important>如果本章时间锚点明确标注了倒计时或剩余时间信息，正文中的时间表述必须与此一致。如有冲突，报 error。</important>
  </chapter_time_anchor>

  {chapterContractSection}

  <superseded_facts>
    以下事实已被后续大纲覆盖或更新，不应视为矛盾：
    {supersededFacts}
    
    判定规则：
    - 如果当前章节与上述 supersededFacts 中的旧事实冲突 → 不要报 error（这是大纲演进导致的正常差异）
    - 只有当角色对已确立的新事实表现出矛盾态度时，才报 error
  </superseded_facts>

  {foreshadowsSection}

  {characterWhitelistSection}

  ${OFFICIAL_CHARACTER_RULES}
</context>

<content_to_check>
  {contentToCheck}
</content_to_check>

  <check_dimensions>
    <dimension name="time" priority="high">事件时间顺序是否合理，是否存在时间跳跃未标注、同一时间点发生矛盾事件等问题</dimension>
    <dimension name="space" priority="high">人物移动、位置变化是否连贯</dimension>
    <dimension name="causality" priority="high">事件因果关系是否合理</dimension>
    <dimension name="character_knowledge" priority="critical">角色对某信息的了解/态度是否与前章矛盾。检查每个角色在前章中已知/承认/说过的事实，对比该角色在本章中对这些事实的态度/反应。标记"角色在前章已知某事实，本章却表现得像第一次听说"这类严重矛盾。注意：如果角色故意装作不知道，必须有合理的动机铺垫，否则视为矛盾。参见 supplementary_rules 中的 "deliberation_vs_discovery" 和 "inference_from_limited_information"：角色对已知情形的沉思推演和合理推断不视为矛盾。</dimension>
    <dimension name="character_whitelist" priority="critical">
      检查本章出现的所有有名有姓、有亲属关系、有 POV 或持续身份的角色是否都在【官方角色】、【大纲登场角色】或【前文已建立角色】列表中。
      如果本章 introduces 不在上述任一列表中的新名字，报 error。
      如果本章把某个已建立角色冠以新的亲属关系，而该关系未被官方设定、前文摘要或故事状态确认，报 error。
      无名功能性角色不构成 invented character，前提是他们没有名字、没有亲属关系、不进入 storyState。
    </dimension>
    <dimension name="timeline_anchor" priority="critical">
      角色在叙述、回忆、内心独白中提及的事件，必须是该角色已经经历过的、或明确被告知的、或在超现实场景中看到的。
      严禁角色将尚未发生的事件描述为已发生的回忆。
      如果角色提及未来事件，必须使用前瞻性的措辞，且必须是在明确的超现实场景中。
      特别注意：涉及非线性叙事时，必须严格区分"已发生的回忆"和"未发生的预示"。
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
    <dimension name="capability_consistency" priority="high">${CAPABILITY_CONSISTENCY_RULES}</dimension>
    <dimension name="world_integrity" priority="high">
      世界规则冲突：描述与已建立的世界规则相悖的内容；时代背景严重错误；已建立的世界规则被违反。
      检查本章是否引入了与官方设定不可调和的新规则或时代错误。
    </dimension>
    <dimension name="outline" priority="critical">
      大纲合规检查：将当前章节正文与大纲（尤其是本章）进行逐条对照。检查本章是否覆盖了大纲要求的核心事件、时间线是否与大纲一致、关键台词是否按大纲出现、是否存在与大纲核心事件相矛盾或冲淡叙事重心的额外情节、人物出场顺序和行为是否符合大纲、章节内部逻辑是否连贯。
      允许为承接前文而设置简短的桥接/过渡场景，但需满足：篇幅不超过配置比例、服务于核心事件的引入或后果承接、不提前完成后续章节的核心结果。对照下一章标题作为边界提示，避免本章提前落地后续章节的核心结果。
    </dimension>
    <dimension name="quality" priority="medium">
      写作质量评审（注意：情节逻辑、事实矛盾、语义一致性已在上述维度中检查，本维度只关注表达层面）：
      - 语言是否流畅、描写是否细腻、用词是否精准
      - 节奏是否合适、是否存在拖沓或仓促
      - 人物刻画是否立体、对话是否生动
      - 是否存在 AI 惯用腔调或总结性套语
      ${AI_PHRASE_PROHIBITIONS}
      质量问题只报 warning 或 info，除非严重到影响读者理解。
    </dimension>
  </check_dimensions>

  <supplementary_rules>
    <rule type="knowledge_vs_reaction">
      区分"已知事实"与"对事实的反应/措辞"：
      - 如果角色在前章已经知道某个事实，本章中对该事实产生情绪反应是正常的人物刻画，不要报 error。
      - 如果本章只是用不同的措辞表达与前章相同的概念，不要报 error。
      - 只有当角色对某个事实的认知本身发生矛盾（前章明确不知道，本章却表现得像已知道；或前章已否认，本章却断言为真）时，才报 error。
    </rule>

    <rule type="deliberation_vs_discovery">
      区分"对已知情形的沉思推演"与"首次发现/认知"：
      - 角色对已经知道的条件、计划、风险进行反复掂量、权衡，属于正常的人物刻画和决策描写，不应视为首次发现或重新学习。
      - 只有当角色表现出对前章已明确告知的信息感到陌生、意外、或需要重新学习时，才构成知识矛盾。
      - 判断标准：角色的内心活动是否使用了"已知信息"作为前提进行推演（合理），还是把已知信息当作新发现来呈现（矛盾）。
    </rule>

    <rule type="inference_from_limited_information">
      区分"合理推断"与"无来源全知"：
      - 角色可以根据本章新获得的信息、前章已揭示的事实、以及人物自身的经验和智力，做出合理的推断或猜测。
      - 如果推断过程有清晰的逻辑链条（即使链条较短），不应视为 knowledge 矛盾。
      - 只有当角色突然掌握其不可能知道的具体细节时，才报 error。
      - 对于"知道某人大致意图"与"知道其全部具体布局"之间的灰色地带，应报 warning 而非 error，除非细节精确到不可能。
    </rule>

    <rule type="pending_tasks">
      前章角色领受的差事属于"待办"而非"已发生事实"：
      - 如果本章通过角色对话、旁白或规划说明该差事被推迟、取消、改期或已完成 → 不要报 consistency error。
      - 只有当差事完全未出现、未解释，且本章时间已到截止日期时 → 才报 error。
      - 判断是否有解释：检查本章是否有任何文字说明该差事被推迟、取消、改期或已完成。
      - 如果前章任务以精确文本确立了执行方式，本章对该方式的任何改写都视为 contradiction，报 error。
      - 如果本章只是通过其他合理渠道获知任务结果，且文本明确交代了信息来源，不视为违反前章确立的执行方式约束。
    </rule>

    <rule type="item_operation_vs_location">
      区分「关键物品/道具当前位置」与「本章操作对象」：
      - 如果本章明确说明角色操作的是副本、替代品或诱饵，或明确说明原始物品已于别处转移，则不要因"关键物品出现在场景中"而报 location 矛盾。
      - 只有当本章未加说明地让关键物品出现在与权威事实冲突的位置，或同时声称关键物品在不同位置时，才报 error。
      - 角色对关键物品进行常规操作，本身不违反"分散管理"原则；关键看文本是否交代了操作对象的性质。
      - 判断标准：如果文本明确区分了操作对象与物品当前位置，则不构成矛盾；如果文本让读者误以为原始物品就在操作现场，则报 error。
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
    当前章节可以通过回忆、角色对话、旁白或秘密行动揭示等方式补充前面章节缺失的铺垫，这些情况不应视为剧情断裂。
    判定标准：
    - 如果本章明确给出了解释，说明角色状态变化的原因 → 不要报 error
    - 如果本章完全没有解释，角色状态突然改变且没有任何说明 → 报 error
  </rule>

  <rule type="data_source_priority">
    数据来源优先级（非常重要）：
    1. chapterTimeAnchor（本章时间锚点）是本章时间推进的最高权威。如果本章有明确的 chapterTimeAnchor，以它判断时间是否合理，而不是以 storyState.storyTime。
    2. storyState 中的【权威事实】是角色位置、物品状态、已揭示秘密、角色对话/承诺/已知信息的最高权威。本章内容必须与【权威事实】中的当前有效值保持一致。
    3. outline（大纲）是未来章节事实规划的最高权威。
    4. 【已被覆盖的旧事实】记录了过去已被更新的事实，仅用于判断角色是否对已覆盖的旧事实表现出不合理态度；不应将本章与旧事实一致的内容误判为矛盾。

    判定跨章节矛盾时：
    - 如果当前章节与 chapterTimeAnchor 冲突 → 报 error
    - 如果当前章节与【权威事实】冲突，且无 chapterTimeAnchor 解释 → 报 error
    - 如果当前章节与 outline 冲突 → 报 error
    - 只有当角色对已被【权威事实】/outline 确立的事实表现出矛盾态度时，才报 error
    - 如果本章内容与【权威事实】当前值一致，即使与旧摘要中的旧值不同，也不构成矛盾
  </rule>

  <rule type="canonical_facts_authority">
    权威事实层（canonical facts）是最高权威：
    1. 如果 story_state 中的【权威事实】与 timelineSnapshot 或 chapter summaries 中的旧事实冲突，以【权威事实】为准。
    2. 被权威事实明确标记为"覆盖"的旧事实，不应作为当前章节的矛盾依据。
    3. 只有当角色对权威事实中当前有效的值表现出不合理态度时，才报 consistency error。
    4. 本章内容若与权威事实中的当前值一致，即使与旧摘要中的旧值不同，也不构成矛盾。
    5. <mandatory>【执行约束】在输出最终 issues 前，你必须逐条审查每个候选 issue。如果某个候选 issue 的描述或建议与 canonicalFacts 中的任何一条事实直接矛盾，则必须删除该候选 issue，不得在最终 JSON 中报告。</mandatory>
    6. <mandatory>【执行约束】如果 canonicalFacts 已经明确记录了某个信息的传递方式、物品位置或角色行动，本章只要与该记录一致，就不应报 consistency error，即使该记录与你的常识推断不同。</mandatory>
    7. <mandatory>【执行约束】如果【本章大纲已授权的新事实】中记录了某个事实，本章内容中出现该事实属于正常叙事推进，不得将其判定为"擅自发明"、"无来源引入"或"状态污染"。</mandatory>
  </rule>

  {outlineAuthorizedFactsSection}

  <rule type="addressing_consistency">
    人物称呼一致性：检查角色对彼此的称呼是否与前文已建立的称呼习惯一致。如果本章中某角色突然用新的称呼指代另一角色，且没有明确交代原因，报 error。
  </rule>

  <rule type="item_origin_consistency">
    关键物品来源一致性：如果本章中角色使用了一件关键物品（尤其是武器、特殊物品/关键道具、重要道具），而该物品在前文中尚未明确出现或回归，本章又没有交代其来源或回归过程，则报 error。
  </rule>

  <rule type="future_information_boundary">
    未来信息边界：角色不得在本章明确提及或确认尚未发生的事件，除非处于明确的特殊叙事框架或超现实场景中。如果角色提前计算章节进度、提前揭示未来章节的核心反派或核心事件，且没有合理的知识来源铺垫，报 error。
  </rule>

  <rule type="core_actor_consistency">
    大纲核心动作执行者一致性：如果大纲明确指出某个动作由特定角色完成，本章必须让该角色作为核心执行者。如果核心动作被改由其他角色主导完成，报 error。
  </rule>

  <rule type="writing_advice_vs_consistency_error">
    区分“写作建议”与“一致性错误”：
    - 如果本章没有与权威事实、大纲或世界规则发生直接冲突，只是“可以补充交代”、“可以增加描写”、“建议明确某处时间线”等写作层面的提示，应报 warning 或 info，不要报 error。
    - 只有当本章内容与已确立的权威事实、大纲要求或世界规则存在明确矛盾，或遗漏了必须回收的伏笔/关键信息时，才报 error。
    - 判断标准：删除这段文字是否会导致读者对情节产生困惑。如果只是“可以写得更好”，不要报 error。
  </rule>

<severity_levels>
  <error>以下严重问题：跨章节的角色知识/对话矛盾、时间线严重矛盾、关键信息前后矛盾、因果关系完全断裂、必须回收的伏笔未回收、伏笔被提前剧透、伏笔回收方向矛盾、结构化状态矛盾、世界规则严重冲突、时代背景严重错误。报 error 前请确认：该问题确实会让读者产生困惑，而不是作者刻意留下的叙事张力或 gradual revelation。</error>
  <warning>一般性不一致或中等质量问题：细节描述有轻微出入、时间标记不够明确、表述歧义、前面章节缺少铺垫但本章已补充说明、伏笔回收方式可以更好、角色对新信息的反应/联想存在多种解读可能、文笔略显平淡、节奏轻微失衡、个别 AI 腔调。</warning>
  <info>建议性意见：可以加强因果关联、可以补充过渡段落、可以改进伏笔回收的冲击力、可以丰富描写层次。</info>
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
        "aspect": "time|space|causality|character_knowledge|dialogue|information|foreshadowing|pace|world_integrity|outline|quality",
        "location": "具体位置",
        "locationRef": {"paragraphNumber": 1, "sentenceNumber": 1},
        "suggestion": "具体的修复建议（指明如何修改以消除矛盾）"
      }
    ]
  }
  如果问题可以精确定位到当前章节正文的段落或句子，必须用 locationRef 输出正整数编号；paragraphNumber 和 sentenceNumber 均从 1 开始计数。不要把"第三段"、"结尾处"等自然语言位置写入 locationRef；不能精确定位时省略 locationRef 或设为 null。
  如果没有任何问题，请返回 {"is_consistent": true, "issues": []}。
</output_format>`

export interface ConsistencyPromptSections {
  characterWhitelistSection: string
  outlineAuthorizedFactsSection: string
  foreshadowsSection: string
  chapterContractSection: string
}

export interface ConsistencyPromptVariables {
  chapterIndex: number
  worldSetting: string
  characterSetting: string
  outline: string
  storyState: string
  chapterTimeAnchor: string
  supersededFacts: string
  contentToCheck: string
}

export function buildConsistencyUserPrompt(
  sections: ConsistencyPromptSections,
  vars: ConsistencyPromptVariables
): string {
  return renderTemplate(CONSISTENCY_USER_PROMPT_TEMPLATE, {
    ...sections,
    ...vars,
  })
}
