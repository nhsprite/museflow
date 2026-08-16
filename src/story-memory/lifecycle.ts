import type {
  CharacterMemory,
  CharacterStatusEvent,
  LifecycleAttribute,
  LifecycleChannel,
  StoryMemory,
} from '../types/story-memory.js'
import { LIFECYCLE_ATTRIBUTES } from '../types/story-memory.js'

/**
 * 生命周期语义的共享判定（B.1）。投影、校验、回采、渲染都从这里取语义，
 * 避免同一规则在多处实现。只做枚举/布尔级的结构化判断，不触碰任何自然语言。
 */

export function isLifecycleAttribute(value: unknown): value is LifecycleAttribute {
  return (LIFECYCLE_ATTRIBUTES as readonly unknown[]).includes(value)
}

/**
 * 从 character-status 事件提取类型化生命周期通道：
 * 1) 显式 lifecycle 字段（写作侧类型化通道）；
 * 2) 结构化推导：attribute 本身命中受控词表且 value 为布尔字面量
 *    （兼容存量事件与自由文本协议中的 `alive -> false` 写法）。
 * 自由文本属性/值不做任何猜测。
 */
export function lifecycleChannelFromStatusEvent(
  event: CharacterStatusEvent
): LifecycleChannel | null {
  const explicit = event.lifecycle
  if (explicit && isLifecycleAttribute(explicit.attribute) && typeof explicit.value === 'boolean') {
    return { attribute: explicit.attribute, value: explicit.value }
  }
  if (isLifecycleAttribute(event.attribute) && typeof event.value === 'boolean') {
    return { attribute: event.attribute, value: event.value }
  }
  return null
}

/**
 * 终态标记：alive=false 为终态。词表扩展时在此集中判定。
 */
export function isTerminalCharacter(character: CharacterMemory | undefined): boolean {
  if (!character?.lifecycle) return false
  return character.lifecycle.alive === false
}

/**
 * 当前投影中所有已置终态标记的角色 id 集合。
 */
export function getTerminalCharacterIds(entities: StoryMemory['entities']): Set<string> {
  const terminal = new Set<string>()
  for (const [id, character] of Object.entries(entities.characters)) {
    if (isTerminalCharacter(character)) terminal.add(id)
  }
  return terminal
}

/**
 * 生命周期事实值的结构化 → 展示文本映射（B.2 回采）。
 * 仅从枚举/布尔生成固定文案，不做任何自然语言解析；词表扩展时在此补充。
 */
const LIFECYCLE_VALUE_LABELS: Record<LifecycleAttribute, { positive: string; negative: string }> = {
  alive: { positive: '存活', negative: '死亡' },
}

export function formatLifecycleFactValue(channel: LifecycleChannel): string {
  const labels = LIFECYCLE_VALUE_LABELS[channel.attribute]
  return channel.value ? labels.positive : labels.negative
}
