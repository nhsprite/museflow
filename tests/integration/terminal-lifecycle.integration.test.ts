import { describe, it, expect } from 'vitest'
import type { StoryEvent } from '../../src/types/story-memory.js'
import type { ChapterPlan } from '../../src/agents/types.js'
import {
  applyEvents,
  backfillLifecycleProjection,
  createEmptyStoryMemory,
} from '../../src/story-memory/projector.js'
import { validateChapterEvents } from '../../src/story-memory/validator.js'
import { buildStructuredIssues } from '../../src/core/chapter-generation/routing/structured-issues.js'
import { harvestChapterCanonicalFacts } from '../../src/graph/services/finalization/fact-harvest.js'
import { mergeStoryState } from '../../src/graph/utils/reconciler/state-merge.js'
import { formatStoryState } from '../../src/graph/utils/reconciler/format.js'
import { createEmptyStoryState } from '../../src/storage/meta/stores/story-state.js'

/**
 * B.1+B.2 集成：mock 章节流——第 39 章确立死亡事实定稿后，
 * 第 53 章对同一实体再发死亡/行动事件必须被 error 拦截；
 * 同时第 39 章回采的死亡事实在第 53 章渲染上下文中仍可见。
 */

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

const CHAPTER_39_INDEX = 38
const CHAPTER_53_INDEX = 52

function chapter39Events(): StoryEvent[] {
  return [
    {
      id: 'evt-ch39-death',
      type: 'character-status',
      characterId: 'c-liuhong',
      attribute: 'alive',
      value: false,
      chapterIndex: CHAPTER_39_INDEX,
      source: 'chapter',
      evidence: { paragraphIndex: 3 },
    },
  ]
}

function finalizeChapter39() {
  const acceptedEvents = chapter39Events()
  const memory = applyEvents(createEmptyStoryMemory(), acceptedEvents)
  // 定稿回采（B.2）：与 finalizeChapter 相同的 harvest + merge 路径
  const harvested = harvestChapterCanonicalFacts({
    chapterIndex: CHAPTER_39_INDEX,
    acceptedEvents,
    finalStateDeclarations: [{ entityId: 'c-liuhong', attribute: 'status', value: 'false' }],
  })
  const storyState = mergeStoryState(createEmptyStoryState(), {
    ...createEmptyStoryState(),
    canonicalFacts: harvested,
  })
  return { memory, storyState }
}

describe('terminal lifecycle integration (B.1 + B.2)', () => {
  it('blocks a duplicate death event for the chapter-39-dead entity at chapter 53', () => {
    const { memory } = finalizeChapter39()

    const chapter53Events: StoryEvent[] = [
      {
        id: 'evt-ch53-death-again',
        type: 'character-status',
        characterId: 'c-liuhong',
        attribute: 'alive',
        value: false,
        chapterIndex: CHAPTER_53_INDEX,
        source: 'chapter',
        evidence: { paragraphIndex: 2 },
      },
    ]
    const result = validateChapterEvents(
      memory,
      CHAPTER_53_INDEX,
      createEmptyChapterPlan(CHAPTER_53_INDEX),
      chapter53Events
    )
    const issues = buildStructuredIssues(result, CHAPTER_53_INDEX)
    const duplicate = issues.find((i) => i.ruleId === 'structured.entity-terminal-duplicate')
    expect(duplicate).toBeDefined()
    expect(duplicate!.severity).toBe('error')
  })

  it('blocks action events (location/status/holder) for the dead entity at chapter 53', () => {
    const { memory } = finalizeChapter39()

    const chapter53Events: StoryEvent[] = [
      {
        id: 'evt-ch53-move',
        type: 'character-location',
        characterId: 'c-liuhong',
        locationId: 'l-yamen',
        chapterIndex: CHAPTER_53_INDEX,
        source: 'chapter',
        evidence: { paragraphIndex: 4 },
      },
      {
        id: 'evt-ch53-item',
        type: 'item-location',
        itemId: 'item-seal',
        holderId: 'c-liuhong',
        locationId: 'c-liuhong',
        chapterIndex: CHAPTER_53_INDEX,
        source: 'chapter',
        evidence: { paragraphIndex: 5 },
      },
    ]
    const result = validateChapterEvents(
      memory,
      CHAPTER_53_INDEX,
      createEmptyChapterPlan(CHAPTER_53_INDEX),
      chapter53Events
    )
    const issues = buildStructuredIssues(result, CHAPTER_53_INDEX)
    const violations = issues.filter(
      (i) => i.ruleId === 'structured.entity-terminal-state-violation'
    )
    expect(violations).toHaveLength(2)
    expect(violations.every((i) => i.severity === 'error')).toBe(true)
  })

  it('keeps the chapter-39 death fact visible in the chapter-53 render context', () => {
    const { storyState } = finalizeChapter39()
    // 模拟 14 章积累的大量其它事实，把死亡事实推出旧 20 条窗口
    const filler = Array.from({ length: 60 }, (_, i) => ({
      id: `cf-filler-${i}`,
      subject: `c-extra-${i}`,
      attribute: 'status' as const,
      value: `琐事${i}`,
      establishedIn: CHAPTER_39_INDEX + 1 + i,
      confidence: 'high' as const,
      source: 'chapter_text' as const,
    }))
    const lateState = mergeStoryState(storyState, {
      ...createEmptyStoryState(),
      canonicalFacts: filler,
    })

    const text = formatStoryState(lateState)
    expect(text).toContain('[c-liuhong]')
    expect(text).toContain('死亡')
  })

  it('allows an explicit revival at chapter 53 and subsequent events', () => {
    const { memory } = finalizeChapter39()

    const chapter53Events: StoryEvent[] = [
      {
        id: 'evt-ch53-revival',
        type: 'character-revival',
        characterId: 'c-liuhong',
        chapterIndex: CHAPTER_53_INDEX,
        source: 'chapter',
        evidence: { paragraphIndex: 2 },
      },
      {
        id: 'evt-ch53-move',
        type: 'character-location',
        characterId: 'c-liuhong',
        locationId: 'l-yamen',
        chapterIndex: CHAPTER_53_INDEX,
        source: 'chapter',
        evidence: { paragraphIndex: 4 },
      },
    ]
    const result = validateChapterEvents(
      memory,
      CHAPTER_53_INDEX,
      createEmptyChapterPlan(CHAPTER_53_INDEX),
      chapter53Events
    )
    expect(result.terminalStateViolations).toHaveLength(0)
    expect(result.terminalDuplicateEvents).toHaveLength(0)

    // 投影消费复活事件后终态标记清除
    const after = applyEvents(memory, chapter53Events)
    expect(after.entities.characters['c-liuhong']?.lifecycle?.alive).toBe(true)
  })

  it('enforces the invariants on legacy memory after structural backfill (no lifecycle fields)', () => {
    // 旧格式 memory：事件无 lifecycle 字段，实体投影无终态标记（旧 checkpoint 直接读入）
    const legacyEvents: StoryEvent[] = [
      {
        id: 'evt-legacy-death',
        type: 'character-status',
        characterId: 'c-liuhong',
        attribute: 'alive',
        value: false,
        chapterIndex: CHAPTER_39_INDEX,
        source: 'chapter',
      },
    ]
    const legacyMemory = {
      ...createEmptyStoryMemory(),
      events: legacyEvents,
      lastChapterIndex: CHAPTER_39_INDEX,
    }
    // structured-validation 节点在读入时做结构化回填（不做任何 prose 猜测）
    const migrated = backfillLifecycleProjection(legacyMemory)
    const withEntities = {
      ...migrated,
      entities: {
        ...migrated.entities,
        characters: {
          'c-liuhong': {
            id: 'c-liuhong',
            name: 'c-liuhong',
            locationId: null,
            status: { alive: false },
            introducedIn: 0,
          },
        },
      },
    }
    const backfilled = backfillLifecycleProjection(withEntities)
    expect(backfilled.entities.characters['c-liuhong']?.lifecycle?.alive).toBe(false)

    const chapter53Events: StoryEvent[] = [
      {
        id: 'evt-ch53-death-again',
        type: 'character-status',
        characterId: 'c-liuhong',
        attribute: 'alive',
        value: false,
        chapterIndex: CHAPTER_53_INDEX,
        source: 'chapter',
        evidence: { paragraphIndex: 2 },
      },
    ]
    const result = validateChapterEvents(
      backfilled,
      CHAPTER_53_INDEX,
      createEmptyChapterPlan(CHAPTER_53_INDEX),
      chapter53Events
    )
    expect(result.terminalDuplicateEvents).toHaveLength(1)
  })
})
