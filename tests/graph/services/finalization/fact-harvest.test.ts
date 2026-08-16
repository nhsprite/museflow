import { describe, it, expect } from 'vitest'
import { harvestChapterCanonicalFacts } from '../../../../src/graph/services/finalization/fact-harvest.js'
import { mergeStoryState } from '../../../../src/graph/utils/reconciler/state-merge.js'
import { createEmptyStoryState } from '../../../../src/storage/meta/stores/story-state.js'
import type { StoryEvent } from '../../../../src/types/story-memory.js'

function deathEvent(characterId: string, chapterIndex: number): StoryEvent {
  return {
    id: `evt-death-${characterId}`,
    type: 'character-status',
    characterId,
    attribute: 'alive',
    value: false,
    chapterIndex,
    source: 'chapter',
    evidence: { paragraphIndex: 1 },
  }
}

describe('harvestChapterCanonicalFacts (B.2)', () => {
  it('harvests lifecycle facts from typed lifecycle status events', () => {
    const facts = harvestChapterCanonicalFacts({
      chapterIndex: 38,
      acceptedEvents: [deathEvent('c-1', 38)],
      finalStateDeclarations: [],
    })
    expect(facts).toHaveLength(1)
    expect(facts[0]).toMatchObject({
      subject: 'c-1',
      attribute: 'lifecycle',
      value: '死亡',
      establishedIn: 38,
      source: 'chapter_text',
      lifecycle: { attribute: 'alive', value: false },
    })
  })

  it('harvests lifecycle facts from explicit character-revival events', () => {
    const facts = harvestChapterCanonicalFacts({
      chapterIndex: 10,
      acceptedEvents: [
        {
          id: 'evt-revival',
          type: 'character-revival',
          characterId: 'c-1',
          chapterIndex: 10,
          source: 'chapter',
          evidence: { paragraphIndex: 2 },
        },
      ],
      finalStateDeclarations: [],
    })
    expect(facts).toHaveLength(1)
    expect(facts[0]).toMatchObject({
      subject: 'c-1',
      attribute: 'lifecycle',
      value: '存活',
      source: 'chapter_text',
      lifecycle: { attribute: 'alive', value: true },
    })
  })

  it('harvests custody changes from item-location events with a holder', () => {
    const facts = harvestChapterCanonicalFacts({
      chapterIndex: 5,
      acceptedEvents: [
        {
          id: 'evt-item',
          type: 'item-location',
          itemId: 'item-1',
          holderId: 'c-2',
          locationId: 'c-2',
          chapterIndex: 5,
          source: 'chapter',
        },
        {
          id: 'evt-item-fixed',
          type: 'item-location',
          itemId: 'item-2',
          holderId: null,
          locationId: 'l-1',
          chapterIndex: 5,
          source: 'chapter',
        },
      ],
      finalStateDeclarations: [],
    })
    expect(facts).toHaveLength(1)
    expect(facts[0]).toMatchObject({
      subject: 'item-1',
      attribute: 'holder',
      value: 'c-2',
      source: 'chapter_text',
    })
  })

  it('harvests corroborated final-state declarations only', () => {
    const facts = harvestChapterCanonicalFacts({
      chapterIndex: 7,
      acceptedEvents: [
        {
          id: 'evt-move',
          type: 'character-location',
          characterId: 'c-1',
          locationId: 'l-2',
          chapterIndex: 7,
          source: 'chapter',
        },
        {
          id: 'evt-hurt',
          type: 'character-status',
          characterId: 'c-3',
          attribute: 'status',
          value: '重伤',
          chapterIndex: 7,
          source: 'chapter',
        },
      ],
      finalStateDeclarations: [
        // 受佐证：最后一条 location 事件值与声明一致
        { entityId: 'c-1', attribute: 'location', value: 'l-2' },
        // 未受佐证：本章没有该实体事件
        { entityId: 'c-2', attribute: 'location', value: 'l-9' },
        // 受佐证的 status 声明
        { entityId: 'c-3', attribute: 'status', value: '重伤' },
        // 与最后一条事件值不一致：跳过
        { entityId: 'c-3', attribute: 'location', value: 'l-1' },
      ],
    })
    const bySubject = facts.map((fact) => `${fact.subject}:${fact.attribute}:${fact.value}`)
    expect(bySubject).toContain('c-1:location:l-2')
    expect(bySubject).toContain('c-3:status:重伤')
    expect(bySubject).not.toContain('c-2:location:l-9')
    expect(bySubject).not.toContain('c-3:location:l-1')
  })

  it('does not derive bare boolean status facts from lifecycle events', () => {
    const facts = harvestChapterCanonicalFacts({
      chapterIndex: 38,
      acceptedEvents: [deathEvent('c-1', 38)],
      finalStateDeclarations: [{ entityId: 'c-1', attribute: 'status', value: 'false' }],
    })
    // 只有 lifecycle 事实，没有 value 为裸布尔文本的 status 事实
    expect(facts).toHaveLength(1)
    expect(facts[0]!.attribute).toBe('lifecycle')
  })

  it('merges idempotently and retires superseded values through mergeStoryState', () => {
    const base = createEmptyStoryState()
    const deathFacts = harvestChapterCanonicalFacts({
      chapterIndex: 38,
      acceptedEvents: [deathEvent('c-1', 38)],
      finalStateDeclarations: [],
    })
    const merged = mergeStoryState(base, { ...createEmptyStoryState(), canonicalFacts: deathFacts })
    const remerged = mergeStoryState(merged, {
      ...createEmptyStoryState(),
      canonicalFacts: deathFacts,
    })
    expect(
      remerged.canonicalFacts!.filter(
        (fact) => fact.subject === 'c-1' && fact.attribute === 'lifecycle'
      )
    ).toHaveLength(1)

    // 复活事实退休死亡事实
    const revivalFacts = harvestChapterCanonicalFacts({
      chapterIndex: 52,
      acceptedEvents: [
        {
          id: 'evt-revival',
          type: 'character-revival',
          characterId: 'c-1',
          chapterIndex: 52,
          source: 'chapter',
        },
      ],
      finalStateDeclarations: [],
    })
    const afterRevival = mergeStoryState(remerged, {
      ...createEmptyStoryState(),
      canonicalFacts: revivalFacts,
    })
    const active = afterRevival.canonicalFacts!.filter(
      (fact) => fact.subject === 'c-1' && fact.attribute === 'lifecycle' && !fact.retiredIn
    )
    expect(active).toHaveLength(1)
    expect(active[0]!.value).toBe('存活')
  })

  it('harvests identity facts from entity-register events (B.3)', () => {
    const facts = harvestChapterCanonicalFacts({
      chapterIndex: 19,
      acceptedEvents: [
        {
          id: 'evt-register-1',
          type: 'entity-register',
          entityKind: 'character',
          entityId: 'c-minor-1',
          displayName: '沈七',
          chapterIndex: 19,
          source: 'chapter',
          evidence: { paragraphIndex: 1 },
        },
        {
          id: 'evt-register-2',
          type: 'entity-register',
          entityKind: 'item',
          entityId: 'item-token-1',
          displayName: '告身',
          chapterIndex: 19,
          source: 'chapter',
          evidence: { paragraphIndex: 2 },
        },
      ],
      finalStateDeclarations: [],
    })
    expect(facts).toHaveLength(2)
    expect(facts[0]).toMatchObject({
      subject: 'c-minor-1',
      attribute: 'identity',
      value: '沈七',
      establishedIn: 19,
      source: 'chapter_text',
    })
    expect(facts[1]).toMatchObject({
      subject: 'item-token-1',
      attribute: 'identity',
      value: '告身',
      source: 'chapter_text',
    })
  })
})
