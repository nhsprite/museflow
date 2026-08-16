import { describe, expect, it } from 'vitest'
import type { ReducedGraphState } from '../../src/graph/state.js'
import { normalizeStoryEvent } from '../../src/story-memory/event-contract.js'
import { parseStoryEventsBlock } from '../../src/story-memory/parser.js'
import { renderStoryEventLine } from '../../src/story-memory/event-format.js'
import {
  applyEvents,
  createEmptyStoryMemory,
  projectEntities,
} from '../../src/story-memory/projector.js'
import { validatePlannedStoryEventAuthority } from '../../src/story-memory/event-authority.js'
import { validateChapterEvents } from '../../src/story-memory/validator.js'
import { evaluateChapterIncrement } from '../../src/story-memory/increment.js'
import type { ChapterPlan } from '../../src/agents/types.js'
import type { EntityRegisterEvent, StoryEvent } from '../../src/types/story-memory.js'

function entityRegister(overrides: Partial<EntityRegisterEvent> = {}): EntityRegisterEvent {
  return {
    id: 'evt-register-1',
    type: 'entity-register',
    entityKind: 'character',
    entityId: 'c-minor-1',
    displayName: '沈七',
    chapterIndex: 0,
    source: 'chapter',
    evidence: { paragraphIndex: 1 },
    ...overrides,
  }
}

function buildPlan(overrides: Partial<ChapterPlan> = {}): ChapterPlan {
  return {
    chapterIndex: 0,
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

function authorityState(): ReducedGraphState {
  return {
    characters: [],
    storyArc: null,
    foreshadowStack: [],
    storyMemory: createEmptyStoryMemory(),
    storyState: {
      characterLocations: {},
      characterStatus: {},
      keyItemsLocation: {},
      keyItemsState: {},
      activePlots: [],
      revealedSecrets: [],
      pendingTasks: [],
      currentScene: '',
      storyTime: {},
    },
  } as ReducedGraphState
}

describe('entity-register 事件契约', () => {
  it('接受合法的 entity-register 事件', () => {
    const result = normalizeStoryEvent(
      {
        id: 'evt-1',
        type: 'entity-register',
        entityKind: 'item',
        entityId: 'item-token-1',
        displayName: '告身',
        chapterIndex: 0,
        source: 'chapter',
        evidence: { paragraphIndex: 2 },
      },
      { chapterIndex: 0, mode: 'strict' }
    )
    expect(result.ok).toBe(true)
    if (result.ok && result.event.type === 'entity-register') {
      expect(result.event.entityKind).toBe('item')
      expect(result.event.entityId).toBe('item-token-1')
      expect(result.event.displayName).toBe('告身')
    }
  })

  it('拒绝非法 entityKind / 非法 entityId / 空 displayName', () => {
    const base = {
      id: 'evt-1',
      type: 'entity-register',
      entityKind: 'character',
      entityId: 'c-1',
      displayName: '名字',
      chapterIndex: 0,
      source: 'chapter',
    }
    for (const bad of [
      { ...base, entityKind: 'location' },
      { ...base, entityId: '中文名' },
      { ...base, displayName: '  ' },
    ]) {
      const result = normalizeStoryEvent(bad, { chapterIndex: 0, mode: 'strict' })
      expect(result.ok).toBe(false)
    }
  })
})

describe('entity-register 正文文本格式解析与渲染', () => {
  it('解析 entity-register 行（含 @pN 证据）', () => {
    const block = [
      '=== STORY_EVENTS ===',
      '- entity-register: c-minor-1 / kind=character / name=沈七 @p2',
      '',
      '=== CHAPTER_CONTENT ===',
    ].join('\n')
    const events = parseStoryEventsBlock(block, 0)
    expect(events).toHaveLength(1)
    const event = events[0]!
    expect(event.type).toBe('entity-register')
    if (event.type === 'entity-register') {
      expect(event.entityKind).toBe('character')
      expect(event.entityId).toBe('c-minor-1')
      expect(event.displayName).toBe('沈七')
      expect(event.evidence?.paragraphIndex).toBe(2)
    }
  })

  it('丢弃非法 kind 或缺失 name 的注册行', () => {
    const block = [
      '=== STORY_EVENTS ===',
      '- entity-register: c-1 / kind=location / name=某地 @p1',
      '- entity-register: c-2 / kind=character @p1',
      '',
      '=== CHAPTER_CONTENT ===',
    ].join('\n')
    expect(parseStoryEventsBlock(block, 0)).toEqual([])
  })

  it('renderStoryEventLine 输出可被 parser 回读', () => {
    const line = renderStoryEventLine(entityRegister())
    expect(line).toBe('entity-register: c-minor-1 / kind=character / name=沈七')
    const events = parseStoryEventsBlock(
      `=== STORY_EVENTS ===\n- ${line} @p1\n\n=== CHAPTER_CONTENT ===`,
      0
    )
    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('entity-register')
  })
})

describe('entity-register 投影', () => {
  it('注册后实体获得真实 id 与可读名，并进入位置投影（次要角色可追踪）', () => {
    const memory = createEmptyStoryMemory()
    const register = entityRegister()
    const move: StoryEvent = {
      id: 'evt-move-1',
      type: 'character-location',
      characterId: 'c-minor-1',
      locationId: 'l-capital',
      chapterIndex: 0,
      source: 'chapter',
      evidence: { paragraphIndex: 3 },
    }
    const next = applyEvents(memory, [register, move])
    const character = next.entities.characters['c-minor-1']
    expect(character?.name).toBe('沈七')
    expect(character?.introducedIn).toBe(0)
    expect(character?.locationId).toBe('l-capital')
  })

  it('注册回填占位名（name===id）且不回退已有可读名', () => {
    const events: StoryEvent[] = [
      {
        id: 'evt-status-1',
        type: 'character-status',
        characterId: 'c-minor-1',
        attribute: 'status',
        value: '受伤',
        chapterIndex: 0,
        source: 'chapter',
      },
      entityRegister({ id: 'evt-register-2' }),
    ]
    const entities = projectEntities(events)
    expect(entities.characters['c-minor-1']?.name).toBe('沈七')
    expect(entities.characters['c-minor-1']?.status['status']).toBe('受伤')
  })

  it('item 类型的注册进入物品投影', () => {
    const entities = projectEntities([
      entityRegister({ entityKind: 'item', entityId: 'item-token-1', displayName: '告身' }),
    ])
    expect(entities.items['item-token-1']?.name).toBe('告身')
    expect(entities.characters['item-token-1']).toBeUndefined()
  })
})

describe('entity-register 权威校验', () => {
  const reference: StoryEvent = {
    id: 'evt-ref-1',
    type: 'character-location',
    characterId: 'c-minor-1',
    locationId: null,
    chapterIndex: 0,
    source: 'chapter',
  }

  it('引用未注册实体按既有未知 id 规则报错', () => {
    const issues = validatePlannedStoryEventAuthority(authorityState(), [reference])
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ field: 'characterId', id: 'c-minor-1' })
  })

  it('同批事件流先注册后引用则通过', () => {
    const issues = validatePlannedStoryEventAuthority(authorityState(), [
      entityRegister(),
      reference,
    ])
    expect(issues).toEqual([])
  })

  it('entity-register 自身是创建事件，不做已知 id 校验', () => {
    const issues = validatePlannedStoryEventAuthority(authorityState(), [entityRegister()])
    expect(issues).toEqual([])
  })
})

describe('entity-register 结构化校验', () => {
  it('未规划的注册事件不算 unexpected，也不产生 missing', () => {
    const memory = createEmptyStoryMemory()
    const result = validateChapterEvents(memory, 0, buildPlan(), [entityRegister()])
    expect(result.unexpectedEvents).toEqual([])
    expect(result.missingEvents).toEqual([])
    expect(result.actualEvents.map((event) => event.id)).toContain('evt-register-1')
  })
})

describe('entity-register 增量判定', () => {
  it('注册事件计入增量（零增量闸不误伤只引入新实体的章节）', () => {
    const memory = createEmptyStoryMemory()
    const next = applyEvents(memory, [entityRegister()])
    const verdict = evaluateChapterIncrement(0, memory, next, [entityRegister()])
    expect(verdict.increments.entityRegistrations).toBe(1)
    expect(verdict.zeroIncrement).toBe(false)
  })
})
