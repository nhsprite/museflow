export function buildPlannerStoryEventContract(chapterIndex: number): string {
  const base = `"chapterIndex": ${chapterIndex}, "source": "chapter"`

  return `<story_event_json_contract>
expectedEvents 中每个对象必须严格匹配下列一种完整 JSON 结构。示例中的 ID 仅表示字段类型；既有实体、节拍、伏笔与任务必须复用上下文中的权威 ID，新事件及经授权创建的伏笔或任务必须使用唯一、机器可读的新 ID。

- {"id": "evt-id", "type": "character-location", "characterId": "character-id", "locationId": null, ${base}}
- {"id": "evt-id", "type": "character-status", "characterId": "character-id", "attribute": "attribute", "value": "value", ${base}}
- {"id": "evt-id", "type": "item-location", "itemId": "item-id", "holderId": null, "locationId": "location-id", ${base}}
- {"id": "evt-id", "type": "item-state", "itemId": "item-id", "attribute": "attribute", "value": "value", ${base}}
- {"id": "evt-id", "type": "plot-advance", "plotId": "plot-id", "beatId": "beat-id", ${base}}
- {"id": "evt-id", "type": "foreshadow-introduce", "foreshadowId": "foreshadow-id", "expectedFulfillChapter": null, "text": "description", "kind": "other", "required": false, "beatId": null, ${base}}
- {"id": "evt-id", "type": "foreshadow-fulfill", "foreshadowId": "foreshadow-id", ${base}}
- {"id": "evt-id", "type": "task-resolve", "taskId": "task-id", ${base}}
- {"id": "evt-id", "type": "task-create", "taskId": "task-id", "description": "description", ${base}}

严格规则：
- foreshadow-introduce 的 kind 必须是以下枚举值之一：character_arc、environmental_detail、dialogue_hint、object_foreshadow、inner_conflict、plot、other。禁止使用任何其他值。
- item-location 的 holderId 和 locationId 两个字段都必须出现；每个字段的值只能是权威 ID 字符串或 null，禁止省略，禁止写自然语言位置。
- item-state 必须同时包含 attribute 和 value，禁止改写为 state 等其他字段。
- nullable 字段没有适用值时必须显式输出 null，不得省略。
- 不得猜测缺失字段；无法从上下文确定合法事件时，不输出该事件。
</story_event_json_contract>`
}
