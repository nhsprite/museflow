import { buildNovelGraph } from '../graph/novel.graph.js'
import type { ReducedGraphState } from '../graph/state.js'
import type { RunnableConfig } from '@langchain/core/runnables'
import { getOutputsDir } from '../utils/paths.js'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

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
  userResponse?: boolean
): Promise<ReducedGraphState> {
  const graph = getGraph()
  const outputDir = getOutputDirFromStoryId(storyId)
  if (!outputDir) {
    throw new Error(`Story ${storyId} not found`)
  }
  const config: RunnableConfig = {
    configurable: { thread_id: storyId, outputDir },
  }

  const { Command } = await import('@langchain/langgraph')

  if (userResponse !== undefined) {
    return await graph.invoke(
      new Command({
        goto: userResponse ? 'draft_chapter' : 'finalize_chapter',
        update: { rewriteApproved: userResponse, rewriteRequested: false, isWriting: true },
      }),
      config
    ) as ReducedGraphState
  }

  return await graph.invoke(
    new Command({
      goto: 'draft_chapter',
      update: { rewriteApproved: false, rewriteRequested: false, isWriting: true },
    }),
    config
  ) as ReducedGraphState
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
    return state.values as unknown as ReducedGraphState
  } catch {
    return null
  }
}
