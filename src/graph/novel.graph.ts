import { StateGraph } from '@langchain/langgraph'
import { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint'
import { GraphState } from './state.js'
import {
  build_world,
  create_characters,
  create_outline,
  validate_outline,
  prepare_chapter,
  decide_strategy,
  draft_chapter,
  fix_chapter,
  validate_chapter_comprehensive,
  auto_fix_warnings,
  convergence_check,
  request_rewrite,
  finalize_chapter,
  finalize_story,
} from './nodes.js'
import {
  route_mode,
  route_strategy,
  route_after_validation,
  route_convergence,
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
    decide_strategy,
    draft_chapter,
    fix_chapter,
    validate_chapter_comprehensive,
    auto_fix_warnings,
    convergence_check,
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
  b1.addEdge('prepare_chapter', 'decide_strategy')
  b1.addConditionalEdges('decide_strategy', route_strategy, {
    draft_chapter: 'draft_chapter',
    fix_chapter: 'fix_chapter',
    finalize_chapter: 'finalize_chapter',
    request_rewrite: 'request_rewrite',
  })

  b1.addEdge('draft_chapter', 'validate_chapter_comprehensive')
  b1.addEdge('fix_chapter', 'validate_chapter_comprehensive')

  b1.addEdge('validate_chapter_comprehensive', 'auto_fix_warnings')

  b1.addConditionalEdges('auto_fix_warnings', route_after_validation, {
    convergence_check: 'convergence_check',
    finalize_chapter: 'finalize_chapter',
  })

  b1.addConditionalEdges('convergence_check', route_convergence, {
    decide_strategy: 'decide_strategy',
    finalize_chapter: 'finalize_chapter',
    request_rewrite: 'request_rewrite',
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
