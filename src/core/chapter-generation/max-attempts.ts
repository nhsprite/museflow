import { logger } from '../../utils/logger.js'
import type { ReducedGraphState } from '../../graph/state.js'
import type { Issue } from '../../types/agent.js'
import { detectStateCorruption } from './convergence.js'

export async function handleMaxAttempts(
  storyId: string,
  outputDir: string,
  workingState: ReducedGraphState,
  currentRemainingErrors: Issue[],
  rewriteAttempts: number,
  maxRewriteAttempts: number
): Promise<ReducedGraphState> {
  logger.error(`[MuseFlow] 已达到最大重写次数 (${maxRewriteAttempts})，仍有 ${currentRemainingErrors.length} 个未修复的严重问题：`)
  for (const err of currentRemainingErrors) {
    const icon = err.severity === 'error' ? '❌' : err.severity === 'warning' ? '⚠️' : 'ℹ️'
    logger.error(`  ${icon} [${err.type}] ${err.description}`)
    if (err.location) {
      logger.error(`     位置: ${err.location}`)
    }
  }
  logger.error(`\n[MuseFlow] 撰写已中断，请手动重写后再继续：`)
  logger.error(`   museflow rewrite ${storyId}  # 彻底重写\n`)

  const { diagnoseStoryState, printDiagnosis } = await import('../diagnose.js')
  const diagnosis = await diagnoseStoryState(workingState, outputDir)
  printDiagnosis(diagnosis)

  const stateCorruptionIssue = detectStateCorruption(currentRemainingErrors, rewriteAttempts, maxRewriteAttempts)
  if (stateCorruptionIssue) {
    workingState = {
      ...workingState,
      pendingIssues: [...workingState.pendingIssues, stateCorruptionIssue],
    }
  }

  return workingState
}
