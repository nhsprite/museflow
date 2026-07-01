export const STATE_AUTHORITY_RULES = `<state_authority_rules>
<mandatory>【必须】storyState 是最高事实权威，但只能记录真实来源</mandatory>
- storyState 中的角色位置、状态、物品位置只能记录官方角色和本章明确发生转移的物品。
- 禁止把 invented 角色、推测性身份、无名功能性角色写入 storyState。
- 如果本章为某个物品提供了新的位置，必须同时确认旧位置记录已被覆盖或标记为 superseded。
</state_authority_rules>`
