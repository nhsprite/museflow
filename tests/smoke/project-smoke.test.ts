import { describe, it, expect } from 'vitest'

describe('project smoke test', () => {
  it('should load core modules without error', async () => {
    const mod = await import('../../src/types/story.ts')
    expect(mod).toBeDefined()
    expect(mod.STORY_STATUSES).toBeDefined()
  })
})
