import type { BeatId, ForeshadowId, ForeshadowKind } from './story-memory.js'
import { classifyForeshadows } from '../story-memory/foreshadow-policy.js'

export type ForeshadowStatus = 'planted' | 'hinted' | 'shown' | 'recalled'

export interface ForeshadowItem {
  id: ForeshadowId
  text: string
  expectedFulfillChapter: number
  createdAt: number
  createdAtChapter: number
  fulfilledChapter?: number
  status: ForeshadowStatus
  isExplicit: boolean
  source?: 'content' | 'outline' | 'manual'
  required: boolean
  beatId?: BeatId
  kind?: ForeshadowKind
}

export type ForeshadowAlertLevel = 'overdue' | 'urgent' | 'normal'

export interface ForeshadowAlert {
  item: ForeshadowItem
  level: ForeshadowAlertLevel
  currentChapter: number
}

export function getForeshadowAlerts(
  stack: ForeshadowItem[],
  currentChapter: number
): ForeshadowAlert[] {
  const buckets = classifyForeshadows(stack, currentChapter)
  return [
    ...buckets.overdueRequired.map((item) => ({ item, level: 'overdue' as const, currentChapter })),
    ...buckets.dueRequired.map((item) => ({ item, level: 'urgent' as const, currentChapter })),
    ...[...buckets.normalRequired, ...buckets.optional].map((item) => ({
      item,
      level: 'normal' as const,
      currentChapter,
    })),
  ]
    .sort((a, b) => {
      const levelOrder = { overdue: 0, urgent: 1, normal: 2 }
      return levelOrder[a.level] - levelOrder[b.level]
    })
}

export function formatForeshadowAlerts(alerts: ForeshadowAlert[]): string {
  if (alerts.length === 0) return '暂无未回收伏笔'

  const overdue = alerts.filter((a) => a.level === 'overdue')
  const urgent = alerts.filter((a) => a.level === 'urgent')
  const normal = alerts.filter((a) => a.level === 'normal')

  const lines: string[] = []

  if (overdue.length > 0) {
    lines.push(`⚠️ 已逾期 (${overdue.length}个):`)
    overdue.forEach((a, i) => {
      const overdueBy = a.currentChapter - a.item.expectedFulfillChapter
      const createdCh = a.item.createdAtChapter || '?'
      lines.push(
        `  ${i + 1}. "${a.item.text.substring(0, 60)}..." (第${createdCh}章埋下 → 预期第${a.item.expectedFulfillChapter}章, 逾期${overdueBy}章)`
      )
    })
  }

  if (urgent.length > 0) {
    lines.push(`🔔 即将到期 (${urgent.length}个):`)
    urgent.forEach((a, i) => {
      const createdCh = a.item.createdAtChapter || '?'
      lines.push(
        `  ${i + 1}. "${a.item.text.substring(0, 60)}..." (第${createdCh}章埋下 → 预期第${a.item.expectedFulfillChapter}章)`
      )
    })
  }

  if (normal.length > 0) {
    lines.push(`⏳ 正常 (${normal.length}个):`)
    normal.forEach((a, i) => {
      const createdCh = a.item.createdAtChapter || '?'
      lines.push(
        `  ${i + 1}. "${a.item.text.substring(0, 60)}..." (第${createdCh}章埋下 → 预期第${a.item.expectedFulfillChapter}章)`
      )
    })
  }

  return lines.join('\n')
}
