import { describe, it, expect } from 'vitest'
import {
  getActiveForeshadows,
  getOverdueForeshadows,
  getUnprovenMandatoryBeats,
  getOpenTasks,
  getCharacterLocation,
  getItemHolder,
} from '../../src/story-memory/queries.js'
import { createEmptyStoryMemory, applyEvents } from '../../src/story-memory/projector.js'

describe('queries', () => {
  it('returns active foreshadows', () => {
    const memory = applyEvents(createEmptyStoryMemory(), [
      {
        id: 'e1',
        type: 'foreshadow-introduce',
        foreshadowId: 'f-1',
        expectedFulfillChapter: 5,
        chapterIndex: 1,
        source: 'outline',
      },
    ])
    expect(getActiveForeshadows(memory)).toContain('f-1')
  })

  it('returns overdue foreshadows', () => {
    const memory = applyEvents(createEmptyStoryMemory(), [
      {
        id: 'e1',
        type: 'foreshadow-introduce',
        foreshadowId: 'f-1',
        expectedFulfillChapter: 3,
        chapterIndex: 1,
        source: 'outline',
      },
    ])
    memory.foreshadows['f-1']!.required = true
    expect(getOverdueForeshadows(memory, 5)).toContain('f-1')
  })

  it('returns unproven mandatory beats', () => {
    const memory = applyEvents(createEmptyStoryMemory(), [
      {
        id: 'e1',
        type: 'plot-advance',
        plotId: 'p-1',
        beatId: 'a1-b1',
        chapterIndex: 1,
        source: 'chapter',
      },
    ])
    expect(getUnprovenMandatoryBeats(memory)).toEqual([])
  })

  it('returns unproven mandatory beats from direct beat', () => {
    const memory = createEmptyStoryMemory()
    memory.beats['a1-b1'] = {
      id: 'a1-b1',
      description: 'test beat',
      actIndex: 1,
      deadlineAct: 1,
      required: true,
      claimedIn: null,
      provenByEventIds: [],
    }
    expect(getUnprovenMandatoryBeats(memory)).toContain('a1-b1')
  })

  it('returns open tasks', () => {
    const memory = applyEvents(createEmptyStoryMemory(), [
      {
        id: 'e1',
        type: 'task-create',
        taskId: 't-1',
        description: 'find key',
        chapterIndex: 1,
        source: 'chapter',
      },
    ])
    expect(getOpenTasks(memory)).toContain('t-1')
  })

  it('returns character location', () => {
    const memory = applyEvents(createEmptyStoryMemory(), [
      {
        id: 'e1',
        type: 'character-location',
        characterId: 'c-1',
        locationId: 'l-1',
        chapterIndex: 1,
        source: 'chapter',
      },
    ])
    expect(getCharacterLocation(memory, 'c-1')).toBe('l-1')
  })

  it('returns item holder', () => {
    const memory = applyEvents(createEmptyStoryMemory(), [
      {
        id: 'e1',
        type: 'item-location',
        itemId: 'i-1',
        holderId: 'c-1',
        locationId: null,
        chapterIndex: 1,
        source: 'chapter',
      },
    ])
    expect(getItemHolder(memory, 'i-1')).toBe('c-1')
  })
})
