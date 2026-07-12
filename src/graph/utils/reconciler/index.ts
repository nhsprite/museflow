import { logger } from '../../../utils/logger.js'
import type { ReducedGraphState } from '../../state.js'
import type { StoryState } from '../../../types/story-state.js'
import type { ModelProvider } from '../../../model/provider.js'
import { createEmptyStoryState } from '../../../storage/meta/stores/story-state.js'
import { BlockingConflictError } from '../../../utils/errors.js'
import { generateOutlineRevisionProposal } from '../../../core/chapter-generation/outline-revision-proposal.js'
import { applyAuthorOverrides } from './state-merge.js'
import { buildPendingTasksConstraints } from './format.js'
import { reconcileStoryState, conflictIsDecided } from './conflict.js'
import { authorizeOutlineFacts, detectOutlineStateConflicts } from './outline-conflict.js'
import { sanitizeStoryState, formatStateConflicts } from './sanitize.js'

export * from './state-merge.js'
export * from './format.js'
export * from './timeline.js'
export * from './conflict.js'
export * from './outline-conflict.js'
export * from './sanitize.js'

export interface PreparedStoryState {
  reconciledState: StoryState
  stateConflicts: string
  itemLocationConflicts: Array<{ item: string; locations: string[] }>
}

export async function prepareStoryStateForChapter(
  state: ReducedGraphState,
  chapterIndex: number,
  provider: ModelProvider
): Promise<PreparedStoryState> {
  const outlineItem = state.outline[chapterIndex]
  let reconciledState: StoryState = state.storyState ?? createEmptyStoryState()
  let stateConflicts = ''
  let itemLocationConflicts: Array<{ item: string; locations: string[] }> = []

  if (outlineItem?.description) {
    reconciledState = applyAuthorOverrides(reconciledState)

    const reconciliationReport = await reconcileStoryState(
      reconciledState,
      outlineItem.description,
      state.characters,
      chapterIndex,
      provider
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

    const outlineStateCheck = await detectOutlineStateConflicts(
      { ...reconciledState, storyMemory: state.storyMemory },
      outlineItem.description,
      chapterIndex,
      provider,
      state.storyArc ?? undefined
    )

    const undecidedBlockingConflicts = [
      ...reconciliationReport.requiresAuthorDecision.filter(
        (c) => !conflictIsDecided(c, state.authorDecisions)
      ),
      ...outlineStateCheck.conflicts.filter(
        (c) => c.severity === 'blocking' && !conflictIsDecided(c, state.authorDecisions)
      ),
    ]
    if (undecidedBlockingConflicts.length > 0) {
      const proposal = await generateOutlineRevisionProposal(
        state.outline,
        chapterIndex,
        undecidedBlockingConflicts,
        reconciledState,
        provider
      )
      throw new BlockingConflictError(
        undecidedBlockingConflicts,
        chapterIndex,
        proposal ?? undefined
      )
    }

    const outlineAuthorizedFacts = await authorizeOutlineFacts(
      { ...reconciledState, storyMemory: state.storyMemory },
      outlineItem.description,
      chapterIndex,
      provider
    )
    if (outlineAuthorizedFacts.length > 0) {
      const mergedFacts = [...(reconciledState.canonicalFacts ?? [])]
      for (const fact of outlineAuthorizedFacts) {
        const existingIndex = mergedFacts.findIndex(
          (f) =>
            f.subject === fact.subject && f.attribute === fact.attribute && f.value === fact.value
        )
        if (existingIndex < 0) {
          mergedFacts.push(fact)
        }
      }
      reconciledState = {
        ...reconciledState,
        canonicalFacts: mergedFacts,
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
      .map((c) => `[${c.severity}] ${c.description}`)
      .join('\n')
    const outlineConflictNotes =
      outlineStateCheck.conflicts.length > 0
        ? outlineStateCheck.conflicts.map((c) => `[${c.severity}] ${c.description}`).join('\n')
        : ''
    const outlineConstraintNotes =
      outlineStateCheck.constraints.length > 0
        ? `【大纲-状态约束提醒】\n${outlineStateCheck.constraints.map((c) => `- ${c}`).join('\n')}`
        : ''
    const sanitizationNotes = formatStateConflicts(sanitizationReport)
    const pendingTasksNotes = buildPendingTasksConstraints(reconciledState.pendingTasks ?? [])
    stateConflicts = [
      conflictNotes,
      outlineConflictNotes,
      outlineConstraintNotes,
      sanitizationNotes,
      pendingTasksNotes,
    ]
      .filter(Boolean)
      .join('\n\n')
    reconciledState = sanitizationReport.state
  }

  return {
    reconciledState,
    stateConflicts,
    itemLocationConflicts,
  }
}
