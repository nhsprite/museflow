import { buildNovelGraph } from '../graph/novel.graph.js'
import { GraphState } from '../graph/state.js'
import type { ReducedGraphState } from '../graph/state.js'
import type { RunnableConfig } from '@langchain/core/runnables'

let _graph: ReturnType<typeof buildNovelGraph> | null = null

function getGraph() {
  if (!_graph) {
    _graph = buildNovelGraph()
  }
  return _graph
}

export async function runStory(input: {
  storyId: string
  idea: string
  genre: string
  totalChapters: number
  story: unknown
}): Promise<ReducedGraphState> {
  const graph = getGraph()
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
  }

  const config: RunnableConfig = {
    configurable: { thread_id: input.storyId },
  }

  const result = await graph.invoke(initialState, config)
  return result as ReducedGraphState
}

export async function continueStory(
  storyId: string,
  userResponse?: boolean
): Promise<ReducedGraphState> {
  const graph = getGraph()
  const config: RunnableConfig = {
    configurable: { thread_id: storyId },
  }

  if (userResponse !== undefined) {
    const { Command } = await import('@langchain/langgraph')
    return await graph.invoke(
      new Command({
        goto: userResponse ? 'draft_chapter' : 'finalize_chapter',
        update: { rewriteApproved: userResponse, rewriteRequested: false },
      }),
      config
    ) as ReducedGraphState
  }

  const state = await graph.getState(config)
  return state.values as unknown as ReducedGraphState
}

export async function getState(storyId: string): Promise<ReducedGraphState | null> {
  const graph = getGraph()
  const config: RunnableConfig = {
    configurable: { thread_id: storyId },
  }
  try {
    const state = await graph.getState(config)
    return state.values as unknown as ReducedGraphState
  } catch {
    return null
  }
}
