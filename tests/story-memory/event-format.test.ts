import { describe, expect, it } from 'vitest'
import {
  renderStoryEventLine,
  renderNullableId,
  renderEventValue,
} from '../../src/story-memory/event-format.js'
import type { StoryEvent } from '../../src/types/story-memory.js'

describe('event-format', () => {
  describe('renderNullableId', () => {
    it('renders "none" for null or undefined', () => {
      expect(renderNullableId(null)).toBe('none')
      expect(renderNullableId(undefined)).toBe('none')
    })

    it('renders the id as-is for strings', () => {
      expect(renderNullableId('loc-1')).toBe('loc-1')
    })
  })

  describe('renderEventValue', () => {
    it('renders "none" for null or undefined', () => {
      expect(renderEventValue(null)).toBe('none')
      expect(renderEventValue(undefined)).toBe('none')
    })

    it('renders strings as-is', () => {
      expect(renderEventValue('unsealed')).toBe('unsealed')
    })

    it('renders non-string primitives as JSON', () => {
      expect(renderEventValue(true)).toBe('true')
      expect(renderEventValue(42)).toBe('42')
    })
  })

  describe('renderStoryEventLine', () => {
    it('renders character-location', () => {
      const event: StoryEvent = {
        id: 'evt-1',
        type: 'character-location',
        characterId: 'c-1',
        locationId: 'loc-1',
        chapterIndex: 0,
        source: 'chapter',
      }
      expect(renderStoryEventLine(event)).toBe('character-location: c-1 -> loc-1')
    })

    it('renders item-location with holder and location', () => {
      const event: StoryEvent = {
        id: 'evt-1',
        type: 'item-location',
        itemId: 'item-1',
        holderId: 'c-1',
        locationId: 'loc-1',
        chapterIndex: 0,
        source: 'chapter',
      }
      expect(renderStoryEventLine(event)).toBe(
        'item-location: item-1 / holder=c-1 / location=loc-1'
      )
    })

    it('renders item-location with null holder and location', () => {
      const event: StoryEvent = {
        id: 'evt-1',
        type: 'item-location',
        itemId: 'item-1',
        holderId: null,
        locationId: null,
        chapterIndex: 0,
        source: 'chapter',
      }
      expect(renderStoryEventLine(event)).toBe(
        'item-location: item-1 / holder=none / location=none'
      )
    })

    it('renders foreshadow-introduce with all fields', () => {
      const event: StoryEvent = {
        id: 'evt-1',
        type: 'foreshadow-introduce',
        foreshadowId: 'fs-1',
        expectedFulfillChapter: 5,
        resolutionPolicy: 'must_resolve',
        kind: 'plot',
        required: true,
        beatId: 'beat-1',
        text: 'a hint',
        resolutionQuestion: 'what remains unexplained?',
        fulfillmentCriteria: 'reveal the cause through an observable event',
        chapterIndex: 0,
        source: 'chapter',
      }
      expect(renderStoryEventLine(event)).toBe(
        'foreshadow-introduce: fs-1 / expected=5 / policy=must_resolve / kind=plot / required=true / beat=beat-1 / text=a hint / question=what remains unexplained? / criteria=reveal the cause through an observable event'
      )
    })

    it('renders foreshadow-introduce with null expected and beat', () => {
      const event: StoryEvent = {
        id: 'evt-1',
        type: 'foreshadow-introduce',
        foreshadowId: 'fs-1',
        expectedFulfillChapter: null,
        resolutionPolicy: 'should_resolve',
        required: true,
        beatId: null,
        chapterIndex: 0,
        source: 'chapter',
      }
      expect(renderStoryEventLine(event)).toBe(
        'foreshadow-introduce: fs-1 / expected=none / policy=should_resolve / required=true / beat=none'
      )
    })

    it('renders foreshadow-policy-set', () => {
      const event: StoryEvent = {
        id: 'evt-policy-set',
        type: 'foreshadow-policy-set',
        foreshadowId: 'fs-1',
        resolutionPolicy: 'may_remain_open',
        expectedFulfillChapter: null,
        chapterIndex: 3,
        source: 'outline',
      }

      expect(renderStoryEventLine(event)).toBe(
        'foreshadow-policy-set: fs-1 / policy=may_remain_open / expected=none'
      )
    })

    it('renders foreshadow-merge with explicit audit fields and a quoted reason', () => {
      const event: StoryEvent = {
        id: 'evt-merge-1',
        type: 'foreshadow-merge',
        canonicalForeshadowId: 'fs-early',
        duplicateForeshadowId: 'fs-late',
        reason: 'Same clue / same obligation',
        chapterIndex: 4,
        source: 'outline',
      }

      expect(renderStoryEventLine(event)).toBe(
        'foreshadow-merge: canonical=fs-early / duplicate=fs-late / reason="Same clue / same obligation"'
      )
    })
  })
})
