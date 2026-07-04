import type { StoryState, PendingTask } from '../../../types/story-state.js'
import { canonicalizeItemName } from '../../../utils/items.js'

export function buildPendingTasksConstraints(tasks: PendingTask[]): string {
  const pending = tasks.filter(t => t.status === 'pending')
  if (pending.length === 0) return ''

  const lines = [
    '【必须继承的前章任务约束】',
    ...pending.map(t => {
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

export function findMatchingKey(record: Record<string, string>, subject: string): string | undefined {
  if (record[subject] !== undefined) return subject
  const canonicalSubject = canonicalizeItemName(subject)
  if (canonicalSubject.length === 0) return undefined
  for (const key of Object.keys(record)) {
    if (canonicalizeItemName(key) === canonicalSubject) return key
  }
  return undefined
}

export function findMatchingKeys(record: Record<string, string>, subject: string): string[] {
  const keys: string[] = []
  const canonicalSubject = canonicalizeItemName(subject)
  const hasCanonical = canonicalSubject.length > 0
  for (const key of Object.keys(record)) {
    if (key === subject) {
      keys.push(key)
      continue
    }
    if (hasCanonical && canonicalizeItemName(key) === canonicalSubject) {
      keys.push(key)
    }
  }
  return keys
}

export function formatCanonicalItemEntries(
  entries: Record<string, string>,
  sectionTitle: string
): string[] {
  const items = Object.entries(entries)
  if (items.length === 0) return []

  const groups = new Map<
    string,
    { representative: string; aliases: string[]; value: string }
  >()

  for (const [item, value] of items) {
    const canonical = canonicalizeItemName(item)
    const existing = groups.get(canonical)
    if (!existing) {
      groups.set(canonical, { representative: item, aliases: [], value })
      continue
    }

    if (item.length < existing.representative.length) {
      existing.aliases.push(existing.representative)
      existing.representative = item
    } else if (item !== existing.representative) {
      existing.aliases.push(item)
    }
    existing.value = value
  }

  const lines = [sectionTitle]
  for (const { representative, aliases, value } of groups.values()) {
    const aliasNote = aliases.length > 0 ? `（亦称：${aliases.join('、')}）` : ''
    lines.push(`  ${representative}${aliasNote}：${value}`)
  }
  return lines
}

export function formatStoryState(storyState: StoryState): string {
  const lines: string[] = []

  const locations = Object.entries(storyState.characterLocations)
  if (locations.length > 0) {
    lines.push('【角色位置】')
    for (const [char, loc] of locations) {
      lines.push(`  ${char}：${loc}`)
    }
  }

  const statuses = Object.entries(storyState.characterStatus)
  if (statuses.length > 0) {
    lines.push('【角色状态】')
    for (const [char, status] of statuses) {
      lines.push(`  ${char}：${status}`)
    }
  }

  lines.push(...formatCanonicalItemEntries(storyState.keyItemsLocation, '【关键物品】'))
  lines.push(...formatCanonicalItemEntries(storyState.keyItemsState ?? {}, '【关键物品状态】'))

  if (storyState.activePlots.length > 0) {
    lines.push('【进行中的情节】')
    for (const plot of storyState.activePlots) {
      lines.push(`  - ${plot}`)
    }
  }

  if (storyState.revealedSecrets.length > 0) {
    lines.push('【已揭示的秘密】')
    for (const secret of storyState.revealedSecrets) {
      lines.push(`  - ${secret}`)
    }
  }

  if ((storyState.pendingTasks?.length ?? 0) > 0) {
    lines.push('【待办差事】')
    for (const task of storyState.pendingTasks) {
      const due = task.dueTime ?? (task.dueChapter ? `第${task.dueChapter}章前` : '未指定')
      const statusLabel = task.status === 'done' ? '已完成' : task.status === 'postponed' ? '已推迟' : task.status === 'superseded' ? '已覆盖' : task.status === 'expired' ? '已到期' : '待执行'
      lines.push(`  - [${statusLabel}] ${task.assignee}：${task.description}（截止：${due}）`)
    }
  }

  if (storyState.supersededFacts && storyState.supersededFacts.length > 0) {
    lines.push('【已被覆盖的旧事实】')
    for (const fact of storyState.supersededFacts) {
      lines.push(`  - [${fact.subject}] ${fact.oldFact}（原因：${fact.reason}）`)
    }
  }

  if (storyState.canonicalFacts && storyState.canonicalFacts.length > 0) {
    lines.push('【权威事实】')
    for (const fact of storyState.canonicalFacts) {
      lines.push(`  - [${fact.subject}] ${fact.attribute}: ${fact.value} (第${fact.establishedIn + 1}章确立)`)
      for (const old of fact.supersedes ?? []) {
        lines.push(`    覆盖第${old.chapter + 1}章: ${old.oldValue}`)
      }
    }
  }

  if (storyState.currentScene) {
    lines.push(`【当前场景】${storyState.currentScene}`)
  }

  if (storyState.storyTime) {
    lines.push(`【上一章结束时间】${storyState.storyTime}`)
  }

  if (storyState.chapterHandoff) {
    const handoff = storyState.chapterHandoff
    const charactersPresent = handoff.charactersPresent ?? []
    const openQuestions = handoff.openQuestions ?? []
    lines.push('【章节交接】')
    lines.push(`  章节：第${handoff.chapterNumber}章`)
    if (handoff.endScene) lines.push(`  结束场景：${handoff.endScene}`)
    if (handoff.endTime) lines.push(`  结束时间：${handoff.endTime}`)
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
