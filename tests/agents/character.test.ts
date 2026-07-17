import { describe, expect, it, vi } from 'vitest'
import { CharacterAgent } from '../../src/agents/character.js'
import type { AgentOutput } from '../../src/agents/base.js'
import type { CharacterAgentInput } from '../../src/agents/types.js'
import type { Message } from '../../src/model/provider.js'
import type { ModelProvider } from '../../src/model/provider.js'

class TestableCharacterAgent extends CharacterAgent {
  public exposePrompt(state: CharacterAgentInput): Message[] {
    return this.buildPrompt(state)
  }
}

function createAgent(): TestableCharacterAgent {
  const provider: ModelProvider = {
    chat: vi.fn(),
    chatStructured: vi.fn(),
  }
  return new TestableCharacterAgent(provider)
}

function output(data: unknown): AgentOutput {
  return { success: true, data }
}

describe('CharacterAgent.processOutput', () => {
  it('requires the explicit machine-readable character contract in the prompt', () => {
    const messages = createAgent().exposePrompt({
      idea: '测试故事',
      genre: 'default',
      totalChapters: 10,
    })
    const prompt = messages[1]?.content ?? ''

    expect(prompt).toContain('name、description、dialogueStyle、aliases、isProtagonist')
    expect(prompt).toContain('至少有一个角色为 true')
    expect(prompt).toContain('不要使用外层对象包装')
  })

  it('accepts explicit aliases and protagonist roles', () => {
    const characters = createAgent().processOutput(
      output([
        {
          name: '甲',
          description: '核心人物',
          dialogueStyle: '简短',
          aliases: ['阿甲'],
          isProtagonist: true,
        },
      ]),
      'story-1'
    )

    expect(characters).toEqual([
      expect.objectContaining({
        name: '甲',
        aliases: ['阿甲'],
        isProtagonist: true,
      }),
    ])
  })

  it.each([
    {
      name: 'missing aliases',
      data: [{ name: '甲', description: null, dialogueStyle: null, isProtagonist: true }],
    },
    {
      name: 'missing protagonist marker',
      data: [{ name: '甲', description: null, dialogueStyle: null, aliases: [] }],
    },
    {
      name: 'invalid alias entry',
      data: [
        {
          name: '甲',
          description: null,
          dialogueStyle: null,
          aliases: [''],
          isProtagonist: true,
        },
      ],
    },
    {
      name: 'no protagonist in batch',
      data: [
        {
          name: '甲',
          description: null,
          dialogueStyle: null,
          aliases: [],
          isProtagonist: false,
        },
      ],
    },
  ])('rejects a batch with $name', ({ data }) => {
    expect(createAgent().processOutput(output(data), 'story-1')).toEqual([])
  })

  it('rejects object wrappers and non-English field fallbacks', () => {
    const wrapped = {
      characters: [
        {
          姓名: '甲',
          背景故事: '核心人物',
          对话风格: '简短',
          aliases: ['阿甲'],
          isProtagonist: true,
        },
      ],
    }

    expect(createAgent().processOutput(output(wrapped), 'story-1')).toEqual([])
  })
})
