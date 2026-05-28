import { StateGraph } from '@langchain/langgraph'
import { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint'
import { GraphState } from './state.js'
import {
  build_world,
  create_characters,
  create_outline,
  plan_chapter,
  draft_chapter,
  validate_chapter,
  quality_pass,
  detect_foreshadowing,
  detect_hallucination,
  detect_consistency,
  verify_outline_compliance,
  auto_fix_warnings,
  request_rewrite,
  finalize_chapter,
  finalize_story,
} from './nodes.js'
import { should_start_chapters } from './edges.js'
import { getCheckpointer } from './checkpointer.js'
import { END, START } from '@langchain/langgraph'

export function buildNovelGraph() {
  const builder = new StateGraph(GraphState)

  const b1 = builder.addNode({
    build_world,
    create_characters,
    create_outline,
    plan_chapter,
    draft_chapter,
    validate_chapter,
    quality_pass,
    detect_foreshadowing,
    detect_hallucination,
    detect_consistency,
    verify_outline_compliance,
    auto_fix_warnings,
    request_rewrite,
    finalize_chapter,
    finalize_story,
  })

  b1.addEdge(START, 'build_world')
  b1.addEdge('build_world', 'create_characters')
  b1.addEdge('create_characters', 'create_outline')
  b1.addConditionalEdges('create_outline', (state) => state.isWriting ? 'plan_chapter' : 'finalize_story')

  b1.addEdge('plan_chapter', 'draft_chapter')
  b1.addEdge('draft_chapter', 'validate_chapter')
  b1.addEdge('validate_chapter', 'quality_pass')
  b1.addEdge('quality_pass', 'detect_foreshadowing')
  b1.addEdge('detect_foreshadowing', 'detect_hallucination')
  b1.addEdge('detect_hallucination', 'detect_consistency')
  b1.addEdge('detect_consistency', 'verify_outline_compliance')
  b1.addEdge('verify_outline_compliance', 'auto_fix_warnings')

  b1.addConditionalEdges(
    'auto_fix_warnings',
    should_start_chapters,
    {
      draft_chapter: 'plan_chapter',
      request_rewrite: 'request_rewrite',
      next_chapter: 'finalize_chapter',
      finalize_chapter: 'finalize_chapter',
      finalize_story: 'finalize_story',
      revalidate: 'validate_chapter',
    }
  )

  b1.addEdge('request_rewrite', END)

  b1.addConditionalEdges(
    'finalize_chapter',
    (state) => {
      if (state.writeOneChapterOnly) {
        return 'finalize_story'
      }
      if (state.currentChapterIndex < state.totalChapters) {
        return 'plan_chapter'
      }
      return 'finalize_story'
    }
  )

  b1.addEdge('finalize_story', END)

  const checkpointer = getCheckpointer()
  return b1.compile({ checkpointer: checkpointer as unknown as BaseCheckpointSaver<number> })
}
