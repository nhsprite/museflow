export const STATE_AUTHORITY_RULES = `<state_authority_rules>
<mandatory>【必须】权威事实由 storyEvents 中的状态变更事件推导</mandatory>
- 角色位置、状态、物品位置/状态等权威事实，必须基于本章 <story_events> 中明确输出的结构化事件推导，不得凭空构造。
- 禁止把 invented 角色、推测性身份、无名功能性角色写入事件或事实。
- 如果本章导致某物品位置或状态发生变化，必须在事件中输出新的状态，并确保与此前已确立的事实保持一致；如需覆盖旧事实，应通过事件类型与对应 ID 显式表达。
- 不要在此输出 storyState 字符串；所有状态变更必须通过 <story_events> 中的结构化事件承载。
</state_authority_rules>`
