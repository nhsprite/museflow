import type { CanonicalFact } from '../../../types/story-state.js'
import type {
  ChapterFinalStateDeclaration,
  LifecycleChannel,
  StoryEvent,
} from '../../../types/story-memory.js'
import {
  formatLifecycleFactValue,
  lifecycleChannelFromStatusEvent,
} from '../../../story-memory/lifecycle.js'
import {
  FINAL_STATE_EVENT_TYPES,
  entityIdFromEvent,
  finalStateEventValue,
} from '../../../story-memory/validator.js'
import { generateId } from '../../../utils/id.js'

/**
 * 章节定稿事实回采（B.2）：从本章已接受事件流与受佐证的章末终态声明派生
 * canonicalFacts（source 为既有枚举值 'chapter_text'，语义为「定稿时回采」）。
 * 只消费类型化事件/声明数据，不解析任何正文文本。
 *
 * 回采的事实类型：
 * - 生命周期事实：character-status 的 lifecycle 通道（alive=false 死亡等）与
 *   显式 character-revival 事件，带结构化 lifecycle 标记（渲染层据此永不截断）；
 * - 身份事实（B.3）：entity-register 注册事件派生 identity 事实
 *   （subject=entityId，value=displayName），使注册实体的名字成为权威事实；
 * - 持有人变更：item-location 事件的非空 holderId；
 * - 终态声明：仅回采被本章事件流佐证的声明（与校验层同一 corroboration 规则），
 *   未被佐证的声明只是提示级信号，不提升为权威事实。
 */
export interface HarvestChapterFactsInput {
  chapterIndex: number
  acceptedEvents: StoryEvent[]
  finalStateDeclarations: ChapterFinalStateDeclaration[]
}

export function harvestChapterCanonicalFacts(input: HarvestChapterFactsInput): CanonicalFact[] {
  const { chapterIndex, acceptedEvents, finalStateDeclarations } = input
  const facts: CanonicalFact[] = []

  const lifecycleFact = (subject: string, channel: LifecycleChannel): CanonicalFact => ({
    id: generateId('fact'),
    subject,
    attribute: 'lifecycle',
    value: formatLifecycleFactValue(channel),
    establishedIn: chapterIndex,
    confidence: 'high',
    source: 'chapter_text',
    lifecycle: channel,
  })

  for (const event of acceptedEvents) {
    if (event.type === 'character-status') {
      const channel = lifecycleChannelFromStatusEvent(event)
      if (channel) {
        facts.push(lifecycleFact(event.characterId, channel))
      }
    } else if (event.type === 'character-revival') {
      // 显式复活：投影层清除终态标记的同一事件，回采为「存活」生命周期事实。
      facts.push(lifecycleFact(event.characterId, { attribute: 'alive', value: true }))
    } else if (event.type === 'entity-register') {
      // 实体注册（B.3）：注册即确立身份事实（entityId -> displayName）。
      facts.push({
        id: generateId('fact'),
        subject: event.entityId,
        attribute: 'identity',
        value: event.displayName,
        establishedIn: chapterIndex,
        confidence: 'high',
        source: 'chapter_text',
      })
    } else if (event.type === 'item-location' && event.holderId !== null) {
      facts.push({
        id: generateId('fact'),
        subject: event.itemId,
        attribute: 'holder',
        value: event.holderId,
        establishedIn: chapterIndex,
        confidence: 'high',
        source: 'chapter_text',
      })
    }
  }

  // 同一实体同一属性重复声明时以最后一条为准（与校验层一致）。
  const declarations = new Map<string, ChapterFinalStateDeclaration>()
  for (const declaration of finalStateDeclarations) {
    declarations.set(`${declaration.entityId} ${declaration.attribute}`, declaration)
  }

  for (const declaration of declarations.values()) {
    if (declaration.value === null) continue
    const supportedTypes = FINAL_STATE_EVENT_TYPES[declaration.attribute]
    const candidates = acceptedEvents.filter(
      (event) =>
        (supportedTypes as readonly string[]).includes(event.type) &&
        entityIdFromEvent(event) === declaration.entityId
    )
    const lastEvent = candidates[candidates.length - 1]
    if (!lastEvent || finalStateEventValue(lastEvent) !== declaration.value) continue
    // 生命周期事件的布尔终态值已由 lifecycle 事实覆盖，不再派生裸布尔文本的 status 事实。
    if (lastEvent.type === 'character-status' && lifecycleChannelFromStatusEvent(lastEvent)) {
      continue
    }
    facts.push({
      id: generateId('fact'),
      subject: declaration.entityId,
      attribute: declaration.attribute,
      value: declaration.value,
      establishedIn: chapterIndex,
      confidence: 'high',
      source: 'chapter_text',
    })
  }

  return facts
}
