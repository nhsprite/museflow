import { logger } from '../utils/logger.js'
import { buildNovelGraph } from '../graph/novel.graph.js'
import type { ReducedGraphState } from '../graph/state.js'
import type { RunnableConfig } from '@langchain/core/runnables'
import { getOutputsDir } from '../utils/paths.js'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createEmptyStoryState } from '../storage/meta/stores/story-state.js'

import { exportMetaFromCheckpoint } from '../storage/meta/exporter.js'
import { deleteChapterContent, writeOutlineContent } from '../storage/filesystem/writer.js'
import { createCheckpointService } from '../storage/checkpoint-service.js'
import { migrateLegacyCheckpoints } from '../storage/migration.js'
import type { Issue } from '../types/agent.js'
import type { StateOverride, StoryState } from '../types/story-state.js'
import { createRuntimeContext, type RuntimeContext } from './context.js'

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

export async function runStory(
  input: {
    storyId: string
    idea: string
    genre: string
    totalChapters: number
    story: unknown
  },
  context: RuntimeContext = createRuntimeContext()
): Promise<ReducedGraphState> {
  const graph = buildNovelGraph(context)
  const storyObj = input.story as { id: string; outputDir: string }
  const initialState: ReducedGraphState = {
    story: input.story as ReducedGraphState['story'],
    idea: input.idea,
    genre: input.genre,
    totalChapters: input.totalChapters,
    world: null,
    characters: [],
    storyArc: null,
    outline: [],
    actProgress: {},
    chapters: new Array(input.totalChapters).fill(null) as ReducedGraphState['chapters'],
    currentChapterIndex: 0,
    foreshadowStack: [],
    timeline: undefined,
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
    chapterReport: null,
    blockingReport: null,
    session: {
      chapterIndex: 0,
      rewriteAttempts: 0,
      errorRewriteAttempts: 0,
      autoFixAttempts: 0,
      previousIssues: [],
      previousRawErrorCount: 0,
      routingDecision: undefined,
      forceStructuralRewrite: false,
      rewriteApproved: false,
      issueFingerprintHistory: [],
    },
    authorDecisions: {},
  }

  const config: RunnableConfig = {
    configurable: { thread_id: input.storyId, outputDir: storyObj.outputDir },
    recursionLimit: 100,
  }

  const result = await graph.invoke(initialState, config)
  return result as ReducedGraphState
}

async function runChapterGraph(
  storyId: string,
  outputDir: string,
  workingState: ReducedGraphState,
  context: RuntimeContext
): Promise<ReducedGraphState> {
  const graph = buildNovelGraph(context)
  const checkpointService = createCheckpointService(outputDir)
  await checkpointService.clearPendingWrites()

  const config: RunnableConfig = {
    configurable: { thread_id: storyId, outputDir },
    recursionLimit: 100,
  }

  try {
    const result = await graph.invoke(workingState, config)

    // 章节完成后再保存 chapter marker。在 finalize_chapter 节点内部调用时，
    // LangGraph 尚未持久化该节点返回的状态更新，会导致 checkpoint 中的
    // currentChapterIndex 落后一章，进而让下一次 write 重复撰写同一章。
    if (!result.rewriteRequested && result.isWriting && result.currentChapterIndex > 0) {
      const stateAfter = await graph.getState(config)
      const checkpointId = stateAfter.config?.configurable?.checkpoint_id as string | undefined
      if (checkpointId) {
        await checkpointService.saveChapterMarker(result.currentChapterIndex, checkpointId)
      }
    }

    // 将 checkpoint 同步为 meta.json 导出视图，保持 CLI 命令可读。
    await exportMetaFromCheckpoint(outputDir)

    return result as ReducedGraphState
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    logger.error(`[MuseFlow] 章节写作流程出错: ${errorMessage}`)
    throw err
  }
}

function isForeshadowLikelyPolluted(item: ReducedGraphState['foreshadowStack'][number]): boolean {
  const text = item.text
  if (text.length <= 30) return false
  if (item.source === 'outline') return true
  const sentenceDelimiters = /[.!?。！？…]+/
  const sentences = text.split(sentenceDelimiters).filter(s => s.trim().length > 0)
  if (sentences.length >= 2 && text.length > 60) return true
  if (text.length > 120) return true
  return false
}

export interface RunOneChapterOptions {
  mode: 'draft' | 'rewrite' | 'continue'
  targetChapterIndex?: number | undefined
  userResponse?: boolean | undefined
  retryIssues?: Issue[] | undefined
  preserveTargetOutline?: boolean | undefined
}

function cleanStoryStateForRewrite(storyState: StoryState, targetChapterIndex: number): StoryState {
  const canonicalFacts = storyState.canonicalFacts ?? []
  const supersededFacts = storyState.supersededFacts ?? []

  const cleanedCanonicalFacts = canonicalFacts.filter(
    fact => fact.source === 'author_override' || fact.establishedIn < targetChapterIndex
  )
  const cleanedSupersededFacts = supersededFacts.filter(
    fact => fact.chapterIndex < targetChapterIndex
  )

  if (
    cleanedCanonicalFacts.length === canonicalFacts.length &&
    cleanedSupersededFacts.length === supersededFacts.length
  ) {
    return storyState
  }

  return {
    ...storyState,
    canonicalFacts: cleanedCanonicalFacts,
    supersededFacts: cleanedSupersededFacts,
  }
}

export async function runOneChapter(
  storyId: string,
  options: RunOneChapterOptions,
  context: RuntimeContext = createRuntimeContext()
): Promise<ReducedGraphState> {
  const outputDir = getOutputDirFromStoryId(storyId)
  if (!outputDir) {
    throw new Error(`Story ${storyId} not found`)
  }

  const graph = buildNovelGraph(context)
  const checkpointService = createCheckpointService(outputDir)
  await migrateLegacyCheckpoints(outputDir)
  await checkpointService.clearPendingWrites()

  let checkpointId: string | undefined
  if (options.mode === 'rewrite' && options.targetChapterIndex !== undefined) {
    const prevMarker = await checkpointService.getChapterMarker(options.targetChapterIndex)
    if (prevMarker) {
      checkpointId = prevMarker
    } else {
      const nextMarker = await checkpointService.getChapterMarker(options.targetChapterIndex + 1)
      if (nextMarker) {
        checkpointId = nextMarker
      }
    }
  }

  const snapshot = await graph.getState({
    configurable: { thread_id: storyId, outputDir, checkpoint_id: checkpointId },
  })
  const checkpointState = snapshot.values as ReducedGraphState

  const targetIndex = options.targetChapterIndex ?? checkpointState.currentChapterIndex

  const rewrittenChapters = new Array(checkpointState.totalChapters).fill(null) as ReducedGraphState['chapters']
  for (let i = 0; i < targetIndex; i++) {
    rewrittenChapters[i] = checkpointState.chapters[i] ?? null
  }

  const basePendingIssues = options.retryIssues?.length
    ? options.retryIssues
    : checkpointState.pendingIssues
  const cleanedPendingIssues = basePendingIssues.filter(issue => issue.type !== 'draft_failure')

  const workingState: ReducedGraphState = {
    ...checkpointState,
    currentChapterIndex: targetIndex,
    chapters: rewrittenChapters,
    pendingIssues: cleanedPendingIssues,
    chapterTimeAnchor: undefined,
    rewriteApproved: options.userResponse ?? false,
    rewriteRequested: false,
    isWriting: true,
    writeOneChapterOnly: true,
    chapterReport: null,
    blockingReport: null,
    session: {
      chapterIndex: targetIndex,
      rewriteAttempts: 0,
      errorRewriteAttempts: 0,
      autoFixAttempts: 0,
      previousIssues: [],
      previousRawErrorCount: 0,
      routingDecision: undefined,
      forceStructuralRewrite: false,
      rewriteApproved: options.userResponse ?? false,
      issueFingerprintHistory: [],
    },
    authorDecisions: {},
  }

  if (options.mode === 'rewrite') {
    workingState.chapterSummaries = checkpointState.chapterSummaries.slice(0, targetIndex)
    workingState.foreshadowStack = checkpointState.foreshadowStack.filter(
      f => f.createdAtChapter < targetIndex + 1 && !isForeshadowLikelyPolluted(f)
    )
    if (checkpointState.storyState) {
      workingState.storyState = cleanStoryStateForRewrite(checkpointState.storyState, targetIndex)
    }
    if (options.targetChapterIndex !== undefined) {
      workingState.chapterPlan = null
    }
  }

  if (options.mode === 'rewrite' && options.targetChapterIndex !== undefined) {
    const targetOutline = workingState.outline[targetIndex]
    const hasExistingTargetOutline = Boolean(targetOutline?.description?.trim())
    if (!options.preserveTargetOutline && !hasExistingTargetOutline) {
      // 目标章没有可执行大纲时才保持空大纲，让后续流程即时生成。
      const clearedOutline = [...workingState.outline]
      clearedOutline[targetIndex] = {
        number: targetIndex + 1,
        title: '',
        description: '',
      }
      workingState.outline = clearedOutline
    }

    for (let ch = targetIndex + 1; ch <= checkpointState.totalChapters; ch++) {
      await deleteChapterContent(outputDir, ch)
    }
  }

  return runChapterGraph(storyId, outputDir, workingState, context)
}

export async function continueStory(
  storyId: string,
  userResponse?: boolean,
  currentChapterIndex?: number,
  _options: { isRewrite?: boolean } = {},
  context: RuntimeContext = createRuntimeContext()
): Promise<ReducedGraphState> {
  return runOneChapter(storyId, {
    mode: 'continue',
    targetChapterIndex: currentChapterIndex,
    userResponse,
  }, context)
}

export async function applyStateOverrides(
  storyId: string,
  overrides: StateOverride[],
  constraints: string[],
  authorDecisions: Record<string, 'outline' | 'canonical'>
): Promise<void> {
  const outputDir = getOutputDirFromStoryId(storyId)
  if (!outputDir) {
    throw new Error(`Story ${storyId} not found`)
  }

  const state = await getState(storyId)
  if (!state) {
    throw new Error(`Story ${storyId} state not found`)
  }

  const storyState = state.storyState ?? createEmptyStoryState()
  const existingOverrides = storyState.overrides ?? []
  const existingConstraints = state.verifiedConstraints ?? []
  const existingDecisions = state.authorDecisions ?? {}

  const updatedStoryState = {
    ...storyState,
    overrides: [...existingOverrides, ...overrides],
  }
  const updatedConstraints = [...existingConstraints, ...constraints]
  const updatedDecisions = { ...existingDecisions, ...authorDecisions }

  const checkpointService = createCheckpointService(outputDir)
  await checkpointService.updateLatestState({
    storyState: updatedStoryState,
    verifiedConstraints: updatedConstraints,
    authorDecisions: updatedDecisions,
  })
}

/**
 * 应用作者采纳的系统大纲修订建议。
 *
 * 该函数会同时更新 checkpoint 中的 outline 数组和 outline.md 文件，
 * 使第 N+1 次运行基于新大纲继续生成。
 */
export async function applyOutlineRevision(
  storyId: string,
  chapterIndex: number,
  revisedDescription: string,
  revisedTitle?: string
): Promise<void> {
  const outputDir = getOutputDirFromStoryId(storyId)
  if (!outputDir) {
    throw new Error(`Story ${storyId} not found`)
  }

  const state = await getState(storyId)
  if (!state) {
    throw new Error(`Story ${storyId} state not found`)
  }

  const outline = [...(state.outline ?? [])]
  const existing = outline[chapterIndex]
  if (!existing) {
    throw new Error(`Chapter ${chapterIndex + 1} outline not found`)
  }

  outline[chapterIndex] = {
    ...existing,
    description: revisedDescription,
    ...(revisedTitle ? { title: revisedTitle } : {}),
  }

  const checkpointService = createCheckpointService(outputDir)
  await checkpointService.updateLatestState({ outline })

  await writeOutlineContent(
    outputDir,
    state.story.title,
    outline.map(ch => ({
      number: ch.number,
      title: ch.title,
      description: ch.description,
    }))
  )

  if (revisedTitle) {
    logger.info(`[MuseFlow] 已更新第 ${chapterIndex + 1} 章大纲标题为「${revisedTitle}」并同步到 outline.md`)
  } else {
    logger.info(`[MuseFlow] 已更新第 ${chapterIndex + 1} 章大纲并同步到 outline.md`)
  }
}

export async function getState(
  storyId: string,
  context: RuntimeContext = createRuntimeContext()
): Promise<ReducedGraphState | null> {
  const graph = buildNovelGraph(context)
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

    // Checkpoint 是运行时唯一真相源。不再从 meta.json 覆盖任何字段。
    // 清除过时的 draft_failure 问题，避免阻断后续生成。
    graphState.pendingIssues = graphState.pendingIssues.filter(issue => issue.type !== 'draft_failure')

    return graphState
  } catch (err) {
    logger.error(`[MuseFlow] 获取故事状态时出错: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}
