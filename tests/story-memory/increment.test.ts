import { describe, expect, it } from 'vitest'
import { evaluateChapterIncrement } from '../../src/story-memory/increment.js'
import { applyEvents, createEmptyStoryMemory } from '../../src/story-memory/projector.js'
import type { StoryEvent, StoryMemory } from '../../src/types/story-memory.js'

function makeMemory(events: StoryEvent[] = []): StoryMemory {
  return events.length > 0
    ? applyEvents(createEmptyStoryMemory(), events)
    : createEmptyStoryMemory()
}

function locationEvent(id: string, characterId: string, locationId: string): StoryEvent {
  return {
    id,
    type: 'character-location',
    characterId,
    locationId,
    chapterIndex: 0,
    source: 'chapter',
  }
}

function statusEvent(id: string, characterId: string, value: string): StoryEvent {
  return {
    id,
    type: 'character-status',
    characterId,
    attribute: 'health',
    value,
    chapterIndex: 0,
    source: 'chapter',
  }
}

function itemLocationEvent(id: string, itemId: string, holderId: string): StoryEvent {
  return {
    id,
    type: 'item-location',
    itemId,
    holderId,
    locationId: holderId,
    chapterIndex: 0,
    source: 'chapter',
  }
}

function itemStateEvent(id: string, itemId: string, value: string): StoryEvent {
  return {
    id,
    type: 'item-state',
    itemId,
    attribute: 'sealed',
    value,
    chapterIndex: 0,
    source: 'chapter',
  }
}

function plotAdvanceEvent(id: string, beatId: string): StoryEvent {
  return { id, type: 'plot-advance', plotId: 'act-1', beatId, chapterIndex: 0, source: 'chapter' }
}

function foreshadowIntroduceEvent(id: string, foreshadowId: string): StoryEvent {
  return {
    id,
    type: 'foreshadow-introduce',
    foreshadowId,
    text: `${foreshadowId} text`,
    kind: 'other',
    expectedFulfillChapter: 3,
    resolutionPolicy: 'must_resolve',
    required: true,
    beatId: null,
    chapterIndex: 0,
    source: 'chapter',
  }
}

function foreshadowFulfillEvent(id: string, foreshadowId: string): StoryEvent {
  return { id, type: 'foreshadow-fulfill', foreshadowId, chapterIndex: 0, source: 'chapter' }
}

function deadlineExtendEvent(id: string, foreshadowId: string): StoryEvent {
  return {
    id,
    type: 'foreshadow-deadline-extend',
    foreshadowId,
    newExpectedFulfillChapter: 5,
    chapterIndex: 0,
    source: 'outline',
  }
}

function taskCreateEvent(id: string, taskId: string): StoryEvent {
  return {
    id,
    type: 'task-create',
    taskId,
    description: `${taskId} description`,
    chapterIndex: 0,
    source: 'chapter',
  }
}

function taskResolveEvent(id: string, taskId: string): StoryEvent {
  return { id, type: 'task-resolve', taskId, chapterIndex: 0, source: 'chapter' }
}

describe('evaluateChapterIncrement', () => {
  it('reports zero increment when no events are applied', () => {
    const before = makeMemory([locationEvent('evt-base', 'c-1', 'l-1')])
    const verdict = evaluateChapterIncrement(3, before, before, [])

    expect(verdict.zeroIncrement).toBe(true)
    expect(verdict.acceptedEventCount).toBe(0)
    expect(verdict.chapterIndex).toBe(3)
    expect(Object.values(verdict.increments).every((count) => count === 0)).toBe(true)
  })

  it('reports zero increment when events restate the current projection', () => {
    // 同值事件不改变投影：重复声明同一位置不算增量。
    const before = makeMemory([locationEvent('evt-base', 'c-1', 'l-1')])
    const restated = [locationEvent('evt-same', 'c-1', 'l-1')]
    const after = makeMemory([...before.events, ...restated])
    const verdict = evaluateChapterIncrement(3, before, after, restated)

    expect(verdict.zeroIncrement).toBe(true)
    expect(verdict.acceptedEventCount).toBe(1)
  })

  it('detects a character location change as increment', () => {
    const before = makeMemory([locationEvent('evt-base', 'c-1', 'l-1')])
    const chapterEvents = [locationEvent('evt-move', 'c-1', 'l-2')]
    const after = makeMemory([...before.events, ...chapterEvents])
    const verdict = evaluateChapterIncrement(3, before, after, chapterEvents)

    expect(verdict.zeroIncrement).toBe(false)
    expect(verdict.increments.characterLocationChanges).toBe(1)
  })

  it('detects a character status change as increment', () => {
    const before = makeMemory([statusEvent('evt-base', 'c-1', 'healthy')])
    const chapterEvents = [statusEvent('evt-hurt', 'c-1', 'injured')]
    const after = makeMemory([...before.events, ...chapterEvents])
    const verdict = evaluateChapterIncrement(3, before, after, chapterEvents)

    expect(verdict.zeroIncrement).toBe(false)
    expect(verdict.increments.characterStatusChanges).toBe(1)
  })

  it('detects item holder and item state changes as increment', () => {
    const before = makeMemory([
      itemLocationEvent('evt-base', 'i-1', 'c-1'),
      itemStateEvent('evt-state-base', 'i-1', 'sealed'),
    ])
    const chapterEvents = [
      itemLocationEvent('evt-take', 'i-1', 'c-2'),
      itemStateEvent('evt-unseal', 'i-1', 'unsealed'),
    ]
    const after = makeMemory([...before.events, ...chapterEvents])
    const verdict = evaluateChapterIncrement(3, before, after, chapterEvents)

    expect(verdict.zeroIncrement).toBe(false)
    expect(verdict.increments.itemHolderChanges).toBe(1)
    expect(verdict.increments.itemStateChanges).toBe(1)
  })

  it('detects foreshadow introduction, fulfillment, and deadline extension as increment', () => {
    const before = makeMemory([foreshadowIntroduceEvent('evt-intro', 'fs-1')])
    const chapterEvents = [
      foreshadowIntroduceEvent('evt-intro-2', 'fs-2'),
      foreshadowFulfillEvent('evt-fulfill', 'fs-1'),
      deadlineExtendEvent('evt-extend', 'fs-2'),
    ]
    const after = makeMemory([...before.events, ...chapterEvents])
    const verdict = evaluateChapterIncrement(3, before, after, chapterEvents)

    expect(verdict.zeroIncrement).toBe(false)
    expect(verdict.increments.newForeshadows).toBe(1)
    expect(verdict.increments.fulfilledForeshadows).toBe(1)
    expect(verdict.increments.foreshadowDeadlineExtensions).toBe(1)
  })

  it('detects task creation and resolution as increment', () => {
    const before = makeMemory([taskCreateEvent('evt-task-base', 'task-1')])
    const chapterEvents = [
      taskCreateEvent('evt-task-new', 'task-2'),
      taskResolveEvent('evt-task-done', 'task-1'),
    ]
    const after = makeMemory([...before.events, ...chapterEvents])
    const verdict = evaluateChapterIncrement(3, before, after, chapterEvents)

    expect(verdict.zeroIncrement).toBe(false)
    expect(verdict.increments.newTasks).toBe(1)
    expect(verdict.increments.resolvedTasks).toBe(1)
  })

  it('counts plot-advance as increment even without state projection changes', () => {
    const before = makeMemory()
    const chapterEvents = [plotAdvanceEvent('evt-beat', 'A1-M1')]
    const after = makeMemory(chapterEvents)
    const verdict = evaluateChapterIncrement(3, before, after, chapterEvents)

    expect(verdict.zeroIncrement).toBe(false)
    expect(verdict.increments.plotAdvances).toBe(1)
  })
})
