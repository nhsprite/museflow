import { buildNovelGraph } from '../graph/novel.graph.js'
import type { ReducedGraphState } from '../graph/state.js'
import type { RunnableConfig } from '@langchain/core/runnables'
import { getOutputsDir } from '../utils/paths.js'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getForeshadowStack } from '../storage/database/dao/timeline.js'
import { createEmptyStoryState, getStoryState } from '../storage/database/dao/story-state.js'
import { getCheckpointer } from '../graph/checkpointer.js'
import { executeChapterGeneration } from './chapter-generation.js'
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
    console.error(`[MuseFlow] 查找故事目录时出错: ${err instanceof Error ? err.message : String(err)}`)
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
  const isRewrite = currentChapterIndex !== undefined

  const checkpointHasState = checkpointState.storyState &&
    (Object.keys(checkpointState.storyState.characterStatus || {}).length > 0 ||
     Object.keys(checkpointState.storyState.characterLocations || {}).length > 0)

  if (!checkpointHasState && isRewrite && targetIndex > 1) {
    console.log('[MuseFlow] Checkpoint storyState 为空，且为重写模式。清理可能过时的角色位置信息...')
    const emptyState = createEmptyStoryState()
    checkpointState.storyState = {
      ...emptyState,
      revealedSecrets: checkpointState.storyState?.revealedSecrets || [],
      ...(checkpointState.storyState?.supersededFacts ? { supersededFacts: checkpointState.storyState.supersededFacts } : {}),
    }
  } else {
    const persistedStoryState = getStoryState(storyId)
    if (persistedStoryState && Object.keys(persistedStoryState.characterStatus || {}).length > 0) {
      checkpointState.storyState = persistedStoryState
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
  }

  return executeChapterGeneration(storyId, outputDir, workingState, graph, checkpointer, {
    breakOnErrors: false,
    maxRewriteAttempts: 3,
    enableRevalidation: true,
    enableStructuralBranching: true,
  })
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

    // 清除过时的 draft_failure 问题，避免阻断后续生成
    graphState.pendingIssues = graphState.pendingIssues.filter(issue => issue.type !== 'draft_failure')

    return graphState
  } catch (err) {
    console.error(`[MuseFlow] 获取故事状态时出错: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}
