import { logger } from '../../utils/logger.js'
import type { ReducedGraphState } from '../../graph/state.js'
import type { runChapterPipeline } from '../pipeline.js'

export type RunChapterPipeline = typeof runChapterPipeline

export interface ValidationNodeFunctions {
  validate_chapter: (state: ReducedGraphState) => Promise<Partial<ReducedGraphState>>
  quality_pass: (state: ReducedGraphState) => Promise<Partial<ReducedGraphState>>
  detect_foreshadowing: (state: ReducedGraphState) => Promise<Partial<ReducedGraphState>>
  detect_hallucination: (state: ReducedGraphState) => Promise<Partial<ReducedGraphState>>
  detect_consistency: (state: ReducedGraphState) => Promise<Partial<ReducedGraphState>>
  verify_outline_compliance: (state: ReducedGraphState) => Promise<Partial<ReducedGraphState>>
  auto_fix_warnings: (state: ReducedGraphState) => Promise<Partial<ReducedGraphState>>
}

export interface ValidationLoopOptions {
  breakOnErrors: boolean
  enableRevalidation: boolean
}

export interface ValidationLoopResult {
  state: ReducedGraphState
  hadPipelineErrors: boolean
}

export async function runValidationLoop(
  state: ReducedGraphState,
  nodeFunctions: ValidationNodeFunctions,
  runPipeline: RunChapterPipeline,
  options: ValidationLoopOptions
): Promise<ValidationLoopResult> {
  const { breakOnErrors, enableRevalidation } = options
  const {
    validate_chapter,
    quality_pass,
    detect_foreshadowing,
    detect_hallucination,
    detect_consistency,
    verify_outline_compliance,
    auto_fix_warnings,
  } = nodeFunctions

  let workingState = state
  let validationPassed = false
  let validationAttempts = 0
  let hadPipelineErrors = false
  const MAX_VALIDATION_ATTEMPTS = 3

  while (!validationPassed && validationAttempts < MAX_VALIDATION_ATTEMPTS) {
    validationAttempts++

    const isRevalidation = validationAttempts > 1
    const warningsBeforePipeline = workingState.pendingIssues.filter(i => i.severity === 'warning')

    const pipelineResult = await runPipeline(workingState, [
      { node: validate_chapter, label: isRevalidation ? `检查字数(重验${validationAttempts - 1})` : '检查字数' },
      { node: quality_pass, label: isRevalidation ? `质量检查(重验${validationAttempts - 1})` : '质量检查' },
      { node: detect_foreshadowing, label: isRevalidation ? `检测伏笔(重验${validationAttempts - 1})` : '检测伏笔' },
      { node: detect_hallucination, label: isRevalidation ? `检测幻觉(重验${validationAttempts - 1})` : '检测幻觉' },
      { node: detect_consistency, label: isRevalidation ? `检测一致性(重验${validationAttempts - 1})` : '检测一致性' },
      { node: verify_outline_compliance, label: isRevalidation ? `校验大纲(重验${validationAttempts - 1})` : '校验大纲合规性' },
      { node: auto_fix_warnings, label: isRevalidation ? `自动修复(重验${validationAttempts - 1})` : '自动修复警告' },
    ], { showProgress: !isRevalidation, breakOnErrors })

    workingState = pipelineResult.state

    const warningsAfterPipeline = workingState.pendingIssues.filter(i => i.severity === 'warning')
    const missingQualityWarnings = warningsBeforePipeline.filter(
      before => before.type === 'quality' && !warningsAfterPipeline.some(after => after.id === before.id)
    )
    if (missingQualityWarnings.length > 0) {
      workingState = {
        ...workingState,
        pendingIssues: [...workingState.pendingIssues, ...missingQualityWarnings],
      }
    }

    if (pipelineResult.hasErrors) {
      hadPipelineErrors = true
      break
    }

    if (!enableRevalidation) {
      validationPassed = true
      break
    }

    const autoFixAttempts = workingState.autoFixAttempts || 0
    if (autoFixAttempts > 0 && autoFixAttempts < MAX_VALIDATION_ATTEMPTS) {
      continue
    }

    const remainingWarnings = workingState.pendingIssues.filter(i => i.severity === 'warning')
    if (remainingWarnings.length === 0) {
      validationPassed = true
    }
  }

  if (!validationPassed && enableRevalidation && !hadPipelineErrors) {
    const remainingWarnings = workingState.pendingIssues.filter(i => i.severity === 'warning')
    if (remainingWarnings.length > 0) {
      logger.error(`[MuseFlow] 自动修复 ${MAX_VALIDATION_ATTEMPTS} 次后仍有 ${remainingWarnings.length} 个警告未解决`)
      workingState = {
        ...workingState,
        pendingIssues: [
          ...workingState.pendingIssues,
          {
            id: 'max-fix-attempts',
            type: 'quality',
            severity: 'error' as const,
            description: `自动修复 ${MAX_VALIDATION_ATTEMPTS} 次后仍有 ${remainingWarnings.length} 个警告未解决`,
          },
        ],
      }
    }
  }

  return { state: workingState, hadPipelineErrors }
}
