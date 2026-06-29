import { StateGraph } from '@langchain/langgraph'
import { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint'
import { GraphState } from './state.js'
import {
  build_world,
  create_characters,
  create_outline,
  validate_outline,
} from './nodes/story-creation.js'
import { draft_chapter } from './nodes/draft.js'
import { fix_chapter } from './nodes/fix.js'
import { validate_chapter_comprehensive } from './nodes/validation.js'
import {
  finalize_chapter,
  finalize_story,
} from './nodes/finalization.js'
import {
  prepare_chapter,
  converge_and_decide,
  request_rewrite,
  route_mode,
  route_by_decision,
  route_after_validation,
  route_after_finalize,
} from './nodes/chapter-orchestration.js'
import { getCheckpointer } from './checkpointer.js'
import { END, START } from '@langchain/langgraph'

export function buildNovelGraph() {
  const builder = new StateGraph(GraphState)

  const b1 = builder.addNode({
    build_world,
    create_characters,
    create_outline,
    validate_outline,
    prepare_chapter,
    converge_and_decide,
    draft_chapter,
    fix_chapter,
    validate_chapter_comprehensive,
    request_rewrite,
    finalize_chapter,
    finalize_story,
  })

  // Story creation path
  b1.addConditionalEdges(START, route_mode, {
    build_world: 'build_world',
    prepare_chapter: 'prepare_chapter',
  })

  b1.addEdge('build_world', 'create_characters')
  b1.addEdge('create_characters', 'create_outline')
  b1.addEdge('create_outline', 'validate_outline')
  b1.addEdge('validate_outline', 'finalize_story')

  // Chapter writing loop
  b1.addEdge('prepare_chapter', 'converge_and_decide')
  b1.addConditionalEdges('converge_and_decide', route_by_decision, {
    draft_chapter: 'draft_chapter',
    fix_chapter: 'fix_chapter',
    finalize_chapter: 'finalize_chapter',
    request_rewrite: 'request_rewrite',
  })

  b1.addEdge('draft_chapter', 'validate_chapter_comprehensive')
  b1.addEdge('fix_chapter', 'validate_chapter_comprehensive')

  b1.addConditionalEdges('validate_chapter_comprehensive', route_after_validation, {
    converge_and_decide: 'converge_and_decide',
  })

  b1.addEdge('request_rewrite', END)

  b1.addConditionalEdges('finalize_chapter', route_after_finalize, {
    finalize_story: 'finalize_story',
    prepare_chapter: 'prepare_chapter',
  })

  b1.addEdge('finalize_story', END)

  const checkpointer = getCheckpointer()
  return b1.compile({ checkpointer: checkpointer as unknown as BaseCheckpointSaver<number> })
}
