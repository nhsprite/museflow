import { describe, it, expect } from 'vitest'
import { diffEvents, diffMemorySnapshots } from '../../src/story-memory/diff.js'
import { createEmptyStoryMemory, applyEvents } from '../../src/story-memory/projector.js'

describe('diffEvents', () => {
  it('detects missing events', () => {
    const expected = [
      {
        id: 'e1',
        type: 'character-location' as const,
        characterId: 'c-1',
        locationId: 'l-1',
        chapterIndex: 1,
        source: 'chapter' as const,
      },
    ]
    const result = diffEvents(expected, [])
    expect(result.missing).toHaveLength(1)
    expect(result.unexpected).toHaveLength(0)
  })

  it('detects unexpected events', () => {
    const actual = [
      {
        id: 'e1',
        type: 'character-location' as const,
        characterId: 'c-1',
        locationId: 'l-1',
        chapterIndex: 1,
        source: 'chapter' as const,
      },
    ]
    const result = diffEvents([], actual)
    expect(result.missing).toHaveLength(0)
    expect(result.unexpected).toHaveLength(1)
  })

  it('matches foreshadow-introduce events', () => {
    const expected = [
      {
        id: 'e1',
        type: 'foreshadow-introduce' as const,
        foreshadowId: 'f-1',
        expectedFulfillChapter: 5,
        chapterIndex: 1,
        source: 'outline' as const,
      },
    ]
    const actual = [
      {
        id: 'e2',
        type: 'foreshadow-introduce' as const,
        foreshadowId: 'f-1',
        expectedFulfillChapter: 5,
        chapterIndex: 1,
        source: 'outline' as const,
      },
    ]
    const result = diffEvents(expected, actual)
    expect(result.matched).toHaveLength(1)
    expect(result.missing).toHaveLength(0)
    expect(result.unexpected).toHaveLength(0)
  })

  it('does not match foreshadow introductions with different policies', () => {
    const base = {
      id: 'e1',
      type: 'foreshadow-introduce' as const,
      foreshadowId: 'f-1',
      expectedFulfillChapter: null,
      required: true,
      chapterIndex: 1,
      source: 'outline' as const,
    }

    const result = diffEvents(
      [{ ...base, resolutionPolicy: 'should_resolve' as const }],
      [{ ...base, id: 'e2', resolutionPolicy: 'may_remain_open' as const, required: false }]
    )

    expect(result.matched).toHaveLength(0)
    expect(result.missing).toHaveLength(1)
    expect(result.unexpected).toHaveLength(1)
  })

  it('matches foreshadow-policy-set events by policy and deadline', () => {
    const expected = {
      id: 'e1',
      type: 'foreshadow-policy-set' as const,
      foreshadowId: 'f-1',
      resolutionPolicy: 'must_resolve' as const,
      expectedFulfillChapter: 12,
      chapterIndex: 3,
      source: 'outline' as const,
    }
    const actual = { ...expected, id: 'e2' }

    expect(diffEvents([expected], [actual]).matched).toHaveLength(1)
  })

  it('matches task-create events', () => {
    const expected = [
      {
        id: 'e1',
        type: 'task-create' as const,
        taskId: 't-1',
        description: 'find the key',
        chapterIndex: 2,
        source: 'chapter' as const,
      },
    ]
    const actual = [
      {
        id: 'e2',
        type: 'task-create' as const,
        taskId: 't-1',
        description: 'find the key',
        chapterIndex: 2,
        source: 'chapter' as const,
      },
    ]
    const result = diffEvents(expected, actual)
    expect(result.matched).toHaveLength(1)
    expect(result.missing).toHaveLength(0)
    expect(result.unexpected).toHaveLength(0)
  })
})

describe('diffEvents matches all event variants', () => {
  const eventTemplates = [
    {
      name: 'character-location',
      match: {
        id: 'e1',
        type: 'character-location' as const,
        characterId: 'c-1',
        locationId: 'l-1',
        chapterIndex: 1,
        source: 'chapter' as const,
      },
      mismatch: {
        id: 'e2',
        type: 'character-location' as const,
        characterId: 'c-1',
        locationId: 'l-2',
        chapterIndex: 1,
        source: 'chapter' as const,
      },
    },
    {
      name: 'character-status',
      match: {
        id: 'e1',
        type: 'character-status' as const,
        characterId: 'c-1',
        attribute: 'health',
        value: 'injured',
        chapterIndex: 1,
        source: 'chapter' as const,
      },
      mismatch: {
        id: 'e2',
        type: 'character-status' as const,
        characterId: 'c-1',
        attribute: 'health',
        value: 'healthy',
        chapterIndex: 1,
        source: 'chapter' as const,
      },
    },
    {
      name: 'item-location',
      match: {
        id: 'e1',
        type: 'item-location' as const,
        itemId: 'i-1',
        holderId: 'c-1',
        locationId: null,
        chapterIndex: 1,
        source: 'chapter' as const,
      },
      mismatch: {
        id: 'e2',
        type: 'item-location' as const,
        itemId: 'i-1',
        holderId: 'c-2',
        locationId: null,
        chapterIndex: 1,
        source: 'chapter' as const,
      },
    },
    {
      name: 'item-state',
      match: {
        id: 'e1',
        type: 'item-state' as const,
        itemId: 'i-1',
        attribute: 'condition',
        value: 'broken',
        chapterIndex: 1,
        source: 'chapter' as const,
      },
      mismatch: {
        id: 'e2',
        type: 'item-state' as const,
        itemId: 'i-1',
        attribute: 'condition',
        value: 'repaired',
        chapterIndex: 1,
        source: 'chapter' as const,
      },
    },
    {
      name: 'plot-advance',
      match: {
        id: 'e1',
        type: 'plot-advance' as const,
        plotId: 'p-1',
        beatId: 'a1-b1',
        chapterIndex: 1,
        source: 'chapter' as const,
      },
      mismatch: {
        id: 'e2',
        type: 'plot-advance' as const,
        plotId: 'p-1',
        beatId: 'a1-b2',
        chapterIndex: 1,
        source: 'chapter' as const,
      },
    },
    {
      name: 'foreshadow-introduce',
      match: {
        id: 'e1',
        type: 'foreshadow-introduce' as const,
        foreshadowId: 'f-1',
        expectedFulfillChapter: 5,
        chapterIndex: 1,
        source: 'outline' as const,
      },
      mismatch: {
        id: 'e2',
        type: 'foreshadow-introduce' as const,
        foreshadowId: 'f-1',
        expectedFulfillChapter: 6,
        chapterIndex: 1,
        source: 'outline' as const,
      },
    },
    {
      name: 'foreshadow-fulfill',
      match: {
        id: 'e1',
        type: 'foreshadow-fulfill' as const,
        foreshadowId: 'f-1',
        chapterIndex: 1,
        source: 'chapter' as const,
      },
      mismatch: {
        id: 'e2',
        type: 'foreshadow-fulfill' as const,
        foreshadowId: 'f-2',
        chapterIndex: 1,
        source: 'chapter' as const,
      },
    },
    {
      name: 'task-create',
      match: {
        id: 'e1',
        type: 'task-create' as const,
        taskId: 't-1',
        description: 'find the key',
        chapterIndex: 1,
        source: 'chapter' as const,
      },
      mismatch: {
        id: 'e2',
        type: 'task-create' as const,
        taskId: 't-1',
        description: 'find the lock',
        chapterIndex: 1,
        source: 'chapter' as const,
      },
    },
    {
      name: 'task-resolve',
      match: {
        id: 'e1',
        type: 'task-resolve' as const,
        taskId: 't-1',
        chapterIndex: 1,
        source: 'chapter' as const,
      },
      mismatch: {
        id: 'e2',
        type: 'task-resolve' as const,
        taskId: 't-2',
        chapterIndex: 1,
        source: 'chapter' as const,
      },
    },
  ]

  for (const template of eventTemplates) {
    it(`matches identical ${template.name} events`, () => {
      const result = diffEvents([template.match], [template.match])
      expect(result.matched).toHaveLength(1)
      expect(result.missing).toHaveLength(0)
      expect(result.unexpected).toHaveLength(0)
    })

    it(`does not match different ${template.name} events`, () => {
      const result = diffEvents([template.match], [template.mismatch])
      expect(result.matched).toHaveLength(0)
      expect(result.missing).toHaveLength(1)
      expect(result.unexpected).toHaveLength(1)
    })
  }
})

describe('diffMemorySnapshots', () => {
  it('detects character location change between chapters', () => {
    const before = applyEvents(createEmptyStoryMemory(), [
      {
        id: 'e1',
        type: 'character-location',
        characterId: 'c-1',
        locationId: 'l-1',
        chapterIndex: 1,
        source: 'chapter',
      },
    ])
    const after = applyEvents(before, [
      {
        id: 'e2',
        type: 'character-location',
        characterId: 'c-1',
        locationId: 'l-2',
        chapterIndex: 2,
        source: 'chapter',
      },
    ])
    const diff = diffMemorySnapshots(before, after)
    expect(diff.characterLocations).toHaveLength(1)
    expect(diff.characterLocations[0]?.after).toBe('l-2')
  })
})

describe('diffMemorySnapshots — chapter index 0 transitions (falsy bug regression)', () => {
  it('reports foreshadows fulfilled at chapter index 0', () => {
    const before = applyEvents(createEmptyStoryMemory(), [
      {
        id: 'e1',
        type: 'foreshadow-introduce',
        foreshadowId: 'f-early',
        expectedFulfillChapter: 1,
        chapterIndex: 0,
        source: 'chapter',
      },
    ])
    const after = applyEvents(before, [
      {
        id: 'e2',
        type: 'foreshadow-fulfill',
        foreshadowId: 'f-early',
        chapterIndex: 0,
        source: 'chapter',
      },
    ])
    const diff = diffMemorySnapshots(before, after)
    expect(diff.fulfilledForeshadows).toContain('f-early')
  })

  it('reports tasks resolved at chapter index 0', () => {
    const before = applyEvents(createEmptyStoryMemory(), [
      {
        id: 'e1',
        type: 'task-create',
        taskId: 't-early',
        description: 'task',
        chapterIndex: 0,
        source: 'chapter',
      },
    ])
    const after = applyEvents(before, [
      {
        id: 'e2',
        type: 'task-resolve',
        taskId: 't-early',
        chapterIndex: 0,
        source: 'chapter',
      },
    ])
    const diff = diffMemorySnapshots(before, after)
    expect(diff.resolvedTasks).toContain('t-early')
  })
})
