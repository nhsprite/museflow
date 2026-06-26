import { logger } from '../utils/logger.js'
import type { ReducedGraphState } from '../graph/state.js'
import type { Issue } from '../types/agent.js'
import type { buildNovelGraph } from '../graph/novel.graph.js'
import type { getCheckpointer } from '../graph/checkpointer.js'
import {
  draft_chapter,
  fix_chapter,
  validate_chapter,
  quality_pass,
  detect_foreshadowing,
  detect_hallucination,
  detect_consistency,
  verify_outline_compliance,
  auto_fix_warnings,
} from '../graph/nodes.js'
import { runConvergenceCheck } from './chapter-generation/convergence.js'
import { runRewriteBranch } from './chapter-generation/rewrite-strategy.js'
import { runValidationLoop } from './chapter-generation/validation-loop.js'
import { runDraftPhase, runFixPhase } from './chapter-generation/phases.js'
import { handleMaxAttempts } from './chapter-generation/max-attempts.js'
import {
  persistBrokenState,
  persistSuccessState,
  persistFailureState,
  saveChapterCheckpoint,
} from './chapter-generation/state-persistence.js'

export { isStructuralIssue } from './chapter-generation/issue-classifier.js'

export interface ExecuteChapterOptions {
  breakOnErrors?: boolean
  maxRewriteAttempts?: number
  enableRevalidation?: boolean
  enableStructuralBranching?: boolean
}

export async function executeChapterGeneration(
  storyId: string,
  outputDir: string,
  workingState: ReducedGraphState,
  graph: ReturnType<typeof buildNovelGraph>,
  checkpointer: ReturnType<typeof getCheckpointer>,
  options: ExecuteChapterOptions = {}
): Promise<ReducedGraphState> {
  const {
    breakOnErrors = false,
    maxRewriteAttempts = 3,
    enableRevalidation = true,
    enableStructuralBranching = true,
  } = options

  const nodeFunctions = {
    draft_chapter,
    fix_chapter,
    validate_chapter,
    quality_pass,
    detect_foreshadowing,
    detect_hallucination,
    detect_consistency,
    verify_outline_compliance,
    auto_fix_warnings,
  }

  const targetIndex = workingState.currentChapterIndex
  let rewriteAttempts = 0
  let previousRawErrorCount = 0
  let previousIssues: Issue[] = []
  let forceStructuralRewrite = false
  let verifiedConstraints = workingState.verifiedConstraints ?? []

  try {
    while (rewriteAttempts < maxRewriteAttempts) {
      rewriteAttempts++
      if (rewriteAttempts > 1) {
        logger.info(`[MuseFlow] 第 ${rewriteAttempts}/${maxRewriteAttempts} 次尝试...`)
      }

      const structuralOverride = forceStructuralRewrite
      if (structuralOverride && workingState.chapterPlan) {
        logger.info('[MuseFlow] 上轮修复未收敛，将强制完整重写...')
        workingState = { ...workingState, chapterPlan: null }
      }
      forceStructuralRewrite = false

      workingState = await runRewriteBranch(workingState, {
        runDraftPhase: state => runDraftPhase(state, nodeFunctions),
        runFixPhase: state => runFixPhase(state, nodeFunctions),
      }, {
        outputDir,
        targetIndex,
        structuralOverride,
        enableStructuralBranching,
        verifiedConstraints,
      })

      const { runChapterPipeline } = await import('./pipeline.js')
      const { state: validatedState, hadPipelineErrors } = await runValidationLoop(workingState, nodeFunctions, runChapterPipeline, {
        breakOnErrors,
        enableRevalidation,
      })
      workingState = validatedState

      const hasErrors = workingState.pendingIssues.some(i => i.severity === 'error')
      if (!hasErrors) {
        break
      }

      if (hadPipelineErrors) {
        // Continue to convergence handling so the rewrite loop can retry.
      }

      const convergenceResult = runConvergenceCheck(
        workingState,
        previousIssues,
        previousRawErrorCount,
        verifiedConstraints,
        rewriteAttempts,
        maxRewriteAttempts
      )
      workingState = convergenceResult.workingState
      forceStructuralRewrite = convergenceResult.forceStructuralRewrite
      verifiedConstraints = convergenceResult.verifiedConstraints

      const currentRemainingErrors = workingState.pendingIssues.filter(i => i.severity === 'error')
      if (currentRemainingErrors.length === 0) {
        break
      }

      if (rewriteAttempts < maxRewriteAttempts) {
        logger.info(`[MuseFlow] 将在第 ${rewriteAttempts + 1} 次尝试中修复上述问题...`)
        workingState.rewriteApproved = true
      } else {
        workingState = await handleMaxAttempts(storyId, outputDir, workingState, currentRemainingErrors, rewriteAttempts, maxRewriteAttempts)
        break
      }

      previousRawErrorCount = workingState.pendingIssues.filter(i => i.severity === 'error').length
      previousIssues = [...workingState.pendingIssues]
    }

    const finalRemainingErrors = workingState.pendingIssues.filter(i => i.severity === 'error')
    if (finalRemainingErrors.length > 0) {
      workingState = {
        ...workingState,
        rewriteRequested: true,
        rewriteApproved: false,
      }
      await persistBrokenState(graph, storyId, outputDir, workingState)
      return workingState
    }

    const { finalize_chapter } = await import('../graph/nodes.js')
    const finalizeResult = await finalize_chapter(workingState)
    workingState = { ...workingState, ...finalizeResult }

    workingState = {
      ...workingState,
      rewriteApproved: false,
      rewriteRequested: false,
    }
    await persistSuccessState(graph, storyId, outputDir, workingState)
    await saveChapterCheckpoint(checkpointer, outputDir, targetIndex + 1)

    return workingState
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    await persistFailureState(graph, storyId, outputDir, workingState, errorMessage)
    throw err
  }
}

