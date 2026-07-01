export const TIMELINE_RULES = `<timeline_rules>
<mandatory>【必须】时间线必须清晰连贯</mandatory>
- 大纲要求的时间跨度必须在正文得到完整呈现，不得压缩或省略。
- 时间跳跃必须通过明确的时间标记进行过渡。
- 不能出现时间回退或状态逻辑矛盾。
- 角色在叙述、回忆、内心独白中提及的事件，必须是该角色已经经历过的、或明确被告知的。
- 严禁角色将尚未发生的事件描述为已发生的回忆；若提及未来事件，必须使用前瞻性措辞，且必须处于明确的特殊叙事框架或超现实场景中。
</timeline_rules>`

export const TIME_ANCHOR_AUTHORITY_RULES = `<time_anchor_authority_rules>
<mandatory>【必须】chapterTimeAnchor 是本章叙事的绝对时间起点</mandatory>
- 本章所有事件的时间推进必须以 chapterTimeAnchor 为原点，不得出现本章时间范围内角色提前获知尚未发生事件具体细节的情节。
- 如果某个机密信息在本章时间锚点之后才发生，任何角色（包括反派）在信息实际发生之前不得精确复述其内容、措辞或后果。
- 角色可以基于已有线索进行合理推测，但必须有明确的推断逻辑，且不得将推测表述为已知事实。
</time_anchor_authority_rules>`
