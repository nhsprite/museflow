export function buildPlannerStoryEventContract(chapterIndex: number): string {
  const base = `"chapterIndex": ${chapterIndex}, "source": "chapter"`

  return `<story_event_json_contract>
expectedEvents 中每个对象必须严格匹配下列一种完整 JSON 结构。示例中的 ID 仅表示字段类型；既有实体、节拍、伏笔与任务必须复用上下文中的权威 ID，新事件及经授权创建的伏笔或任务必须使用唯一、机器可读的新 ID。

- {"id": "evt-id", "type": "character-location", "characterId": "character-id", "locationId": null, ${base}}
- {"id": "evt-id", "type": "character-status", "characterId": "character-id", "attribute": "attribute", "value": "value", ${base}}
- {"id": "evt-id", "type": "item-location", "itemId": "item-id", "holderId": null, "locationId": "location-id", ${base}}
- {"id": "evt-id", "type": "item-state", "itemId": "item-id", "attribute": "attribute", "value": "value", ${base}}
- {"id": "evt-id", "type": "plot-advance", "plotId": "plot-id", "beatId": "beat-id", ${base}}
- {"id": "evt-id", "type": "foreshadow-introduce", "foreshadowId": "foreshadow-id", "expectedFulfillChapter": null, "text": "description", "resolutionQuestion": "unresolved question", "fulfillmentCriteria": "observable resolution criteria", "kind": "other", "resolutionPolicy": "should_resolve", "required": true, "beatId": null, ${base}}
- {"id": "evt-id", "type": "foreshadow-fulfill", "foreshadowId": "foreshadow-id", ${base}}
- {"id": "evt-id", "type": "task-resolve", "taskId": "task-id", ${base}}
- {"id": "evt-id", "type": "task-create", "taskId": "task-id", "description": "description", ${base}}

严格规则：
- 所有 ID（characterId、itemId、locationId、holderId、beatId、foreshadowId、taskId 等）必须使用上下文提供的机器可读 ID（如 c-character-id、item-item-id），禁止使用中文名称、描述性短语或自造 ID 作为 ID 字段的值。
- 位置变化与状态变化的区分（高频错误，务必注意）：
  - character-location：角色从一个地点移动到另一个地点（如离开、抵达、回家、出门）。只要角色位置发生改变，就必须使用此类型，不得使用 character-status。
  - item-location：物品被移动、交接、取出、放回、随身携带、锁回某处等导致物品所在位置或持有者变化的情况。"锁回木箱""放入抽屉""贴身携带"等动作都属于位置变化，必须使用 item-location，并将木箱/抽屉/角色等对应 ID 填入 locationId 或 holderId。
  - 【关键区分】locationId 是物品的"主位置"（canonical location）。物品最终停留在某个固定地点/容器时，locationId 必须是该地点/容器 ID，holderId 必须为 null；物品最终被角色随身携带且其位置就是该角色时，locationId 应填写该角色 ID（与 holderId 一致），而不是某个地点 ID。禁止出现 "locationId=地点ID 但 holderId=角色ID" 这种两者语义矛盾的写法。
  - item-state：仅用于物品自身属性变化，如破损、开封、浸湿、折叠、密封状态变化、燃烧等，不用于位置变化。
  - 如果 expectedEvents 已提供 item-location，正文必须逐字段复用该事件；禁止把 location 变化改写成 item-state。
- foreshadow-introduce 的 kind 必须是以下枚举值之一：character_arc、environmental_detail、dialogue_hint、object_foreshadow、inner_conflict、plot、other。禁止使用任何其他值。
- foreshadow-introduce 的 resolutionPolicy 必须是 must_resolve、should_resolve、may_remain_open 之一；must_resolve 必须提供有限的 expectedFulfillChapter，should_resolve 与 may_remain_open 的 expectedFulfillChapter 必须为 null。
- 新建 must_resolve 伏笔必须提供非空 resolutionQuestion 与 fulfillmentCriteria，分别描述待消解的问题和可观察的叙事完成判据；新建 should_resolve 伏笔应尽量提供。兼容已有事件时允许两字段缺失，不得为 legacy 记录臆造内容。
- 没有可辩护截止章节时默认使用 should_resolve；只有允许永久保持开放的氛围性或解释性线索才使用 may_remain_open。required 是兼容字段：must_resolve 与 should_resolve 为 true，may_remain_open 为 false。
- item-location 的 holderId 和 locationId 两个字段都必须出现；每个字段的值只能是权威 ID 字符串或 null，禁止省略，禁止写自然语言位置。
- item-state 必须同时包含 attribute 和 value，禁止改写为 state 等其他字段。
- nullable 字段没有适用值时必须显式输出 null，不得省略。
- 不得猜测缺失字段；无法从上下文确定合法事件时，不输出该事件。
</story_event_json_contract>`
}
