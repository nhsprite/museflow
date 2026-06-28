export const AI_PHRASE_PROHIBITIONS = `<ai_phrase_rules>
<mandatory>【必须】禁止使用 AI 惯用腔调</mandatory>
- 禁止以总结性、评价性或已知性套语开头段落。
- 禁止使用说教式、导演式或机械性过渡句推进叙事。
- 禁止使用作者跳出来进行抽象概括、道德总结或意义提炼的句式。
- 必须用具体的人物动作、感官细节或场景变化来推动叙事，替代抽象的概括和评价。
</ai_phrase_rules>`

export const TIMELINE_RULES = `<timeline_rules>
<mandatory>【必须】时间线必须清晰连贯</mandatory>
- 大纲要求的时间跨度必须在正文得到完整呈现，不得压缩或省略。
- 时间跳跃必须通过明确的时间标记进行过渡。
- 不能出现时间回退或状态逻辑矛盾。
- 角色在叙述、回忆、内心独白中提及的事件，必须是该角色已经经历过的、或明确被告知的。
- 严禁角色将尚未发生的事件描述为已发生的回忆；若提及未来事件，必须使用前瞻性措辞，且必须处于明确的预言、梦境或超现实场景中。
</timeline_rules>`

export const FACT_CONSISTENCY_RULES = `<fact_consistency_rules>
<mandatory>【必须】本章内所有事实必须保持一致</mandatory>
- 角色位置、状态、物品持有者必须与已确立的故事状态保持一致；发生变化时必须有明确过程。
- 关键物品在同一时刻只能由唯一持有者持有，转移必须通过明确动作完成。
- 角色称呼、已揭示秘密、未来信息边界等需与前面章节建立的事实保持一致。
- 涉及物品来源、制造者、材质、来历、赠予者时，必须与权威事实完全一致；若权威事实未记录且大纲未明确引入新来源，必须保持来源未说明，不得 invent 新的事实来支持情节。
- 如果大纲引入新设定与已确立事实冲突，必须标注为"大纲新设定"并说明区别。
- <mandatory>涉及多个用途、来源或归属不同的同类物品时，必须使用完整名称或精确限定语明确区分，不得以模糊指代将不同物品混为一谈。</mandatory>
- <mandatory>不得为已有关键物品/设定 invent 新的来源、新的制造者或新的来历；也不得把已有的来源/制造者替换为另一个。</mandatory>
</fact_consistency_rules>`

export const POWER_SYSTEM_RULES = `<power_system_rules>
<mandatory>【必须】能力/力量体系必须保持一致</mandatory>
- 角色实战表现必须与其已确立的能力等级、状态保持一致。
- 虚弱、受伤或未恢复状态的角色不得展现全盛期持续战斗力。
- 低等级角色与高等级角色交手时，必须明确给出能支撑的理由（地形、外力、对方留手等），不能默认势均力敌。
- 大纲中"长时间缠斗"等描述应理解为难以速胜，而非双方战力完全相等。
</power_system_rules>`

export const CROSS_CHAPTER_CONTINUITY_RULES = `<cross_chapter_continuity_rules>
<mandatory>【必须】跨章节衔接自然且不重复</mandatory>
- 本章结尾的动作、对话或场景，不得与上一章结尾重复。
- 禁止连续两章以相同角色做相同或高度相似的事情作为结尾。
- 本章开头应当自然承接上一章的结尾，但不得简单重复上一章最后一段的内容。
- 本章只能呈现当前大纲要求的事件，不得擅自推进到后续章节的核心事件。
- 前章遗留的差事属于"待办"而非"已发生事实"：本章可以仅承认其待办/推迟状态，不必在本章内全部执行完毕。
</cross_chapter_continuity_rules>`

export const FORESHADOW_BOUNDARY_RULES = `<foreshadow_boundary_rules>
<mandatory>【必须】正确区分伏笔与正常叙事</mandatory>
- 本章首次引入的新设定、新身份、新场景、新对话属于正常叙事推进，不是"伏笔提前泄露"。
- 只有当本章明确揭示了前序章节中已埋下并标注为"待后续回收"的具体悬念时，才构成伏笔回收。
- 不要为了让角色"知道"而凭空补充前序未明确交代的细节；如果大纲要求本章揭示新信息，必须通过合理的叙事方式呈现，并明确交代信息来源。
- 角色通过自身经历、对话或合理推理在本章自然得出的信息，即使与后续大纲暗合，也不得视为"提前剧透"。
</foreshadow_boundary_rules>`

export const CHAPTER_OUTPUT_RULES = `<chapter_output_rules>
<mandatory>【必须】章节输出格式要求</mandatory>
- 正文开头必须包含章节标题，格式为"# 第X章 章节标题"或"## 第X章：章节标题"，标题必须与大纲中的章节标题一致。
- 章节结尾必须是情节的自然收束，不得使用任何显式的章节结束标记、总结性套语、装饰性对句或中断声明。
- 结尾应当留给读者余韵，而非刻意宣告叙事中断。
</chapter_output_rules>`

export const FIX_OUTPUT_RULES = `<fix_output_rules>
<mandatory>【必须】修复输出要求</mandatory>
- 只输出修改后的正文内容或指定句子/段落。
- 不要输出任何辅助性内容，包括但不限于问题分析、修复建议、修改方案、检查表、清单或表格。
- 修改时必须彻底替换原句/原段落，绝不允许原句和新句同时存在。
- 修改后通读上下文，确保没有句子重复出现。
</fix_output_rules>`

export const SEVERITY_INSTRUCTIONS = `<severity_instructions>
- 只有真正影响阅读理解的严重问题才报 error。
- 一般性质量问题或轻微不一致报 warning。
- 建议性意见报 info。
- 请严格控制 error 数量。
- 正面评价必须放入 strengths，严禁放入 issues。
- 如果某个维度没有问题，直接不写对应的 issue，不要写"未发现问题"的 issue。
- Do not emit issues that merely state a dimension is fine, good, satisfactory, or has no problems.
</severity_instructions>`

import type { Character } from '../types/character.js'

export interface CharacterWhitelistInput {
  charactersList?: Character[] | undefined
  outlineCharacters?: Character[] | undefined
  establishedCharacters?: Character[] | undefined
}

export function buildCharacterWhitelistSection(state: CharacterWhitelistInput): string {
  const establishedCharactersSection = state.establishedCharacters && state.establishedCharacters.length > 0
    ? `<established_characters>
<mandatory>【前文已建立角色】以下角色已在前面章节的摘要或故事状态中出现，允许在本章继续使用：</mandatory>
${state.establishedCharacters.map(c => `- ${c.name}${c.description ? `：${c.description}` : ''}`).join('\n')}
</established_characters>`
    : ''

  if (!state.charactersList || state.charactersList.length === 0) {
    return establishedCharactersSection
  }

  return `<official_characters>
<mandatory>【必须】以下为本故事官方角色。正文中出场的所有有名有姓、有亲属关系、有身份地位的角色必须来自此列表、【大纲登场角色】列表或【前文已建立角色】列表；任何不在这些列表中的人名不得获得 POV、台词、亲属称呼或持久身份：</mandatory>
${state.charactersList.map(c => `- ${c.name}${c.description ? `：${c.description}` : ''}`).join('\n')}
</official_characters>${state.outlineCharacters && state.outlineCharacters.length > 0 ? `
<outline_characters>
<mandatory>【大纲登场角色】以下角色由大纲明确命名并将在本章或之前章节登场，允许在本章出现：</mandatory>
${state.outlineCharacters.map(c => `- ${c.name}${c.description ? `：${c.description}` : ''}`).join('\n')}
</outline_characters>` : ''}${establishedCharactersSection}`
}

export function buildCanonicalFactsSection(facts: string[]): string {
  if (facts.length === 0) return ''
  return `<canonical_facts>
<mandatory>【事实核查 - 写正文前必须完成】</mandatory>
以下是截至上一章结束时已确立的权威事实。本章涉及以下主题时，必须与这些事实保持一致：

${facts.join('\n\n')}

<mandatory>【强制要求】
- 涉及物品来源、制造者、材质时，必须与上述事实一致
- 涉及角色关系、身份、起源时，必须与上述事实一致
- 涉及角色位置、状态时，必须与上述事实一致
- 涉及世界设定、规则、历史时，必须与上述事实一致
- 如果大纲引入新设定与已确立事实冲突，必须标注为"大纲新设定"并说明区别
- 严禁 invent 新的事实来支持情节</mandatory>
</canonical_facts>`
}

export const OFFICIAL_CHARACTER_RULES = `<official_character_rules>
<mandatory>【必须】只能使用官方角色与大纲预告角色</mandatory>
- 本任务中 "官方角色" 指【人物设定】中明确列出的角色；"大纲预告角色" 指【大纲登场角色】中列出的、由大纲明确命名并将在本章或之前章节登场的新角色。
- 严禁为故事 invent 全新的角色名字、亲属称呼或身份，除非该角色已经出现在【大纲登场角色】中。
- 如果大纲要求未指定身份的动作执行者，必须从官方角色或大纲预告角色中选择；若均不适合，只能虚构一个不获取姓名、不建立亲属关系、不进入 storyState 的无名功能性角色。
- 角色之间的亲属关系必须来自人物设定或大纲，不得自行添加。
- 任何新角色如果要在正文中出现，必须先在大纲或人物设定中有依据；否则只能以无名的功能性身份出现，且不得在 storyState 中留下记录。
</official_character_rules>`

export const FORESHADOW_DISCIPLINE_RULES = `<foreshadow_discipline_rules>
<mandatory>【必须】不得提前揭示未到期的伏笔</mandatory>
- 如果【伏笔回收提醒】中将某条信息标注为"正常伏笔（后续章节回收）"，本章只能埋下暗示、不能揭示其核心内容。
- 严禁在本章把应在后续章节才明确揭示的秘密提前摊开在正文或角色对话中。
- 如果角色"似乎知道"某条未来信息，必须有明确的知识来源（他人告知、合理推断、亲眼目睹），不能凭空全知。
</foreshadow_discipline_rules>`

export const STATE_AUTHORITY_RULES = `<state_authority_rules>
<mandatory>【必须】storyState 是最高事实权威，但只能记录真实来源</mandatory>
- storyState 中的角色位置、状态、物品位置只能记录官方角色和本章明确发生转移的物品。
- 禁止把 invented 角色、推测性身份、无名功能性角色写入 storyState。
- 如果本章为某个物品提供了新的位置，必须同时确认旧位置记录已被覆盖或标记为 superseded。
</state_authority_rules>`

export const ABSTRACT_OUTCOME_RULES = `<abstract_outcome_rules>
<mandatory>【必须】抽象大纲事件不得通过 invent 新元素来具象化</mandatory>
- 当大纲要求呈现抽象的社会、政治、群体或关系后果时，只能通过以下方式体现：已建立角色的反应、已有线索的状态变化、环境氛围变化、旁白暗示、或已埋伏笔的回收。
- 严禁为此类抽象后果 invent 新的代表人物、新的关系网络、新的阵营标签、新的情节线或新的秘密组织。
- 如果大纲未提供具体的执行角色或触发事件，应将其处理为背景氛围或已有角色的内心/对话反应，而不是扩展为独立场景。
</abstract_outcome_rules>`

export const PENDING_TASK_AUTHORITY_RULES = `<pending_task_authority_rules>
<mandatory>【必须】pendingTasks 对角色的位置与行动构成强制约束</mandatory>
- 角色在本章中的物理位置和核心行动，必须与其 pendingTasks 中记录的位置/行动要求一致。
- 如果情节需要角色偏离 pendingTasks 的约束，正文必须明确给出该任务被重新委派、改期、取消或已完成的情节，否则视为严重矛盾。
- 不得为了让某个场景发生而临时让角色"顺便"去执行与 pendingTasks 冲突的行动。
</pending_task_authority_rules>`

export const TIME_ANCHOR_AUTHORITY_RULES = `<time_anchor_authority_rules>
<mandatory>【必须】chapterTimeAnchor 是本章叙事的绝对时间起点</mandatory>
- 本章所有事件的时间推进必须以 chapterTimeAnchor 为原点，不得出现本章时间范围内角色提前获知尚未发生事件具体细节的情节。
- 如果某个机密信息在本章时间锚点之后才发生，任何角色（包括反派）在信息实际发生之前不得精确复述其内容、措辞或后果。
- 角色可以基于已有线索进行合理推测，但必须有明确的推断逻辑，且不得将推测表述为已知事实。
</time_anchor_authority_rules>`
