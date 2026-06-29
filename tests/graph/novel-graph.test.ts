import { describe, it, expect } from 'vitest'
import { buildNovelGraph } from '../../src/graph/novel.graph.ts'

describe('novel graph', () => {
  it('compiles without missing node errors', () => {
    expect(() => buildNovelGraph()).not.toThrow()
  })

  it('contains all story-creation and chapter-writing nodes', () => {
    const graph = buildNovelGraph() as unknown as {
      builder: { nodes: Record<string, unknown> }
    }
    const nodeNames = Object.keys(graph.builder.nodes).filter(n => n !== '__start__')

    expect(nodeNames).toEqual([
      'build_world',
      'create_characters',
      'create_outline',
      'validate_outline',
      'prepare_chapter',
      'decide_strategy',
      'draft_chapter',
      'fix_chapter',
      'validate_chapter_comprehensive',
      'auto_fix_warnings',
      'convergence_check',
      'request_rewrite',
      'finalize_chapter',
      'finalize_story',
    ])
  })

  it('wires the story creation path edges', () => {
    const graph = buildNovelGraph() as unknown as {
      builder: { edges: Set<[string, string]> }
    }
    const edges = Array.from(graph.builder.edges).map(([from, to]) => `${from} -> ${to}`)

    expect(edges).toContain('build_world -> create_characters')
    expect(edges).toContain('create_characters -> create_outline')
    expect(edges).toContain('create_outline -> validate_outline')
    expect(edges).toContain('validate_outline -> finalize_story')
  })

  it('wires the chapter writing loop edges', () => {
    const graph = buildNovelGraph() as unknown as {
      builder: { edges: Set<[string, string]> }
    }
    const edges = Array.from(graph.builder.edges).map(([from, to]) => `${from} -> ${to}`)

    expect(edges).toContain('prepare_chapter -> decide_strategy')
    expect(edges).toContain('draft_chapter -> validate_chapter_comprehensive')
    expect(edges).toContain('fix_chapter -> validate_chapter_comprehensive')
    expect(edges).toContain('validate_chapter_comprehensive -> auto_fix_warnings')
    expect(edges).toContain('request_rewrite -> __end__')
    expect(edges).toContain('finalize_story -> __end__')
  })

  it('registers all conditional edges with complete branch mappings', () => {
    const graph = buildNovelGraph() as unknown as {
      builder: {
        branches: Record<string, { condition: { ends: Record<string, string> } }>
      }
    }

    expect(graph.builder.branches['__start__']?.condition.ends).toEqual({
      build_world: 'build_world',
      prepare_chapter: 'prepare_chapter',
    })

    expect(graph.builder.branches['decide_strategy']?.condition.ends).toEqual({
      draft_chapter: 'draft_chapter',
      fix_chapter: 'fix_chapter',
      finalize_chapter: 'finalize_chapter',
      request_rewrite: 'request_rewrite',
    })

    expect(graph.builder.branches['auto_fix_warnings']?.condition.ends).toEqual({
      convergence_check: 'convergence_check',
      finalize_chapter: 'finalize_chapter',
    })

    expect(graph.builder.branches['convergence_check']?.condition.ends).toEqual({
      decide_strategy: 'decide_strategy',
      finalize_chapter: 'finalize_chapter',
      request_rewrite: 'request_rewrite',
    })

    expect(graph.builder.branches['finalize_chapter']?.condition.ends).toEqual({
      finalize_story: 'finalize_story',
      prepare_chapter: 'prepare_chapter',
    })
  })

  it('compiles with a checkpointer', () => {
    const graph = buildNovelGraph() as unknown as { checkpointer: unknown }
    expect(graph.checkpointer).toBeDefined()
  })
})
