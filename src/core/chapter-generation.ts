import type { ReducedGraphState } from '../graph/state.js'
import type { RunnableConfig } from '@langchain/core/runnables'
import type { buildNovelGraph } from '../graph/novel.graph.js'
import type { getCheckpointer } from '../graph/checkpointer.js'
import type { Issue } from '../types/agent.js'
import { generateId } from '../utils/id.js'
import { readChapterContent } from '../storage/filesystem/writer.js'
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
  finalize_chapter,
} from '../graph/nodes.js'
import { expandOutlineForChapter } from './outline-expander.js'
import { shouldForceTemporaryReplan } from '../utils/outline-boundary.js'
import { deduplicateIssuesSemantically, issueFingerprint } from '../utils/issue-deduplication.js'

export interface ExecuteChapterOptions {
  breakOnErrors?: boolean
  maxRewriteAttempts?: number
  enableRevalidation?: boolean
  enableStructuralBranching?: boolean
}

const STRUCTURAL_ISSUE_TYPES = new Set([
  'outline_violation',
  'timeline_mismatch',
  'logic_issue',
])

const CROSS_CHAPTER_MARKERS = [
  /上一章/,
  /前[一二三四五六七八九十\d]+章/,
  /第\s*[一二三四五六七八九十\d]+\s*章/,
  /story_state/,
  /已确认事实/,
  /已确立/,
  /既定事实/,
  /大纲第\s*[一二三四五六七八九十\d]+\s*章/,
]

const PENDING_TASK_MARKERS = [
  /未执行.*差事/,
  /未领受.*差事/,
  /无故搁置/,
  /已确立的差事/,
  /未出现.*差事/,
]

function isTaskConsistencyIssue(issue: Issue): boolean {
  return issue.type === 'consistency' &&
    PENDING_TASK_MARKERS.some(pattern => pattern.test(issue.description))
}

function calculateIssueSetSimilarity(prev: Issue[], curr: Issue[]): number {
  if (prev.length === 0 || curr.length === 0) return 0
  const prevSet = new Set(prev.map(issueFingerprint))
  const currSet = new Set(curr.map(issueFingerprint))
  let intersection = 0
  for (const fp of currSet) {
    if (prevSet.has(fp)) intersection++
  }
  return intersection / Math.max(prevSet.size, currSet.size)
}

export function isStructuralIssue(issue: Issue): boolean {
  if (STRUCTURAL_ISSUE_TYPES.has(issue.type)) {
    return true
  }

  if (issue.type === 'outline_deviation') {
    const text = `${issue.description} ${issue.location || ''}`
    return /缺少|完全缺失|核心事件|严重偏离|完全忽略|未出现/.test(text)
  }

  if (issue.type === 'consistency' || issue.type === 'hallucination') {
    const text = `${issue.description} ${issue.location || ''}`
    if (CROSS_CHAPTER_MARKERS.some(pattern => pattern.test(text))) {
      return true
    }
  }

  return false
}

function isLocalIssue(issue: Issue): boolean {
  return issue.severity === 'error' && !isStructuralIssue(issue)
}

async function runDraftPhase(state: ReducedGraphState): Promise<ReducedGraphState> {
  const draftResult = await draft_chapter(state)
  return { ...state, ...draftResult, pendingIssues: [] }
}

async function runFixPhase(state: ReducedGraphState): Promise<ReducedGraphState> {
  if (!state.chapterPlan) {
    const { chapterPlan } = await expandOutlineForChapter(state, state.currentChapterIndex)
    state = { ...state, chapterPlan }
  }
  const fixResult = await fix_chapter(state)
  return { ...state, ...fixResult, pendingIssues: [] }
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
        console.log(`[MuseFlow] 第 ${rewriteAttempts}/${maxRewriteAttempts} 次尝试...`)
      }

      const structuralOverride = forceStructuralRewrite
      if (structuralOverride && workingState.chapterPlan) {
        console.log('[MuseFlow] 上轮修复未收敛，将强制完整重写...')
        workingState = { ...workingState, chapterPlan: null }
      }
      forceStructuralRewrite = false

      if (enableStructuralBranching) {
        const needsTemporaryReplan = shouldForceTemporaryReplan(workingState.outline, targetIndex)
        if (needsTemporaryReplan && workingState.chapterPlan) {
          console.log('[MuseFlow] 检测到跨章节大纲桥接冲突，将临时重新规划本章...')
          workingState = { ...workingState, chapterPlan: null }
        }

        if (workingState.rewriteApproved) {
          const errorIssues = workingState.pendingIssues.filter(i => i.severity === 'error')
          const chapterFileExists = await readChapterContent(outputDir, targetIndex + 1).then(c => c !== null)

          if (!chapterFileExists) {
            console.log(`[MuseFlow] 第 ${targetIndex + 1} 章文件不存在，跳过修复模式，直接重新起草...`)
            workingState = await runDraftPhase({ ...workingState, pendingIssues: errorIssues, verifiedConstraints })
          } else {
            const hasStructural = errorIssues.some(isStructuralIssue) || structuralOverride
            const hasLocal = errorIssues.some(i => isLocalIssue(i))
            const onlyCrossChapter = errorIssues.every(i => i.type === 'consistency' || i.type === 'hallucination')
            const hasTaskConsistency = errorIssues.some(isTaskConsistencyIssue)

            if (hasTaskConsistency) {
              console.log('[MuseFlow] 检测到跨章节差事一致性错误，将清空计划并重新规划...')
              workingState = { ...workingState, chapterPlan: null, pendingIssues: errorIssues, verifiedConstraints }
              workingState = await runDraftPhase(workingState)
            } else if (hasStructural && !hasLocal) {
              if (onlyCrossChapter && !structuralOverride) {
                console.log('[MuseFlow] 一致性/幻觉问题优先使用段落级修复，避免直接完整重写...')
                workingState = await runFixPhase({ ...workingState, pendingIssues: errorIssues, verifiedConstraints })
              } else {
                console.log('[MuseFlow] 检测到结构性问题，将重新规划并完整重写本章...')
                workingState = await runDraftPhase({ ...workingState, chapterPlan: null, pendingIssues: errorIssues, verifiedConstraints })
              }
            } else if (!hasStructural && hasLocal) {
              console.log('[MuseFlow] 检测到局部问题，将使用段落修复模式...')
              workingState = await runFixPhase({ ...workingState, pendingIssues: errorIssues, verifiedConstraints })
            } else {
              if (hasStructural) {
                console.log('[MuseFlow] 同时存在结构性和局部问题，将重新规划并完整重写...')
                workingState = { ...workingState, chapterPlan: null, pendingIssues: errorIssues, verifiedConstraints }
              } else if (hasLocal) {
                console.log('[MuseFlow] 检测到局部问题，将使用现有计划重写...')
                workingState = { ...workingState, pendingIssues: errorIssues, verifiedConstraints }
              } else {
                workingState = { ...workingState, pendingIssues: [], verifiedConstraints }
              }
              workingState = await runDraftPhase(workingState)
            }
          }
        } else {
          workingState = await runDraftPhase({ ...workingState, pendingIssues: [], verifiedConstraints })
        }
      } else {
        workingState = await runDraftPhase({ ...workingState, pendingIssues: [], verifiedConstraints })
      }

      const { runChapterPipeline } = await import('./pipeline.js')

      let validationPassed = false
      let validationAttempts = 0
      let hadPipelineErrors = false
      const MAX_VALIDATION_ATTEMPTS = 3

      while (!validationPassed && validationAttempts < MAX_VALIDATION_ATTEMPTS) {
        validationAttempts++

        const isRevalidation = validationAttempts > 1
        const warningsBeforePipeline = workingState.pendingIssues.filter(i => i.severity === 'warning')

        const pipelineResult = await runChapterPipeline(workingState, [
          { node: validate_chapter, label: isRevalidation ? `检查字数(重验${validationAttempts - 1})` : '检查字数' },
          { node: quality_pass, label: isRevalidation ? `质量检查(重验${validationAttempts - 1})` : '质量检查' },
          { node: detect_foreshadowing, label: isRevalidation ? `检测伏笔(重验${validationAttempts - 1})` : '检测伏笔' },
          { node: detect_hallucination, label: isRevalidation ? `检测幻觉(重验${validationAttempts - 1})` : '检测幻觉' },
          { node: detect_consistency, label: isRevalidation ? `检测一致性(重验${validationAttempts - 1})` : '检测一致性' },
          { node: verify_outline_compliance, label: isRevalidation ? `校验大纲(重验${validationAttempts - 1})` : '校验大纲合规性' },
          { node: auto_fix_warnings, label: isRevalidation ? `自动修复(重验${validationAttempts - 1})` : '自动修复警告' },
        ], { showProgress: !isRevalidation, breakOnErrors })

        workingState = pipelineResult.state

        // Preserve quality warnings that auto_fix_warnings filtered out as non-patchable.
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
          console.error(`[MuseFlow] 自动修复 ${MAX_VALIDATION_ATTEMPTS} 次后仍有 ${remainingWarnings.length} 个警告未解决`)
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

      const hasErrors = workingState.pendingIssues.some(i => i.severity === 'error')

      if (!hasErrors) {
        break
      }

      workingState = { ...workingState, pendingIssues: deduplicateIssuesSemantically(workingState.pendingIssues) }

      const MAX_NON_ERROR_ISSUES_PER_TYPE = 3
      const issueGroups = new Map<string, typeof workingState.pendingIssues>()
      for (const issue of workingState.pendingIssues) {
        const list = issueGroups.get(issue.type) ?? []
        list.push(issue)
        issueGroups.set(issue.type, list)
      }
      const dedupedIssues: typeof workingState.pendingIssues = []
      for (const [type, issues] of issueGroups) {
        const errors = issues.filter(i => i.severity === 'error')
        const nonErrors = issues.filter(i => i.severity !== 'error')
        dedupedIssues.push(...errors)
        if (nonErrors.length <= MAX_NON_ERROR_ISSUES_PER_TYPE) {
          dedupedIssues.push(...nonErrors)
        } else {
          console.warn(`[MuseFlow] 检测到 ${type} 类型有 ${nonErrors.length} 个非错误问题，只保留前 ${MAX_NON_ERROR_ISSUES_PER_TYPE} 个`)
          dedupedIssues.push(...nonErrors.slice(0, MAX_NON_ERROR_ISSUES_PER_TYPE))
        }
      }
      workingState = { ...workingState, pendingIssues: dedupedIssues }

      const errorCountAfterDedup = workingState.pendingIssues.filter(i => i.severity === 'error').length
      const currentRawErrorCount = workingState.pendingIssues.filter(i => i.severity === 'error').length
      const currentErrorIssues = workingState.pendingIssues.filter(i => i.severity === 'error')
      const similarity = calculateIssueSetSimilarity(previousIssues.filter(i => i.severity === 'error'), currentErrorIssues)

      const resolvedIssues = previousIssues.filter(prev =>
        !workingState.pendingIssues.some(curr =>
          curr.type === prev.type && curr.description === prev.description
        )
      )
      if (resolvedIssues.length > 0) {
        const newConstraints = resolvedIssues.map(issue =>
          `[${issue.type}] ${issue.description}${issue.location ? `（位置：${issue.location}）` : ''}${issue.suggestion ? `；修复方向：${issue.suggestion}` : ''}`
        )
        verifiedConstraints = [...verifiedConstraints, ...newConstraints]
        console.log(`[MuseFlow] 本轮已解决 ${resolvedIssues.length} 个问题，已记录为后续规划约束`)
        for (const constraint of newConstraints) {
          console.log(`  ✓ ${constraint.substring(0, 120)}${constraint.length > 120 ? '...' : ''}`)
        }
      }
      workingState = { ...workingState, verifiedConstraints }

      const interpretiveIssuePattern = /提前.*(?:剧透|揭示)|看破.*说破|感应.*反应|选择性感应|表达方式|性格驱动/
      let currentRemainingErrors = workingState.pendingIssues.filter(i => i.severity === 'error')
      const onlyInterpretiveErrors = currentRemainingErrors.length > 0 && currentRemainingErrors.every(i =>
        interpretiveIssuePattern.test(i.description) || interpretiveIssuePattern.test(i.location || '')
      )

      if (rewriteAttempts > 1) {
        if (currentRawErrorCount > previousRawErrorCount) {
          console.log(`[MuseFlow] 检测到问题数量上升（${previousRawErrorCount} -> ${currentRawErrorCount}），修复未收敛，下次尝试将强制完整重写...`)
          forceStructuralRewrite = true
        } else if (similarity >= 0.5 && errorCountAfterDedup > 0) {
          console.log(`[MuseFlow] 检测到问题高度重复（相似度 ${Math.round(similarity * 100)}%），修复未收敛，将保留全部问题反馈并强制完整重写...`)
          forceStructuralRewrite = true
          workingState = { ...workingState, pendingIssues: workingState.pendingIssues }
        } else if (onlyInterpretiveErrors && rewriteAttempts >= maxRewriteAttempts - 1) {
          console.log(`[MuseFlow] 剩余 ${currentRemainingErrors.length} 个问题均为解释性一致性问题，自动降级为 warning 以完成本章...`)
          workingState = {
            ...workingState,
            pendingIssues: workingState.pendingIssues.map(i =>
              i.severity === 'error' && (interpretiveIssuePattern.test(i.description) || interpretiveIssuePattern.test(i.location || ''))
                ? { ...i, severity: 'warning' as const }
                : i
            ),
          }
          currentRemainingErrors = workingState.pendingIssues.filter(i => i.severity === 'error')
        }
      }
      previousRawErrorCount = currentRawErrorCount
      previousIssues = [...workingState.pendingIssues]

      if (currentRemainingErrors.length === 0) {
        break
      }

      if (rewriteAttempts < maxRewriteAttempts) {
        console.log(`[MuseFlow] 将在第 ${rewriteAttempts + 1} 次尝试中修复上述问题...`)
        workingState.rewriteApproved = true
      } else {
        console.error(`[MuseFlow] 已达到最大重写次数 (${maxRewriteAttempts})，仍有 ${currentRemainingErrors.length} 个未修复的严重问题：`)
        for (const err of currentRemainingErrors) {
          const icon = err.severity === 'error' ? '❌' : err.severity === 'warning' ? '⚠️' : 'ℹ️'
          console.error(`  ${icon} [${err.type}] ${err.description}`)
          if (err.location) {
            console.error(`     位置: ${err.location}`)
          }
        }
        console.error(`\n[MuseFlow] 撰写已中断，请手动重写后再继续：`)
        console.error(`   museflow rewrite ${storyId}  # 彻底重写\n`)

        const { diagnoseStoryState, printDiagnosis } = await import('./diagnose.js')
        const diagnosis = await diagnoseStoryState(workingState, outputDir)
        printDiagnosis(diagnosis)

        break
      }
    }

    const finalRemainingErrors = workingState.pendingIssues.filter(i => i.severity === 'error')
    if (finalRemainingErrors.length > 0) {
      workingState = {
        ...workingState,
        rewriteRequested: true,
        rewriteApproved: false,
      }
    await graph.updateState(
      { configurable: { thread_id: storyId, outputDir } },
      {
        rewriteApproved: false,
        rewriteRequested: true,
        pendingIssues: workingState.pendingIssues,
        currentChapterIndex: workingState.currentChapterIndex,
        chapters: workingState.chapters,
        chapterSummaries: workingState.chapterSummaries,
        storyState: workingState.storyState,
        verifiedConstraints: workingState.verifiedConstraints,
      }
    )
      return workingState
    }

    const finalizeResult = await finalize_chapter(workingState)
    workingState = { ...workingState, ...finalizeResult }

    workingState = {
      ...workingState,
      rewriteApproved: false,
      rewriteRequested: false,
    }
    await graph.updateState(
      { configurable: { thread_id: storyId, outputDir } },
      {
        rewriteApproved: false,
        rewriteRequested: false,
        pendingIssues: workingState.pendingIssues,
        currentChapterIndex: workingState.currentChapterIndex,
        chapters: workingState.chapters,
        chapterSummaries: workingState.chapterSummaries,
        storyState: workingState.storyState,
        verifiedConstraints: workingState.verifiedConstraints,
      }
    )
    await checkpointer.saveChapterCheckpoint(outputDir, targetIndex + 1)

    return workingState
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    const draftIssue = {
      id: generateId(),
      type: 'draft_failure' as const,
      severity: 'error' as const,
      description: errorMessage,
    }

    await graph.updateState(
      { configurable: { thread_id: storyId, outputDir } },
      {
        rewriteRequested: true,
        pendingIssues: [...workingState.pendingIssues, draftIssue],
        currentChapterIndex: workingState.currentChapterIndex,
        chapters: workingState.chapters,
        chapterSummaries: workingState.chapterSummaries,
        storyState: workingState.storyState,
        verifiedConstraints: workingState.verifiedConstraints,
      }
    )
    throw err
  }
}
