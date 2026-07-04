import { describe, expect, it, vi, beforeEach } from 'vitest'
import { generateOutlineRevisionProposal } from '../../../src/core/chapter-generation/outline-revision-proposal.js'
import type { ModelProvider } from '../../../src/model/provider.js'
import type { StoryState, Conflict } from '../../../src/types/story-state.js'
import type { ChapterOutline } from '../../../src/types/outline.js'

function createMockProvider(chat: ModelProvider['chat']): ModelProvider {
  return { chat, chatStructured: vi.fn().mockResolvedValue({}) }
}

function emptyState(): StoryState {
  return {
    characterLocations: {},
    characterStatus: {},
    keyItemsLocation: {},
    keyItemsState: {},
    activePlots: [],
    revealedSecrets: [],
    pendingTasks: [],
    currentScene: '',
    storyTime: '',
  }
}

function makeConflict(overrides: Partial<Conflict> = {}): Conflict {
  return {
    id: 'c1',
    type: 'contradiction',
    subject: '主角',
    attribute: '所在位置',
    oldValue: '家中',
    newValue: '京城',
    outlineReference: '',
    severity: 'blocking',
    description: '大纲要求主角抵达京城，与权威事实冲突',
    ...overrides,
  }
}

describe('generateOutlineRevisionProposal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when there are no blocking conflicts', async () => {
    const outline: ChapterOutline[] = [
      { number: 1, title: 'Test', description: '主角在家中思考。' },
    ]
    const conflict: Conflict = { ...makeConflict(), severity: 'warning' }
    const provider = createMockProvider(vi.fn())

    const result = await generateOutlineRevisionProposal(
      outline,
      0,
      [conflict],
      emptyState(),
      provider
    )
    expect(result).toBeNull()
    expect(provider.chat).not.toHaveBeenCalled()
  })

  it('returns null when the target chapter outline is missing', async () => {
    const outline: ChapterOutline[] = []
    const provider = createMockProvider(vi.fn())

    const result = await generateOutlineRevisionProposal(
      outline,
      0,
      [makeConflict()],
      emptyState(),
      provider
    )
    expect(result).toBeNull()
    expect(provider.chat).not.toHaveBeenCalled()
  })

  it('parses a valid proposal from the model response', async () => {
    const outline: ChapterOutline[] = [
      { number: 1, title: 'Test', description: '主角秘密抵达京城。' },
    ]
    const provider = createMockProvider(
      vi.fn().mockResolvedValue(
        JSON.stringify({
          revisedDescription: '主角在家中收到京城来信，决定暂缓出行。',
          explanation: '将“抵达京城”改为“收到来信”，避免与“主角仍在家中”的权威事实冲突。',
        })
      )
    )

    const result = await generateOutlineRevisionProposal(
      outline,
      0,
      [makeConflict()],
      emptyState(),
      provider
    )
    expect(result).not.toBeNull()
    expect(result!.revisedDescription).toBe('主角在家中收到京城来信，决定暂缓出行。')
    expect(result!.explanation).toBe(
      '将“抵达京城”改为“收到来信”，避免与“主角仍在家中”的权威事实冲突。'
    )
    expect(provider.chat).toHaveBeenCalledTimes(1)
  })

  it('parses a revised title when the model includes one', async () => {
    const outline: ChapterOutline[] = [
      { number: 1, title: 'Test', description: '主角秘密抵达京城。' },
    ]
    const provider = createMockProvider(
      vi.fn().mockResolvedValue(
        JSON.stringify({
          revisedDescription: '主角在家中收到京城来信，决定暂缓出行。',
          explanation: '将“抵达京城”改为“收到来信”，避免与“主角仍在家中”的权威事实冲突。',
          revisedTitle: '京城来信',
        })
      )
    )

    const result = await generateOutlineRevisionProposal(
      outline,
      0,
      [makeConflict()],
      emptyState(),
      provider
    )
    expect(result).not.toBeNull()
    expect(result!.revisedDescription).toBe('主角在家中收到京城来信，决定暂缓出行。')
    expect(result!.explanation).toBe(
      '将“抵达京城”改为“收到来信”，避免与“主角仍在家中”的权威事实冲突。'
    )
    expect(result!.revisedTitle).toBe('京城来信')
    expect(provider.chat).toHaveBeenCalledTimes(1)
  })

  it('returns null and swallows errors when the model response is invalid', async () => {
    const outline: ChapterOutline[] = [
      { number: 1, title: 'Test', description: '主角秘密抵达京城。' },
    ]
    const provider = createMockProvider(vi.fn().mockResolvedValue('not valid json'))

    const result = await generateOutlineRevisionProposal(
      outline,
      0,
      [makeConflict()],
      emptyState(),
      provider
    )
    expect(result).toBeNull()
  })

  it('returns null and swallows errors when the model call fails', async () => {
    const outline: ChapterOutline[] = [
      { number: 1, title: 'Test', description: '主角秘密抵达京城。' },
    ]
    const provider = createMockProvider(vi.fn().mockRejectedValue(new Error('API error')))

    const result = await generateOutlineRevisionProposal(
      outline,
      0,
      [makeConflict()],
      emptyState(),
      provider
    )
    expect(result).toBeNull()
  })
})
