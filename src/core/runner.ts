import { logger } from '../utils/logger.js'
import { buildNovelGraph } from '../graph/novel.graph.js'
import type { ReducedGraphState } from '../graph/state.js'
import type { RunnableConfig } from '@langchain/core/runnables'
import { getOutputsDir } from '../utils/paths.js'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getForeshadowStack } from '../storage/database/dao/timeline.js'
import { createEmptyStoryState, isEmptyStoryState, saveStoryState } from '../storage/database/dao/story-state.js'
import { getCheckpointer } from '../graph/checkpointer.js'
import { getWorld } from '../storage/database/dao/world.js'

let _graph: ReturnType<typeof buildNovelGraph> | null = null

export function getGraph() {
  if (!_graph) {
    _graph = buildNovelGraph()
  }
  return _graph
}

export function getOutputDirFromStoryId(storyId: string): string | undefined {
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
  } catch (err) {
    logger.error(`[MuseFlow] 查找故事目录时出错: ${err instanceof Error ? err.message : String(err)}`)
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
    chapterTimeAnchor: undefined,
    autoFixAttempts: 0,
    verifiedConstraints: [],
    rewriteAttempts: 0,
    errorRewriteAttempts: 0,
    previousIssues: [],
    previousRawErrorCount: 0,
    forceStructuralRewrite: false,
    routingDecision: undefined,
  }

  const config: RunnableConfig = {
    configurable: { thread_id: input.storyId, outputDir: storyObj.outputDir },
    recursionLimit: 100,
  }

  const result = await graph.invoke(initialState, config)
  return result as ReducedGraphState
}

export async function runChapterGraph(
  storyId: string,
  outputDir: string,
  workingState: ReducedGraphState
): Promise<ReducedGraphState> {
  const graph = getGraph()
  const checkpointer = getCheckpointer()
  await checkpointer.clearPendingWrites(outputDir)

  const config: RunnableConfig = {
    configurable: { thread_id: storyId, outputDir },
    recursionLimit: 100,
  }

  try {
    const result = await graph.invoke(workingState, config)
    if (result.storyState && !isEmptyStoryState(result.storyState)) {
      saveStoryState(storyId, result.storyState)
    }

    // 章节完成后再保存 chapter checkpoint。在 finalize_chapter 节点内部调用时，
    // LangGraph 尚未持久化该节点返回的状态更新，会导致 checkpoint 中的
    // currentChapterIndex 落后一章，进而让下一次 write 重复撰写同一章。
    if (!result.rewriteRequested && result.isWriting && result.currentChapterIndex > 0) {
      await checkpointer.saveChapterCheckpoint(result.story.outputDir, result.currentChapterIndex)
    }

    return result as ReducedGraphState
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    logger.error(`[MuseFlow] 章节写作流程出错: ${errorMessage}`)
    throw err
  }
}

export async function continueStory(
  storyId: string,
  userResponse?: boolean,
  currentChapterIndex?: number,
  options: { isRewrite?: boolean } = {}
): Promise<ReducedGraphState> {
  const outputDir = getOutputDirFromStoryId(storyId)
  if (!outputDir) {
    throw new Error(`Story ${storyId} not found`)
  }

  const graph = getGraph()
  const config: RunnableConfig = {
    configurable: { thread_id: storyId, outputDir },
  }
  const snapshot = await graph.getState(config)
  const checkpointState = snapshot.values as ReducedGraphState

  const targetIndex = currentChapterIndex ?? checkpointState.currentChapterIndex
  const isRewrite = options.isRewrite ?? currentChapterIndex !== undefined

  const checkpointHasState = checkpointState.storyState && !isEmptyStoryState(checkpointState.storyState)
  if (!checkpointHasState && isRewrite && targetIndex > 1) {
    logger.info('[MuseFlow] Checkpoint storyState 为空，且为重写模式。清理可能过时的角色位置信息...')
    const emptyState = createEmptyStoryState()
    checkpointState.storyState = {
      ...emptyState,
      revealedSecrets: checkpointState.storyState?.revealedSecrets || [],
      ...(checkpointState.storyState?.supersededFacts ? { supersededFacts: checkpointState.storyState.supersededFacts } : {}),
      ...(checkpointState.storyState?.canonicalFacts ? { canonicalFacts: checkpointState.storyState.canonicalFacts } : {}),
    }
  }

  const rewrittenChapters = new Array(checkpointState.totalChapters).fill(null) as ReducedGraphState['chapters']
  for (let i = 0; i < targetIndex; i++) {
    rewrittenChapters[i] = checkpointState.chapters[i] ?? null
  }

  // 清除过时的 draft_failure 问题，因为本次运行会重新生成章节
  const cleanedPendingIssues = checkpointState.pendingIssues.filter(issue => issue.type !== 'draft_failure')

  const workingState: ReducedGraphState = {
    ...checkpointState,
    currentChapterIndex: targetIndex,
    chapters: rewrittenChapters,
    pendingIssues: cleanedPendingIssues,
    chapterTimeAnchor: undefined,
    rewriteApproved: userResponse ?? false,
    rewriteRequested: false,
    isWriting: true,
    writeOneChapterOnly: true,
    rewriteAttempts: 0,
    errorRewriteAttempts: 0,
    previousIssues: [],
    previousRawErrorCount: 0,
    forceStructuralRewrite: false,
    routingDecision: undefined,
  }

  return runChapterGraph(storyId, outputDir, workingState)
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

    const persistedWorld = getWorld(storyId)
    if (persistedWorld && !graphState.world) {
      graphState.world = persistedWorld
    }

    // storyState 以 checkpoint 为唯一真相源，不再从 meta.json 覆盖
    // 清除过时的 draft_failure 问题，避免阻断后续生成
    graphState.pendingIssues = graphState.pendingIssues.filter(issue => issue.type !== 'draft_failure')

    return graphState
  } catch (err) {
    logger.error(`[MuseFlow] 获取故事状态时出错: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}
