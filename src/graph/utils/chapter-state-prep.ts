import { logger } from '../../utils/logger.js'
import type { ReducedGraphState } from '../state.js'
import type { StoryState } from '../../types/story-state.js'
import { reconcileStoryState } from './story-state.js'
import { sanitizeStoryState, formatStateConflicts } from '../../utils/story-state-validation.js'
import { createEmptyStoryState } from '../../storage/database/dao/story-state.js'

export interface PreparedStoryState {
  reconciledState: StoryState
  stateConflicts: string
  itemLocationConflicts: Array<{ item: string; locations: string[] }>
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
    })

    itemLocationConflicts = sanitizationReport.itemLocationConflicts
    if (itemLocationConflicts.length > 0) {
      logger.warn('[MuseFlow] 检测到物品位置冲突：')
      for (const conflict of itemLocationConflicts) {
        logger.warn(`  - ${conflict.item}: ${conflict.locations.join(' / ')}`)
      }
    }

    const conflictNotes = reconciliationReport.conflicts
      .map(c => `[${c.severity}] ${c.description}`)
      .join('\n')
    const sanitizationNotes = formatStateConflicts(sanitizationReport)
    stateConflicts = [conflictNotes, sanitizationNotes].filter(Boolean).join('\n\n')
    reconciledState = sanitizationReport.state
  }

  return {
    reconciledState,
    stateConflicts,
    itemLocationConflicts,
  }
}
