import { describe, it, expect } from 'vitest'
import type { CharacterStatusEvent, StoryEvent } from '../../src/types/story-memory.js'
import {
  applyEvents,
  backfillLifecycleProjection,
  createEmptyStoryMemory,
  projectEntities,
} from '../../src/story-memory/projector.js'
import {
  formatLifecycleFactValue,
  getTerminalCharacterIds,
  isTerminalCharacter,
  lifecycleChannelFromStatusEvent,
} from '../../src/story-memory/lifecycle.js'
import { parseStoryEventsBlock } from '../../src/story-memory/parser.js'
import { normalizeStoryEvent } from '../../src/story-memory/event-contract.js'
import { diffEvents } from '../../src/story-memory/diff.js'
import { evaluateChapterIncrement } from '../../src/story-memory/increment.js'
import { renderStoryEventLine } from '../../src/story-memory/event-format.js'
import { validateChapterEvents } from '../../src/story-memory/validator.js'
import { buildStructuredIssues } from '../../src/core/chapter-generation/routing/structured-issues.js'
import type { ChapterPlan } from '../../src/agents/types.js'

function statusEvent(
  characterId: string,
  attribute: string,
  value: unknown,
  chapterIndex = 0
): CharacterStatusEvent {
  return {
    id: `evt-${characterId}-${attribute}-${chapterIndex}-${String(value)}`,
    type: 'character-status',
    characterId,
    attribute,
    value,
    chapterIndex,
    source: 'chapter',
  }
}

function deathEvent(characterId: string, chapterIndex = 0): CharacterStatusEvent {
  return statusEvent(characterId, 'alive', false, chapterIndex)
}

function revivalEvent(characterId: string, chapterIndex = 0): StoryEvent {
  return {
    id: `evt-revival-${characterId}-${chapterIndex}`,
    type: 'character-revival',
    characterId,
    chapterIndex,
    source: 'chapter',
    evidence: { paragraphIndex: 1 },
  }
}

function createEmptyChapterPlan(
  chapterIndex: number,
  overrides: Partial<ChapterPlan> = {}
): ChapterPlan {
  return {
    chapterIndex,
    sections: [],
    timeline: [],
    outlineCheck: [],
    expectedEvents: [],
    claimedBeatIds: [],
    fulfilledForeshadowIds: [],
    introducedForeshadowIds: [],
    resolvedTaskIds: [],
    createdTaskIds: [],
    ...overrides,
  }
}

describe('lifecycleChannelFromStatusEvent', () => {
  it('extracts the explicit lifecycle channel', () => {
    const event: CharacterStatusEvent = {
      ...statusEvent('c-1', 'status', '重伤'),
      lifecycle: { attribute: 'alive', value: false },
    }
    expect(lifecycleChannelFromStatusEvent(event)).toEqual({ attribute: 'alive', value: false })
  })

  it('derives the channel from a controlled attribute with a boolean value', () => {
    expect(lifecycleChannelFromStatusEvent(statusEvent('c-1', 'alive', false))).toEqual({
      attribute: 'alive',
      value: false,
    })
  })

  it('returns null for free-text attributes and non-boolean values', () => {
    expect(lifecycleChannelFromStatusEvent(statusEvent('c-1', 'mood', '愤怒'))).toBeNull()
    expect(lifecycleChannelFromStatusEvent(statusEvent('c-1', 'alive', '死亡'))).toBeNull()
  })
})

describe('projector terminal monotonicity (B.1)', () => {
  it('marks alive=false as terminal and blocks status flip back to true', () => {
    const entities = projectEntities([deathEvent('c-1', 0), statusEvent('c-1', 'alive', true, 1)])
    const character = entities.characters['c-1']!
    expect(isTerminalCharacter(character)).toBe(true)
    expect(character.lifecycle?.alive).toBe(false)
  })

  it('allows non-lifecycle status events without touching the terminal flag', () => {
    const entities = projectEntities([deathEvent('c-1', 0), statusEvent('c-1', 'mood', '平静', 1)])
    const character = entities.characters['c-1']!
    expect(character.status['mood']).toBe('平静')
    expect(character.lifecycle?.alive).toBe(false)
  })

  it('clears the terminal flag only via an explicit character-revival event', () => {
    const entities = projectEntities([
      deathEvent('c-1', 0),
      revivalEvent('c-1', 1),
      statusEvent('c-1', 'alive', true, 2),
    ])
    const character = entities.characters['c-1']!
    expect(isTerminalCharacter(character)).toBe(false)
    expect(character.lifecycle?.alive).toBe(true)
  })

  it('collects terminal character ids from projections', () => {
    const entities = projectEntities([deathEvent('c-1', 0), deathEvent('c-2', 0)])
    expect(getTerminalCharacterIds(entities)).toEqual(new Set(['c-1', 'c-2']))
  })
})

describe('backfillLifecycleProjection (legacy migration, B.1)', () => {
  it('backfills terminal flags from structured events on legacy memory', () => {
    // 旧 checkpoint：事件里没有 lifecycle 字段，实体投影也没有终态标记。
    const legacyEvents: StoryEvent[] = [
      {
        id: 'evt-legacy-death',
        type: 'character-status',
        characterId: 'c-1',
        attribute: 'alive',
        value: false,
        chapterIndex: 38,
        source: 'chapter',
      },
    ]
    const legacyMemory = { ...createEmptyStoryMemory(), events: legacyEvents, lastChapterIndex: 38 }
    expect(legacyMemory.entities.characters['c-1']).toBeUndefined()

    const backfilled = backfillLifecycleProjection(legacyMemory)
    // 事件流中没有创建过实体记录时只回填已有实体；这里实体本就不存在，保持不动。
    expect(backfilled.entities.characters['c-1']).toBeUndefined()

    // 实体已存在但缺 lifecycle 标记的存量投影：回填后终态可见。
    const withEntity = applyEvents(createEmptyStoryMemory(), legacyEvents)
    const stripped = {
      ...withEntity,
      entities: {
        ...withEntity.entities,
        characters: {
          'c-1': { ...withEntity.entities.characters['c-1']!, lifecycle: undefined },
        },
      },
    }
    const restored = backfillLifecycleProjection(stripped)
    expect(restored.entities.characters['c-1']?.lifecycle?.alive).toBe(false)
  })

  it('is idempotent and leaves free-text statuses unguessed', () => {
    const events: StoryEvent[] = [statusEvent('c-1', 'status', '死亡', 0)]
    const memory = applyEvents(createEmptyStoryMemory(), events)
    const once = backfillLifecycleProjection(memory)
    expect(once.entities.characters['c-1']?.lifecycle).toBeUndefined()
    expect(backfillLifecycleProjection(once)).toBe(once)
  })
})

describe('parser lifecycle support (B.1)', () => {
  function wrap(events: string): string {
    return `=== STORY_EVENTS ===\n${events}\n=== CHAPTER_CONTENT ===\n正文`
  }

  it('parses boolean alive status into the typed lifecycle channel', () => {
    const events = parseStoryEventsBlock(wrap('- character-status: c-1 / alive -> false @p2'), 3)
    expect(events).toHaveLength(1)
    const event = events[0]!
    expect(event.type).toBe('character-status')
    if (event.type !== 'character-status') throw new Error('unexpected type')
    expect(event.value).toBe(false)
    expect(event.lifecycle).toEqual({ attribute: 'alive', value: false })
    expect(event.evidence).toEqual({ paragraphIndex: 2 })
  })

  it('parses character-revival lines', () => {
    const events = parseStoryEventsBlock(wrap('- character-revival: c-1 @p4'), 3)
    expect(events).toEqual([
      expect.objectContaining({
        type: 'character-revival',
        characterId: 'c-1',
        chapterIndex: 3,
        evidence: { paragraphIndex: 4 },
      }),
    ])
  })

  it('keeps free-text alive values on the compatibility lane (no channel)', () => {
    const events = parseStoryEventsBlock(wrap('- character-status: c-1 / alive -> 濒死 @p1'), 0)
    const event = events[0]!
    if (event.type !== 'character-status') throw new Error('unexpected type')
    expect(event.lifecycle).toBeUndefined()
    expect(event.value).toBe('濒死')
  })
})

describe('event-contract lifecycle compatibility (B.1)', () => {
  it('accepts legacy character-status events without a lifecycle field', () => {
    const result = normalizeStoryEvent(
      {
        id: 'evt-1',
        type: 'character-status',
        characterId: 'c-1',
        attribute: 'mood',
        value: '平静',
        chapterIndex: 0,
        source: 'chapter',
      },
      { chapterIndex: 0, mode: 'strict' }
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.event.type).toBe('character-status')
    if (result.event.type !== 'character-status') return
    expect(result.event.lifecycle).toBeUndefined()
  })

  it('backfills the lifecycle channel for structured alive booleans and validates explicit channels', () => {
    const derived = normalizeStoryEvent(
      {
        id: 'evt-2',
        type: 'character-status',
        characterId: 'c-1',
        attribute: 'alive',
        value: false,
        chapterIndex: 0,
        source: 'chapter',
      },
      { chapterIndex: 0, mode: 'strict' }
    )
    expect(derived.ok).toBe(true)
    if (derived.ok && derived.event.type === 'character-status') {
      expect(derived.event.lifecycle).toEqual({ attribute: 'alive', value: false })
    }

    const invalid = normalizeStoryEvent(
      {
        id: 'evt-3',
        type: 'character-status',
        characterId: 'c-1',
        attribute: 'status',
        value: 'x',
        chapterIndex: 0,
        source: 'chapter',
        lifecycle: { attribute: 'undead', value: 'yes' },
      },
      { chapterIndex: 0, mode: 'strict' }
    )
    expect(invalid.ok).toBe(false)
  })

  it('normalizes character-revival events', () => {
    const result = normalizeStoryEvent(
      {
        id: 'evt-4',
        type: 'character-revival',
        characterId: 'c-1',
        chapterIndex: 0,
        source: 'chapter',
        evidence: { paragraphIndex: 1 },
      },
      { chapterIndex: 0, mode: 'strict' }
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.event.type).toBe('character-revival')
  })
})

describe('diff / increment / format compatibility (B.1)', () => {
  it('matches character-revival events in plan-vs-actual diff', () => {
    const expected = [revivalEvent('c-1', 2)]
    const actual = [{ ...revivalEvent('c-1', 2), id: 'evt-different-id' }]
    const diff = diffEvents(expected, actual)
    expect(diff.matched).toHaveLength(1)
    expect(diff.unexpected).toHaveLength(0)
    expect(diff.missing).toHaveLength(0)
  })

  it('counts character-revival as an increment', () => {
    const memoryBefore = applyEvents(createEmptyStoryMemory(), [deathEvent('c-1', 0)])
    const chapterEvents = [revivalEvent('c-1', 1)]
    const memoryAfter = applyEvents(memoryBefore, chapterEvents)
    const verdict = evaluateChapterIncrement(1, memoryBefore, memoryAfter, chapterEvents)
    expect(verdict.increments.characterRevivals).toBe(1)
    expect(verdict.zeroIncrement).toBe(false)
  })

  it('renders character-revival event lines', () => {
    expect(renderStoryEventLine(revivalEvent('c-1', 1))).toBe('character-revival: c-1')
  })

  it('renders lifecycle fact values from structured channels', () => {
    expect(formatLifecycleFactValue({ attribute: 'alive', value: false })).toBe('死亡')
    expect(formatLifecycleFactValue({ attribute: 'alive', value: true })).toBe('存活')
  })
})

describe('validator terminal invariants (B.1)', () => {
  function memoryWithDeadCharacter(characterId: string, deathChapter = 0) {
    return applyEvents(createEmptyStoryMemory(), [deathEvent(characterId, deathChapter)])
  }

  it('flags any event referencing a terminal entity as structured.entity-terminal-state-violation', () => {
    const memory = memoryWithDeadCharacter('c-1')
    const plan = createEmptyChapterPlan(1)
    const actual: StoryEvent[] = [
      {
        id: 'evt-move',
        type: 'character-location',
        characterId: 'c-1',
        locationId: 'l-2',
        chapterIndex: 1,
        source: 'chapter',
      },
    ]
    const result = validateChapterEvents(memory, 1, plan, actual)
    expect(result.terminalStateViolations).toHaveLength(1)
    expect(result.terminalStateViolations[0]!.entityId).toBe('c-1')

    const issues = buildStructuredIssues(result, 1)
    const issue = issues.find((i) => i.ruleId === 'structured.entity-terminal-state-violation')
    expect(issue).toBeDefined()
    expect(issue!.severity).toBe('error')
  })

  it('flags a status event on a terminal entity even for non-lifecycle attributes', () => {
    const memory = memoryWithDeadCharacter('c-1')
    const actual: StoryEvent[] = [statusEvent('c-1', 'mood', '平静', 1)]
    const result = validateChapterEvents(memory, 1, createEmptyChapterPlan(1), actual)
    expect(result.terminalStateViolations).toHaveLength(1)
    expect(result.terminalDuplicateEvents).toHaveLength(0)
  })

  it('flags a second death for an already-dead entity as structured.entity-terminal-duplicate', () => {
    const memory = memoryWithDeadCharacter('c-1')
    const actual: StoryEvent[] = [deathEvent('c-1', 1)]
    const result = validateChapterEvents(memory, 1, createEmptyChapterPlan(1), actual)
    expect(result.terminalDuplicateEvents).toHaveLength(1)
    expect(result.terminalStateViolations).toHaveLength(0)

    const issues = buildStructuredIssues(result, 1)
    const issue = issues.find((i) => i.ruleId === 'structured.entity-terminal-duplicate')
    expect(issue).toBeDefined()
    expect(issue!.severity).toBe('error')
  })

  it('flags item custody referencing a terminal holder', () => {
    const memory = memoryWithDeadCharacter('c-1')
    const actual: StoryEvent[] = [
      {
        id: 'evt-item',
        type: 'item-location',
        itemId: 'item-1',
        holderId: 'c-1',
        locationId: 'c-1',
        chapterIndex: 1,
        source: 'chapter',
      },
    ]
    const result = validateChapterEvents(memory, 1, createEmptyChapterPlan(1), actual)
    expect(result.terminalStateViolations).toHaveLength(1)
    expect(result.terminalStateViolations[0]!.entityId).toBe('c-1')
  })

  it('allows an explicit character-revival and subsequent events after it', () => {
    const memory = memoryWithDeadCharacter('c-1')
    const actual: StoryEvent[] = [
      revivalEvent('c-1', 1),
      {
        id: 'evt-move-after-revival',
        type: 'character-location',
        characterId: 'c-1',
        locationId: 'l-1',
        chapterIndex: 1,
        source: 'chapter',
      },
    ]
    const result = validateChapterEvents(memory, 1, createEmptyChapterPlan(1), actual)
    expect(result.terminalStateViolations).toHaveLength(0)
    expect(result.terminalDuplicateEvents).toHaveLength(0)
  })

  it('flags events after the death event within the same chapter but not the death itself', () => {
    const memory = createEmptyStoryMemory()
    const actual: StoryEvent[] = [
      deathEvent('c-1', 1),
      {
        id: 'evt-after-death',
        type: 'character-location',
        characterId: 'c-1',
        locationId: 'l-9',
        chapterIndex: 1,
        source: 'chapter',
      },
    ]
    const result = validateChapterEvents(memory, 1, createEmptyChapterPlan(1), actual)
    expect(result.terminalDuplicateEvents).toHaveLength(0)
    expect(result.terminalStateViolations.map((v) => v.event.id)).toEqual(['evt-after-death'])
  })

  it('does not flag events for living entities', () => {
    const memory = applyEvents(createEmptyStoryMemory(), [statusEvent('c-1', 'alive', true, 0)])
    const actual: StoryEvent[] = [
      {
        id: 'evt-move',
        type: 'character-location',
        characterId: 'c-1',
        locationId: 'l-2',
        chapterIndex: 1,
        source: 'chapter',
      },
    ]
    const result = validateChapterEvents(memory, 1, createEmptyChapterPlan(1), actual)
    expect(result.terminalStateViolations).toHaveLength(0)
    expect(result.terminalDuplicateEvents).toHaveLength(0)
  })
})
