import { describe, expect, it } from 'vitest'
import type { StoryConfig } from '../../src/types/story.js'

describe('StoryConfig outlineStrategy', () => {
  it('accepts layered strategy', () => {
    const config: StoryConfig = {
      provider: 'openai',
      model: 'gpt-4o',
      outlineStrategy: 'layered',
    }
    expect(config.outlineStrategy).toBe('layered')
  })

  it('defaults to legacy when omitted', () => {
    const config: StoryConfig = {
      provider: 'openai',
      model: 'gpt-4o',
    }
    expect(config.outlineStrategy ?? 'legacy').toBe('legacy')
  })
})
