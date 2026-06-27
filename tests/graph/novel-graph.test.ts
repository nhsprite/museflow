import { describe, it, expect } from 'vitest'
import { buildNovelGraph } from '../../src/graph/novel.graph.ts'

describe('novel graph', () => {
  it('compiles without missing node errors', () => {
    expect(() => buildNovelGraph()).not.toThrow()
  })
})
