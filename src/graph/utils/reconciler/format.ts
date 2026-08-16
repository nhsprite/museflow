import type { StoryState, PendingTask, CanonicalFact } from '../../../types/story-state.js'
import type { StoryMemory } from '../../../types/story-memory.js'
import { findActiveCanonicalFact } from '../../../utils/canonical-facts.js'
import { formatStoryTime, isEmptyStoryTime } from '../../../utils/story-time.js'

/** formatStoryState 渲染上限：避免长篇后期 prompt 无界膨胀。数组均按时间升序追加，保留最新若干条。 */
export const MAX_RENDERED_REVEALED_SECRETS = 20
export const MAX_RENDERED_SUPERSEDED_FACTS = 20
/**
 * 权威事实「其余按新近度」泳道的渲染上限（B.2）：取代旧的 20 条单一窗口。
 * 终态/生命周期事实与本章契约触及实体的事实不受此上限约束（见 prioritizeCanonicalFacts）。
 */
export const MAX_RENDERED_CANONICAL_FACTS = 40

type StoryStateEntities = StoryMemory['entities']

export interface FormatStoryStateOptions {
  /**
   * true 时以「名称（id）」渲染实体，仅供需要精确 id 引用的结构化修复通道
   * （state-repair 的 oldValue 精确匹配）。默认 false：面向正文写作的渲染段
   * 只输出纯名字，内部 id 不得进入可复制进正文的上下文（体例泄漏源收敛）。
   */
  includeEntityIds?: boolean
  /**
   * 本章契约触及的实体 id（B.2）：这些实体的权威事实进入优先渲染泳道，
   * 不被新近度窗口截断。
   */
  priorityEntityIds?: readonly string[]
}

/**
 * 将实体 ID 渲染为 agent 可读标签。默认渲染纯名字（ prose-facing ）；
 * includeEntityIds 时渲染「名称（id）」。实体缺失或名称与 ID 相同时原样返回 ID。
 */
function resolveEntityLabel(
  id: string,
  entities: StoryStateEntities | undefined,
  includeEntityIds: boolean
): string {
  if (!entities) return id
  const name =
    entities.characters[id]?.name ??
    entities.items[id]?.name ??
    entities.locations[id]?.name ??
    entities.factions[id]?.name ??
    entities.plots[id]?.name
  if (name === undefined || name === id) return id
  return includeEntityIds ? `${name}（${id}）` : name
}

function resolveRecordLabels(
  entries: Record<string, string>,
  entities: StoryStateEntities | undefined,
  resolveValues: boolean,
  includeEntityIds: boolean
): Record<string, string> {
  if (!entities) return entries
  const resolved: Record<string, string> = {}
  for (const [key, value] of Object.entries(entries)) {
    resolved[resolveEntityLabel(key, entities, includeEntityIds)] = resolveValues
      ? resolveEntityLabel(value, entities, includeEntityIds)
      : value
  }
  return resolved
}

export function buildPendingTasksConstraints(tasks: PendingTask[]): string {
  const pending = tasks.filter((t) => t.status === 'pending')
  if (pending.length === 0) return ''

  const lines = [
    '【必须继承的前章任务约束】',
    ...pending.map((t) => {
      const due = t.dueTime
        ? `（截止：${t.dueTime}）`
        : t.dueChapter
          ? `（截止章节：第${t.dueChapter}章）`
          : ''
      return `- ${t.assignee}：${t.description}${due}`
    }),
    '',
    '【强制要求】本章规划必须尊重上述任务的执行方式与精确文本。',
    '如果任务要求特定的执行方式或精确文本，本章必须原样遵守，不得改写执行方式或文本。',
    '如果本章只是获知任务结果，必须提供合理的替代信息来源并明确交代，不得让被禁止的直接汇报渠道出现。',
  ]
  return lines.join('\n')
}

export function findMatchingKey(
  record: Record<string, string>,
  subject: string
): string | undefined {
  return record[subject] !== undefined ? subject : undefined
}

export function findMatchingKeys(record: Record<string, string>, subject: string): string[] {
  return record[subject] !== undefined ? [subject] : []
}

/**
 * B.2 权威事实优先级排序（取代旧的单一 20 条窗口）：
 * (a) 终态/生命周期事实（带结构化 lifecycle 标记）永不截断，排在最前；
 * (b) 本章契约触及实体（priorityEntityIds）的事实不被新近度窗口截断；
 * (c) 其余事实按新近度保留至 MAX_RENDERED_CANONICAL_FACTS。
 * 保证早期章节确立的死亡等终态事实在任意后续章节的上下文中仍然可见。
 * 返回值为保序数组，调用方不应再对其二次截断。
 */
export function prioritizeCanonicalFacts(
  facts: CanonicalFact[],
  priorityEntityIds?: readonly string[]
): CanonicalFact[] {
  const priorityIds = new Set(priorityEntityIds ?? [])
  const lifecycleFacts = facts.filter((fact) => fact.lifecycle !== undefined)
  const priorityFacts = facts.filter(
    (fact) => fact.lifecycle === undefined && priorityIds.has(fact.subject)
  )
  const remaining = facts.filter(
    (fact) => fact.lifecycle === undefined && !priorityIds.has(fact.subject)
  )
  return [...lifecycleFacts, ...priorityFacts, ...remaining.slice(-MAX_RENDERED_CANONICAL_FACTS)]
}

/**
 * 单个权威事实段的渲染规格：标题、候选事实（调用方预过滤）、截断条数与逐条行格式。
 */
export interface CanonicalFactsSectionSpec {
  title: string
  facts: CanonicalFact[]
  limit: number
  formatFact: (fact: CanonicalFact) => string[]
}

/**
 * 权威事实段渲染原语：取最后 limit 条 → 非空则输出标题 → 逐条按 formatFact 渲染。
 * 截断条数、标题、顺序与行格式均由调用方通过 spec 控制。
 */
export function formatCanonicalFactsSections(specs: CanonicalFactsSectionSpec[]): string[] {
  const lines: string[] = []
  for (const spec of specs) {
    const sliced = spec.facts.slice(-spec.limit)
    if (sliced.length === 0) continue
    lines.push(spec.title)
    for (const fact of sliced) {
      lines.push(...spec.formatFact(fact))
    }
  }
  return lines
}

export function formatCanonicalItemEntries(
  entries: Record<string, string>,
  sectionTitle: string
): string[] {
  const items = Object.entries(entries)
  if (items.length === 0) return []

  const lines = [sectionTitle]
  for (const [entityId, value] of items) {
    lines.push(`  ${entityId}：${value}`)
  }
  return lines
}

export function formatStoryState(
  storyState: StoryState,
  entities?: StoryStateEntities,
  options: FormatStoryStateOptions = {}
): string {
  const includeEntityIds = options.includeEntityIds ?? false
  const lines: string[] = []

  // 位置投影与权威事实的优先级：某实体存在 active 的 canonicalFact（attribute=location）时，
  // 其位置以【权威事实】段为准，投影条目跳过，避免同一实体两个矛盾位置同时渲染。
  const hasCanonicalLocation = (key: string): boolean =>
    findActiveCanonicalFact(storyState, key, 'location') !== undefined

  const locations = Object.entries(storyState.characterLocations).filter(
    ([char]) => !hasCanonicalLocation(char)
  )
  if (locations.length > 0) {
    lines.push('【角色位置】')
    for (const [char, loc] of locations) {
      lines.push(
        `  ${resolveEntityLabel(char, entities, includeEntityIds)}：${resolveEntityLabel(loc, entities, includeEntityIds)}`
      )
    }
  }

  const statuses = Object.entries(storyState.characterStatus)
  if (statuses.length > 0) {
    lines.push('【角色状态】')
    for (const [char, status] of statuses) {
      lines.push(`  ${resolveEntityLabel(char, entities, includeEntityIds)}：${status}`)
    }
  }

  const keyItemsLocation = Object.fromEntries(
    Object.entries(storyState.keyItemsLocation).filter(([item]) => !hasCanonicalLocation(item))
  )
  lines.push(
    ...formatCanonicalItemEntries(
      resolveRecordLabels(keyItemsLocation, entities, true, includeEntityIds),
      '【关键物品】'
    )
  )
  lines.push(
    ...formatCanonicalItemEntries(
      resolveRecordLabels(storyState.keyItemsState ?? {}, entities, false, includeEntityIds),
      '【关键物品状态】'
    )
  )

  if (storyState.activePlots.length > 0) {
    lines.push('【进行中的情节】')
    for (const plot of storyState.activePlots) {
      lines.push(`  - ${plot}`)
    }
  }

  const revealedSecrets = storyState.revealedSecrets.slice(-MAX_RENDERED_REVEALED_SECRETS)
  if (revealedSecrets.length > 0) {
    lines.push('【已揭示的秘密】')
    for (const secret of revealedSecrets) {
      lines.push(`  - ${secret}`)
    }
  }

  if ((storyState.pendingTasks?.length ?? 0) > 0) {
    lines.push('【待办差事】')
    for (const task of storyState.pendingTasks) {
      const due = task.dueTime ?? (task.dueChapter ? `第${task.dueChapter}章前` : '未指定')
      const statusLabel =
        task.status === 'done'
          ? '已完成'
          : task.status === 'postponed'
            ? '已推迟'
            : task.status === 'superseded'
              ? '已覆盖'
              : task.status === 'expired'
                ? '已到期'
                : '待执行'
      lines.push(`  - [${statusLabel}] ${task.assignee}：${task.description}（截止：${due}）`)
    }
  }

  const supersededFacts = (storyState.supersededFacts ?? []).slice(-MAX_RENDERED_SUPERSEDED_FACTS)
  if (supersededFacts.length > 0) {
    lines.push('【已被覆盖的旧事实】')
    for (const fact of supersededFacts) {
      lines.push(`  - [${fact.subject}] ${fact.oldFact}（原因：${fact.reason}）`)
    }
  }

  const activeCanonicalFacts = (storyState.canonicalFacts ?? []).filter(
    (fact) => fact.retiredIn === undefined
  )
  // B.2 优先级渲染：终态/生命周期事实永不截断，契约触及实体优先，其余按新近度。
  const prioritizedFacts = prioritizeCanonicalFacts(activeCanonicalFacts, options.priorityEntityIds)
  lines.push(
    ...formatCanonicalFactsSections([
      {
        title: '【权威事实】',
        facts: prioritizedFacts,
        limit: prioritizedFacts.length,
        formatFact: (fact) => {
          const tierMarker =
            fact.source === 'outline_inference' ? '（大纲推断，提示级，正文优先）' : ''
          const factLines = [
            `  - [${fact.subject}] ${fact.attribute}: ${fact.value} (第${fact.establishedIn + 1}章确立)${tierMarker}`,
          ]
          for (const old of fact.supersedes ?? []) {
            factLines.push(`    覆盖第${old.chapter + 1}章: ${old.oldValue}`)
          }
          return factLines
        },
      },
    ])
  )

  if (storyState.currentScene) {
    lines.push(`【当前场景】${storyState.currentScene}`)
  }

  if (!isEmptyStoryTime(storyState.storyTime)) {
    lines.push(`【上一章结束时间】${formatStoryTime(storyState.storyTime)}`)
  }

  if (storyState.chapterHandoff) {
    const handoff = storyState.chapterHandoff
    const charactersPresent = handoff.charactersPresent ?? []
    const openQuestions = handoff.openQuestions ?? []
    lines.push('【章节交接】')
    lines.push(`  章节：第${handoff.chapterNumber}章`)
    if (handoff.endScene) lines.push(`  结束场景：${handoff.endScene}`)
    if (!isEmptyStoryTime(handoff.endTime)) {
      lines.push(`  结束时间：${formatStoryTime(handoff.endTime)}`)
    }
    if (charactersPresent.length > 0) {
      lines.push(`  在场角色：${charactersPresent.join('、')}`)
    }
    if (handoff.lastAction) lines.push(`  最后动作：${handoff.lastAction}`)
    if (openQuestions.length > 0) {
      lines.push(`  待承接问题：${openQuestions.join('、')}`)
    }
    if (handoff.requiredNextOpening) {
      lines.push(`  下一章开头要求：${handoff.requiredNextOpening}`)
    }
  }

  return lines.length > 0 ? lines.join('\n') : '（暂无状态记录）'
}
