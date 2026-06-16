import type { ReducedGraphState } from '../graph/state.js'
import type { RunnableConfig } from '@langchain/core/runnables'
import type { buildNovelGraph } from '../graph/novel.graph.js'
import type { getCheckpointer } from '../graph/checkpointer.js'
import type { Issue } from '../types/agent.js'
import { generateId } from '../utils/id.js'
import {
  plan_chapter,
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
import { shouldForceTemporaryReplan } from '../utils/outline-bridge.js'

export interface ExecuteChapterOptions {
  breakOnErrors?: boolean
  maxRewriteAttempts?: number
  enableRevalidation?: boolean
  enableStructuralBranching?: boolean
}

const STRUCTURAL_ISSUE_TYPES = new Set([
  'outline_violation',
  'outline_deviation',
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

export function isStructuralIssue(issue: Issue): boolean {
  if (STRUCTURAL_ISSUE_TYPES.has(issue.type)) {
    return true
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
  let previousErrorCount = 0
  let forceStructuralRewrite = false

  try {
    while (rewriteAttempts < maxRewriteAttempts) {
      rewriteAttempts++
      if (rewriteAttempts > 1) {
        console.log(`[MuseFlow] 第 ${rewriteAttempts}/${maxRewriteAttempts} 次尝试...`)
      }

      if (forceStructuralRewrite) {
        if (workingState.chapterPlan) {
          console.log('[MuseFlow] 上轮修复未收敛，将强制完整重写...')
          workingState = { ...workingState, chapterPlan: null }
        }
      }
      const structuralOverride = forceStructuralRewrite
      forceStructuralRewrite = false

      if (enableStructuralBranching) {
        const needsTemporaryReplan = shouldForceTemporaryReplan(workingState.outline, targetIndex)
        const errorIssues = workingState.pendingIssues.filter(i => i.severity === 'error')
        const hasStructuralIssueFromValidators = workingState.pendingIssues.some(
          i => i.severity === 'error' && isStructuralIssue(i)
        )
        const hasStructuralIssues = hasStructuralIssueFromValidators || (needsTemporaryReplan && rewriteAttempts === 1) || structuralOverride
        const hasLocalIssues = workingState.pendingIssues.some(
          i => i.severity === 'error' && isLocalIssue(i)
        )
        if (needsTemporaryReplan && workingState.chapterPlan) {
          console.log('[MuseFlow] 检测到跨章节大纲桥接冲突，将临时重新规划本章...')
          workingState = { ...workingState, chapterPlan: null }
        }

        if (workingState.rewriteApproved && hasStructuralIssues && !hasLocalIssues) {
          console.log('[MuseFlow] 检测到结构性问题，将重新规划并完整重写本章...')
          workingState = { ...workingState, chapterPlan: null, pendingIssues: errorIssues }
          const planResult = await plan_chapter(workingState)
          workingState = { ...workingState, ...planResult }
          const draftResult = await draft_chapter(workingState)
          workingState = { ...workingState, ...draftResult }
          workingState = { ...workingState, pendingIssues: [] }
        } else if (workingState.rewriteApproved && hasLocalIssues && !hasStructuralIssues) {
          console.log('[MuseFlow] 检测到局部问题，将使用段落修复模式...')
          workingState = { ...workingState, pendingIssues: errorIssues }
          const fixResult = await fix_chapter(workingState)
          workingState = { ...workingState, ...fixResult }
          workingState = { ...workingState, pendingIssues: [] }
        } else {
          if (workingState.rewriteApproved) {
            if (hasStructuralIssues) {
              console.log('[MuseFlow] 同时存在结构性和局部问题，将重新规划并完整重写...')
              workingState = { ...workingState, chapterPlan: null, pendingIssues: errorIssues }
            } else {
              console.log('[MuseFlow] 检测到局部问题，将使用现有计划重写...')
              workingState = { ...workingState, pendingIssues: errorIssues }
            }
          } else {
            workingState = { ...workingState, pendingIssues: [] }
          }
          if (!workingState.chapterPlan) {
            const planResult = await plan_chapter(workingState)
            workingState = { ...workingState, ...planResult }
          }
          const draftResult = await draft_chapter(workingState)
          workingState = { ...workingState, ...draftResult }
          workingState = { ...workingState, pendingIssues: [] }
        }
      } else {
        workingState = { ...workingState, pendingIssues: [] }
        if (!workingState.chapterPlan) {
          const planResult = await plan_chapter(workingState)
          workingState = { ...workingState, ...planResult }
        }
        const draftResult = await draft_chapter(workingState)
        workingState = { ...workingState, ...draftResult }
        workingState = { ...workingState, pendingIssues: [] }
      }

      const { runChapterPipeline } = await import('./pipeline.js')

      let validationPassed = false
      let validationAttempts = 0
      let hadPipelineErrors = false
      const MAX_VALIDATION_ATTEMPTS = 3

      while (!validationPassed && validationAttempts < MAX_VALIDATION_ATTEMPTS) {
        validationAttempts++

        const isRevalidation = validationAttempts > 1
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

      const MAX_ISSUES_PER_TYPE = 3
      const issueGroups = new Map<string, typeof workingState.pendingIssues>()
      for (const issue of workingState.pendingIssues) {
        const list = issueGroups.get(issue.type) ?? []
        list.push(issue)
        issueGroups.set(issue.type, list)
      }
      const dedupedIssues: typeof workingState.pendingIssues = []
      for (const [type, issues] of issueGroups) {
        if (issues.length <= MAX_ISSUES_PER_TYPE) {
          dedupedIssues.push(...issues)
        } else {
          console.warn(`[MuseFlow] 检测到 ${type} 类型有 ${issues.length} 个问题，只保留前 ${MAX_ISSUES_PER_TYPE} 个`)
          dedupedIssues.push(...issues.slice(0, MAX_ISSUES_PER_TYPE))
        }
      }
      workingState = { ...workingState, pendingIssues: dedupedIssues }

      const errorCountAfterDedup = workingState.pendingIssues.filter(i => i.severity === 'error').length
      if (rewriteAttempts > 1 && errorCountAfterDedup > previousErrorCount) {
        console.log(`[MuseFlow] 检测到问题数量上升（${previousErrorCount} -> ${errorCountAfterDedup}），修复未收敛，下次尝试将强制完整重写...`)
        forceStructuralRewrite = true
      }
      previousErrorCount = errorCountAfterDedup

      if (rewriteAttempts < maxRewriteAttempts) {
        console.log(`[MuseFlow] 将在第 ${rewriteAttempts + 1} 次尝试中修复上述问题...`)
        workingState.rewriteApproved = true
      } else {
        const remainingErrors = workingState.pendingIssues.filter(i => i.severity === 'error')
        console.error(`[MuseFlow] 已达到最大重写次数 (${maxRewriteAttempts})，仍有 ${remainingErrors.length} 个未修复的严重问题：`)
        for (const err of remainingErrors) {
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

    const remainingErrors = workingState.pendingIssues.filter(i => i.severity === 'error')
    if (remainingErrors.length > 0) {
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
      }
    )
    throw err
  }
}
