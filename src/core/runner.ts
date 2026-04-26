import { buildNovelGraph } from '../graph/novel.graph.js'
import type { ReducedGraphState } from '../graph/state.js'
import type { RunnableConfig } from '@langchain/core/runnables'
import { getOutputsDir } from '../utils/paths.js'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getForeshadowStack } from '../storage/database/dao/timeline.js'
import { getCheckpointer } from '../graph/checkpointer.js'
import {
  draft_chapter,
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

  const nodeSequence = [
    draft_chapter,
    validate_chapter,
    quality_pass,
    detect_foreshadowing,
    detect_hallucination,
    detect_consistency,
    verify_outline_compliance,
    auto_fix_warnings,
    finalize_chapter,
  ]

  for (const node of nodeSequence) {
    const partial = await node(workingState)
    workingState = {
      ...workingState,
      ...partial,
    }
    if (node === auto_fix_warnings) {
      const errors = workingState.pendingIssues.filter((i: { severity: string }) => i.severity === 'error')
      if (errors.length > 0) {
        console.error(`[MuseFlow] 检测到 ${errors.length} 个错误，中断章节撰写流程`)
        for (const err of errors) {
          const icon = err.severity === 'error' ? '❌' : err.severity === 'warning' ? '⚠️' : 'ℹ️'
          console.error(`  ${icon} [${err.type}] ${err.description}`)
          if (err.location) {
            console.error(`     位置: ${err.location}`)
          }
        }
        break
      }
    }
  }

  const hasErrors = workingState.pendingIssues.some((i: { severity: string }) => i.severity === 'error')
  if (hasErrors) {
    workingState.rewriteRequested = true
    await checkpointer.clearPendingWrites(outputDir)
    // 保存错误状态到 checkpointer，让 write 命令能检测到
    await graph.updateState(
      { configurable: { thread_id: storyId, outputDir } },
      {
        rewriteRequested: true,
        pendingIssues: workingState.pendingIssues,
      }
    )
    return workingState
  }

  workingState = {
    ...workingState,
    rewriteApproved: false,
    rewriteRequested: false,
  }
  await checkpointer.saveChapterCheckpoint(outputDir, targetIndex + 1)

  return workingState
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
