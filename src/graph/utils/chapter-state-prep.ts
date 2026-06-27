import { logger } from '../../utils/logger.js'
import type { ReducedGraphState } from '../state.js'
import type { StoryState, PendingTask } from '../../types/story-state.js'
import { reconcileStoryState } from './story-state.js'
import { sanitizeStoryState, formatStateConflicts } from '../../utils/story-state-validation.js'
import { createEmptyStoryState } from '../../storage/database/dao/story-state.js'

export interface PreparedStoryState {
  reconciledState: StoryState
  stateConflicts: string
  itemLocationConflicts: Array<{ item: string; locations: string[] }>
}

function buildPendingTasksConstraints(tasks: PendingTask[]): string {
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
    '如果任务要求“通过某渠道汇报”“不得来某处回报”“使用某精确口径回话”等执行方式，本章必须原样遵守，不得改写执行方式或文本。',
    '如果本章只是获知任务结果，必须提供合理的替代信息来源（如第三方传话、眼线回报），不得让被禁止的直接汇报渠道出现。',
  ]
  return lines.join('\n')
}

export function prepareStoryStateForChapter(
  state: ReducedGraphState,
  chapterIndex: number
): PreparedStoryState {
  const outlineItem = state.outline[chapterIndex]
  let reconciledState: StoryState = state.storyState ?? createEmptyStoryState()
  let stateConflicts = ''
  let itemLocationConflicts: Array<{ item: string; locations: string[] }> = []

  if (outlineItem?.description) {
    const reconciliationReport = reconcileStoryState(
      reconciledState,
      outlineItem.description,
      state.characters,
      chapterIndex
    )
    reconciledState = reconciliationReport.state

    if (reconciliationReport.autoResolved.length > 0) {
      logger.info(`[MuseFlow] 自动协调 ${reconciliationReport.autoResolved.length} 个状态冲突：`)
      for (const conflict of reconciliationReport.autoResolved) {
        logger.info(`  - ${conflict.description}`)
      }
    }

    if (reconciliationReport.requiresAuthorDecision.length > 0) {
      logger.warn('[MuseFlow] 检测到需要作者决策的冲突：')
      for (const conflict of reconciliationReport.requiresAuthorDecision) {
        logger.warn(`  - [${conflict.severity}] ${conflict.description}`)
      }
    }

    const sanitizationReport = sanitizeStoryState(reconciledState, state.characters, {
      preserveExisting: true,
      existingStoryState: state.storyState,
      chapterIndex,
    })

    itemLocationConflicts = sanitizationReport.itemLocationConflicts
    if (itemLocationConflicts.length > 0) {
      logger.info(`[MuseFlow] 自动协调 ${itemLocationConflicts.length} 个物品位置冲突：`)
      for (const conflict of itemLocationConflicts) {
        logger.info(`  - ${conflict.item}: ${conflict.locations.join(' / ')}`)
      }
    }

    const conflictNotes = reconciliationReport.conflicts
      .map(c => `[${c.severity}] ${c.description}`)
      .join('\n')
    const sanitizationNotes = formatStateConflicts(sanitizationReport)
    const pendingTasksNotes = buildPendingTasksConstraints(reconciledState.pendingTasks ?? [])
    stateConflicts = [conflictNotes, sanitizationNotes, pendingTasksNotes].filter(Boolean).join('\n\n')
    reconciledState = sanitizationReport.state
  }

  return {
    reconciledState,
    stateConflicts,
    itemLocationConflicts,
  }
}
