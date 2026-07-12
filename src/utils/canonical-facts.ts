import type { CanonicalFact, FactAttribute, StoryState } from '../types/story-state.js'
import { canonicalizeItemName } from './items.js'

/**
 * 查找 subject + attribute 的 active 权威事实（retiredIn === undefined）。
 *
 * 默认 subject 精确匹配。alignItemNames 为 true 时，在精确匹配失败后按
 * canonicalizeItemName 对齐事实 subject（兼容历史数据中带装饰括号/空白差异的
 * 中文名 key）；调用方传入的 subject canonical 形式为空时不对齐。
 */
export function findActiveCanonicalFact(
  state: StoryState,
  subject: string,
  attribute: FactAttribute,
  options?: { alignItemNames?: boolean }
): CanonicalFact | undefined {
  const activeFacts = (state.canonicalFacts ?? []).filter(
    (fact) => fact.attribute === attribute && fact.retiredIn === undefined
  )
  const exact = activeFacts.find((fact) => fact.subject === subject)
  if (exact !== undefined || options?.alignItemNames !== true) return exact

  const canonicalSubject = canonicalizeItemName(subject)
  if (canonicalSubject.length === 0) return undefined
  return activeFacts.find((fact) => canonicalizeItemName(fact.subject) === canonicalSubject)
}

/**
 * 读取实体属性的当前记录值：active 权威事实优先（subject 精确匹配），
 * 其次回退到对应的结构化投影（location/status/holder）。
 *
 * 这里刻意不做 canonicalizeItemName 对齐：调用方传入的必须是已知实体 id；
 * 历史中文名 key 的对齐由渲染层（formatStoryState）与合并层
 * （applyCanonicalFactsToState）各自处理。
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
