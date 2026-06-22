export const AI_PHRASE_PROHIBITIONS = `<ai_phrase_rules>
<mandatory>【必须】禁止使用 AI 惯用腔调</mandatory>
- 禁止总结性开头：不得以"值得一提的是"、"不难发现"、"众所周知"、"值得注意的是"等句式开头段落。
- 禁止机械过渡：不得使用"让我们回到"、"接下来"、"与此同时"等说教性过渡。
- 禁止抽象概括：不得用"这个故事告诉我们"、"从这件事可以看出"等作者跳出来总结的句式。
- 必须用具体的人物动作、感官细节或场景变化来推动叙事，替代抽象的概括和评价。
</ai_phrase_rules>`

export const TIMELINE_RULES = `<timeline_rules>
<mandatory>【必须】时间线必须清晰连贯</mandatory>
- 时间跨度必须符合大纲要求（如"高烧持续三日"必须描写三日，不能只写一夜）。
- 时间跳跃必须明确标注（如"三日后"、"次日清晨"、"又过了两天"）。
- 不能出现时间回退或逻辑矛盾（如先写"烧退了"，后又写"仍在发烧"）。
- 角色在叙述、回忆、内心独白中提及的事件，必须是该角色已经经历过的、或明确被告知的。
- 严禁角色将尚未发生的事件描述为已发生的回忆；若提及未来事件，必须使用前瞻性措辞，且必须处于明确的预言、梦境或超现实场景中。
</timeline_rules>`

export const FACT_CONSISTENCY_RULES = `<fact_consistency_rules>
<mandatory>【必须】本章内所有事实必须保持一致</mandatory>
- 角色位置、状态、物品持有者必须与已确立的故事状态保持一致；发生变化时必须有明确过程。
- 关键物品在同一时刻只能由唯一持有者持有，转移必须通过递、接、取、放、披、解等明确动作完成。
- 角色称呼、已揭示秘密、未来信息边界等需与前面章节建立的事实保持一致。
- 涉及物品来源、制造者、材质时，必须与权威事实一致；不得 invent 新的事实来支持情节。
- 如果大纲引入新设定与已确立事实冲突，必须标注为"大纲新设定"并说明区别。
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
</cross_chapter_continuity_rules>`

export const FORESHADOW_BOUNDARY_RULES = `<foreshadow_boundary_rules>
<mandatory>【必须】正确区分伏笔与正常叙事</mandatory>
- 本章首次引入的新设定、新身份、新场景、新对话属于正常叙事推进，不是"伏笔提前泄露"。
- 只有当本章明确揭示了前序章节中已埋下并标注为"待后续回收"的具体悬念时，才构成伏笔回收。
- 不要为了让角色"知道"而凭空补充前序未明确交代的细节；如果大纲要求本章揭示新信息，请通过角色对话、感知、他人告知等合理方式呈现。
- 角色通过自身经历、对话或合理推理在本章自然得出的信息，即使与后续大纲暗合，也不得视为"提前剧透"。
</foreshadow_boundary_rules>`

export const CHAPTER_OUTPUT_RULES = `<chapter_output_rules>
<mandatory>【必须】章节输出格式要求</mandatory>
- 正文开头必须包含章节标题，格式为"# 第X章 章节标题"或"## 第X章：章节标题"，标题必须与大纲中的章节标题一致。
- 章节结尾必须是情节的自然收束，不得使用任何显式的章节结束标记。
- 禁止在结尾添加总结性诗句、对联、套语或任何形式的"本章完"标注。
- 结尾应当留给读者余韵，而非刻意宣告叙事中断。
</chapter_output_rules>`

export const FIX_OUTPUT_RULES = `<fix_output_rules>
<mandatory>【必须】修复输出要求</mandatory>
- 只输出修改后的正文内容或指定句子/段落。
- 不要输出"问题分析"、"修复建议"、"修改方案"、"预写检查表"、"自检清单"、Markdown 表格等辅助内容。
- 修改时必须彻底替换原句/原段落，绝不允许原句和新句同时存在。
- 修改后通读上下文，确保没有句子重复出现。
</fix_output_rules>`

export const SEVERITY_INSTRUCTIONS = `<severity_instructions>
- 只有真正影响阅读理解的严重问题才报 error。
- 一般性质量问题或轻微不一致报 warning。
- 建议性意见报 info。
- 请严格控制 error 数量。
- 正面评价（如"未检测到 AI 痕迹"、"语言流畅"等）必须放入 strengths，严禁放入 issues。
- 如果某个维度没有问题，直接不写对应的 issue，不要写"未发现问题"的 issue。
</severity_instructions>`

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
