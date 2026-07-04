import { describe, expect, it, vi } from 'vitest'
import type { ModelProvider } from '../../src/model/provider.js'
import { getWorldbuilderAgent } from '../../src/graph/agent-factory.js'

class TestProvider implements ModelProvider {
  chat = vi.fn().mockResolvedValue('')
}

describe('agent-factory', () => {
  it('keeps separate agent instances for different provider objects of the same class', () => {
    const firstProvider = new TestProvider()
    const secondProvider = new TestProvider()

    const firstAgent = getWorldbuilderAgent(firstProvider)
    const secondAgent = getWorldbuilderAgent(secondProvider)

    expect(firstAgent).not.toBe(secondAgent)
  })
})
