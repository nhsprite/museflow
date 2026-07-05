import { describe, it, expect } from 'vitest'
import type { KeyBeat, ChapterOutline } from '../../src/types/outline.js'

describe('outline types', () => {
  it('KeyBeat accepts stable id and structured fields', () => {
    const beat: KeyBeat = {
      id: 'A1-B1',
      beat: 'protagonist discovers clue',
      deadlineAct: 1,
      required: true,
    }
    expect(beat.id).toBe('A1-B1')
  })

  it('ChapterOutline accepts structured declarations', () => {
    const outline: ChapterOutline = {
      number: 1,
      title: 'Chapter 1',
      description: 'Opening',
      claimedBeatIds: ['A1-B1'],
      fulfilledForeshadowIds: ['F1-1'],
    }
    expect(outline.claimedBeatIds).toContain('A1-B1')
  })
})
