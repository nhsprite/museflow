import type { CanonicalFact, FactAttribute, StoryState } from '../types/story-state.js'

/**
 * 查找 subject + attribute 的 active 权威事实（retiredIn === undefined）。
 */
export function findActiveCanonicalFact(
  state: StoryState,
  subject: string,
  attribute: FactAttribute
): CanonicalFact | undefined {
  return (state.canonicalFacts ?? []).find(
    (fact) =>
      fact.subject === subject && fact.attribute === attribute && fact.retiredIn === undefined
  )
}

/**
 * 读取实体属性的当前记录值：active 权威事实优先（subject 精确匹配），
 * 其次回退到对应的结构化投影（location/status/holder）。
 *
 * 调用方传入的必须是已知实体 id，不做名称或显示文本对齐。
 */
export function resolveEntityAttribute(
  state: StoryState,
  subject: string,
  attribute: FactAttribute
): string | undefined {
  const activeFact = findActiveCanonicalFact(state, subject, attribute)
  if (activeFact) return activeFact.value

  if (attribute === 'location') {
    return state.characterLocations[subject] ?? state.keyItemsLocation[subject]
  }
  if (attribute === 'status') {
    return state.characterStatus[subject] ?? state.keyItemsState[subject]
  }
  if (attribute === 'holder') {
    // story-memory 将物品 holderId 投影到 keyItemsLocation。
    return state.keyItemsLocation[subject]
  }
  return undefined
}
