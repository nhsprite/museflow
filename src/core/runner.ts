import { buildNovelGraph } from '../graph/novel.graph.js'
import type { ReducedGraphState } from '../graph/state.js'
import type { RunnableConfig } from '@langchain/core/runnables'
import { getOutputsDir } from '../utils/paths.js'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getForeshadowStack } from '../storage/database/dao/timeline.js'
import { createEmptyStoryState } from '../storage/database/dao/story-state.js'
import { getCheckpointer } from '../graph/checkpointer.js'
import { generateId } from '../utils/id.js'
import { startStepProgress, nextStep, stopStepProgress } from '../cli/utils/spinner.js'
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

let _graph: ReturnType<typeof buildNovelGraph> | null = null

function getGraph() {
  if (!_graph) {
    _graph = buildNovelGraph()
  }
  return _graph
}

function getOutputDirFromStoryId(storyId: string): string | undefined {
  const booksDir = getOutputsDir()
  if (!existsSync(booksDir)) return undefined

  const storyIdSuffix = storyId.split('_').pop() ?? storyId
  const shortId = storyIdSuffix.slice(0, 12).toLowerCase()

  try {
    const entries = readdirSync(booksDir)
    for (const entry of entries) {
      if (!entry.includes(`-${shortId}`) && !entry.includes(`_${shortId}`)) continue
      const metaPath = join(booksDir, entry, 'meta.json')
      if (existsSync(metaPath)) {
        const content = readFileSync(metaPath, 'utf-8')
        const meta = JSON.parse(content)
        if (meta.story?.id === storyId) {
          return join(booksDir, entry)
        }
      }
    }
  } catch {
  }
  return undefined
}

export async function runStory(input: {
  storyId: string
  idea: string
  genre: string
  totalChapters: number
  story: unknown
}): Promise<ReducedGraphState> {
  const graph = getGraph()
  const storyObj = input.story as { id: string; outputDir: string }
  const initialState: ReducedGraphState = {
    story: input.story as ReducedGraphState['story'],
    idea: input.idea,
    genre: input.genre,
    totalChapters: input.totalChapters,
    world: null,
    characters: [],
    outline: [],
    chapters: new Array(input.totalChapters).fill(null) as ReducedGraphState['chapters'],
    currentChapterIndex: 0,
    foreshadowStack: [],
    chapterSummaries: [],
    pendingIssues: [],
    rewriteApproved: false,
    rewriteRequested: false,
    isWriting: false,
    writeOneChapterOnly: false,
    lastPrintedChapter: -1,
    lastTimelineSnapshot: null,
    chapterPlan: null,
    storyState: createEmptyStoryState(),
    autoFixAttempts: 0,
  }

  const config: RunnableConfig = {
    configurable: { thread_id: input.storyId, outputDir: storyObj.outputDir },
  }

  const result = await graph.invoke(initialState, config)
  return result as ReducedGraphState
}

export async function continueStory(
  storyId: string,
  userResponse?: boolean,
  currentChapterIndex?: number
): Promise<ReducedGraphState> {
  const graph = getGraph()
  const outputDir = getOutputDirFromStoryId(storyId)
  if (!outputDir) {
    throw new Error(`Story ${storyId} not found`)
  }

  const checkpointer = getCheckpointer()
  await checkpointer.clearPendingWrites(outputDir)

  const config: RunnableConfig = {
    configurable: { thread_id: storyId, outputDir },
  }

  const snapshot = await graph.getState(config)
  const checkpointState = snapshot.values as ReducedGraphState

  const targetIndex = currentChapterIndex ?? checkpointState.currentChapterIndex

  const rewrittenChapters = new Array(checkpointState.totalChapters).fill(null) as ReducedGraphState['chapters']
  for (let i = 0; i < targetIndex; i++) {
    rewrittenChapters[i] = checkpointState.chapters[i] ?? null
  }

  let workingState: ReducedGraphState = {
    ...checkpointState,
    currentChapterIndex: targetIndex,
    chapters: rewrittenChapters,
    pendingIssues: checkpointState.pendingIssues,
    rewriteApproved: userResponse ?? false,
    rewriteRequested: false,
    isWriting: true,
    writeOneChapterOnly: true,
  }

  const MAX_REWRITE_ATTEMPTS = 3
  let rewriteAttempts = 0

  try {
    while (rewriteAttempts < MAX_REWRITE_ATTEMPTS) {
      rewriteAttempts++
      if (rewriteAttempts > 1) {
        console.log(`[MuseFlow] 第 ${rewriteAttempts}/${MAX_REWRITE_ATTEMPTS} 次尝试...`)
      }

      const structuralIssueTypes = ['outline_violation', 'outline_deviation', 'timeline_mismatch', 'logic_issue', 'consistency']
      const hasStructuralIssues = workingState.pendingIssues.some(
        i => i.severity === 'error' && structuralIssueTypes.includes(i.type)
      )
      const hasLocalIssues = workingState.pendingIssues.some(
        i => i.severity === 'error' && !structuralIssueTypes.includes(i.type)
      )

      const errorIssues = workingState.pendingIssues.filter(i => i.severity === 'error')

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
        // 修复后清除旧 issues，让下一轮验证从头检测
        workingState = { ...workingState, pendingIssues: [] }
      } else {
        if (workingState.rewriteApproved) {
          console.log('[MuseFlow] 同时存在结构性和局部问题，将重新规划并完整重写...')
          workingState = { ...workingState, chapterPlan: null, pendingIssues: errorIssues }
          const planResult = await plan_chapter(workingState)
          workingState = { ...workingState, ...planResult }
        } else {
          workingState = { ...workingState, pendingIssues: [] }
          const planResult = await plan_chapter(workingState)
          workingState = { ...workingState, ...planResult }
        }
        const draftResult = await draft_chapter(workingState)
        workingState = { ...workingState, ...draftResult }
        workingState = { ...workingState, pendingIssues: [] }
      }

      const { runChapterPipeline } = await import('./pipeline.js')
      const pipelineResult = await runChapterPipeline(workingState, [
        { node: validate_chapter, label: '检查字数' },
        { node: quality_pass, label: '质量检查' },
        { node: detect_foreshadowing, label: '检测伏笔' },
        { node: detect_hallucination, label: '检测幻觉' },
        { node: detect_consistency, label: '检测一致性' },
        { node: verify_outline_compliance, label: '校验大纲合规性' },
        { node: auto_fix_warnings, label: '自动修复警告' },
      ], { showProgress: true, breakOnErrors: false })

      workingState = pipelineResult.state
      const hasErrors = pipelineResult.hasErrors

      if (!hasErrors) {
        break
      }

      if (rewriteAttempts < MAX_REWRITE_ATTEMPTS) {
        console.log(`[MuseFlow] 将在第 ${rewriteAttempts + 1} 次尝试中修复上述问题...`)
        workingState.rewriteApproved = true
      } else {
        const remainingErrors = workingState.pendingIssues.filter(i => i.severity === 'error')
        console.error(`[MuseFlow] 已达到最大重写次数 (${MAX_REWRITE_ATTEMPTS})，仍有 ${remainingErrors.length} 个未修复的严重问题：`)
        for (const err of remainingErrors) {
          const icon = err.severity === 'error' ? '❌' : err.severity === 'warning' ? '⚠️' : 'ℹ️'
          console.error(`  ${icon} [${err.type}] ${err.description}`)
          if (err.location) {
            console.error(`     位置: ${err.location}`)
          }
        }
        console.error(`\n[MuseFlow] 撰写已中断，请手动重写后再继续：`)
        console.error(`   museflow rewrite ${storyId}  # 彻底重写\n`)
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
      }
    )
    throw err
  }
}

export async function getState(storyId: string): Promise<ReducedGraphState | null> {
  const graph = getGraph()
  const outputDir = getOutputDirFromStoryId(storyId)
  if (!outputDir) {
    return null
  }
  const config: RunnableConfig = {
    configurable: { thread_id: storyId, outputDir },
  }
  try {
    const state = await graph.getState(config)
    const graphState = state.values as unknown as ReducedGraphState

    const persistedForeshadowStack = getForeshadowStack(storyId)
    if (persistedForeshadowStack.length > 0) {
      graphState.foreshadowStack = persistedForeshadowStack
    }

    return graphState
  } catch {
    return null
  }
}
