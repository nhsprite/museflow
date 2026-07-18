import { describe, expect, it } from 'vitest'
import type { ReducedGraphState } from '../../src/graph/state.js'
import {
  collectStoryEventAuthority,
  validatePlannedStoryEventAuthority,
} from '../../src/story-memory/event-authority.js'
import { createEmptyStoryMemory } from '../../src/story-memory/projector.js'
import type { StoryEvent } from '../../src/types/story-memory.js'

function state(overrides: Partial<ReducedGraphState> = {}): ReducedGraphState {
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
      storyTime: '',
    },
    ...overrides,
  } as ReducedGraphState
}

function characterLocation(characterId: string, locationId: string): StoryEvent {
  return {
    id: 'evt-location',
    type: 'character-location',
    characterId,
    locationId,
    chapterIndex: 45,
    source: 'chapter',
  }
}

describe('planned story event authority', () => {
  it('accepts a short location ID established by structured state', () => {
    const input = state({
      characters: [
        {
          id: 'character-main',
          storyId: 'story-1',
          name: 'Character',
          aliases: [],
          isProtagonist: true,
          description: null,
          dialogueStyle: null,
          createdAt: 1,
        },
      ],
      storyState: {
        ...state().storyState,
        characterLocations: { 'character-main': 'l-1' },
      },
    })

    expect(
      validatePlannedStoryEventAuthority(input, [characterLocation('character-main', 'l-1')])
    ).toEqual([])
  })

  it('rejects an unknown location before drafting', () => {
    const input = state({
      characters: [
        {
          id: 'character-main',
          storyId: 'story-1',
          name: 'Character',
          aliases: [],
          isProtagonist: true,
          description: null,
          dialogueStyle: null,
          createdAt: 1,
        },
      ],
    })

    expect(
      validatePlannedStoryEventAuthority(input, [
        characterLocation('character-main', 'location-unknown'),
      ])
    ).toEqual([
      {
        index: 0,
        eventType: 'character-location',
        field: 'locationId',
        id: 'location-unknown',
      },
    ])
  })

  it('collects IDs only from structured fields', () => {
    const memory = createEmptyStoryMemory()
    memory.entities.characters['character-memory'] = {
      id: 'character-memory',
      name: 'Display Name',
      locationId: 'l-2',
      status: {},
      introducedIn: 0,
    }

    const authority = collectStoryEventAuthority(
      state({
        storyMemory: memory,
        storyState: {
          ...state().storyState,
          currentScene: 'location-prose-must-not-be-authority',
        },
      })
    )

    expect(authority.characterIds).toContain('character-memory')
    expect(authority.locationIds).toContain('l-2')
    expect(authority.locationIds).not.toContain('location-prose-must-not-be-authority')
  })

  it('allows creation events to introduce new IDs', () => {
    const events: StoryEvent[] = [
      {
        id: 'evt-introduce',
        type: 'foreshadow-introduce',
        foreshadowId: 'foreshadow-new',
        expectedFulfillChapter: null,
        resolutionPolicy: 'should_resolve',
        required: true,
        kind: 'other',
        beatId: null,
        chapterIndex: 45,
        source: 'chapter',
      },
      {
        id: 'evt-task',
        type: 'task-create',
        taskId: 'task-new',
        description: 'Structured task',
        chapterIndex: 45,
        source: 'chapter',
      },
    ]

    expect(validatePlannedStoryEventAuthority(state(), events)).toEqual([])
  })

  it('collects typed IDs from every structured authority source', () => {
    const memory = createEmptyStoryMemory()
    memory.entities.items['item-memory'] = {
      id: 'item-memory',
      name: 'Item',
      holderId: null,
      locationId: 'location-item-memory',
      state: {},
      introducedIn: 1,
    }
    memory.entities.locations['location-memory'] = {
      id: 'location-memory',
      name: 'Location',
      introducedIn: 1,
    }
    memory.entities.plots['plot-memory'] = {
      id: 'plot-memory',
      name: 'Plot',
      introducedIn: 1,
    }
    memory.beats['beat-memory'] = {
      id: 'beat-memory',
      description: 'Beat',
      actIndex: 1,
      deadlineAct: 1,
      required: true,
      claimedIn: null,
      provenByEventIds: [],
    }
    memory.foreshadows['foreshadow-memory'] = {
      id: 'foreshadow-memory',
      text: 'Foreshadow',
      kind: null,
      introducedIn: 1,
      expectedFulfillChapter: null,
      fulfilledIn: null,
      resolutionPolicy: 'should_resolve',
      required: true,
      beatId: null,
    }
    memory.tasks['task-memory'] = {
      id: 'task-memory',
      description: 'Task',
      createdIn: 1,
      resolvedIn: null,
    }
    memory.events = [
      characterLocation('character-event', 'location-event'),
      {
        id: 'evt-item',
        type: 'item-location',
        itemId: 'item-event',
        holderId: null,
        locationId: 'location-item-event',
        chapterIndex: 1,
        source: 'chapter',
      },
      {
        id: 'evt-plot',
        type: 'plot-advance',
        plotId: 'plot-event',
        beatId: 'beat-event',
        chapterIndex: 1,
        source: 'chapter',
      },
    ]

    const authority = collectStoryEventAuthority(
      state({
        storyArc: {
          totalChapters: 10,
          acts: [
            {
              index: 1,
              startChapter: 1,
              endChapter: 10,
              title: 'Act',
              theme: 'Theme',
              function: 'Function',
              mandatoryBeats: ['Mandatory'],
            },
          ],
          keyBeats: [
            {
              id: 'beat-key',
              beat: 'Key',
              deadlineAct: 1,
              required: true,
            },
          ],
        },
        storyMemory: memory,
        foreshadowStack: [
          {
            id: 'foreshadow-stack',
            text: 'Foreshadow',
            expectedFulfillChapter: 10,
            createdAt: 1,
            createdAtChapter: 1,
            status: 'planted',
            isExplicit: false,
            required: true,
          },
        ],
        storyState: {
          ...state().storyState,
          characterLocations: { 'character-state-location': 'location-state-character' },
          characterStatus: { 'character-state-status': 'active' },
          keyItemsLocation: { 'item-state-location': 'location-state-item' },
          keyItemsState: { 'item-state-status': 'active' },
          pendingTasks: [
            {
              id: 'task-state',
              assignee: 'character-state-location',
              description: 'Task',
              createdChapter: 1,
              status: 'pending',
            },
          ],
        },
      })
    )

    expect([...authority.characterIds]).toEqual(
      expect.arrayContaining([
        'character-state-location',
        'character-state-status',
        'character-event',
      ])
    )
    expect([...authority.itemIds]).toEqual(
      expect.arrayContaining([
        'item-state-location',
        'item-state-status',
        'item-memory',
        'item-event',
      ])
    )
    expect([...authority.locationIds]).toEqual(
      expect.arrayContaining([
        'location-state-character',
        'location-state-item',
        'location-item-memory',
        'location-memory',
        'location-event',
        'location-item-event',
      ])
    )
    expect([...authority.plotIds]).toEqual(
      expect.arrayContaining(['plot-memory', 'plot-event', 'act-1'])
    )
    expect([...authority.beatIds]).toEqual(
      expect.arrayContaining(['beat-memory', 'beat-event', 'A1-M1', 'beat-key'])
    )
    expect([...authority.foreshadowIds]).toEqual(
      expect.arrayContaining(['foreshadow-memory', 'foreshadow-stack'])
    )
    expect([...authority.taskIds]).toEqual(expect.arrayContaining(['task-memory', 'task-state']))
  })

  it('rejects every unknown reference on non-creation events', () => {
    const events: StoryEvent[] = [
      characterLocation('character-unknown', 'location-unknown'),
      {
        id: 'evt-character-status',
        type: 'character-status',
        characterId: 'character-status-unknown',
        attribute: 'state',
        value: 'active',
        chapterIndex: 45,
        source: 'chapter',
      },
      {
        id: 'evt-item-location',
        type: 'item-location',
        itemId: 'item-unknown',
        holderId: 'holder-unknown',
        locationId: 'item-location-unknown',
        chapterIndex: 45,
        source: 'chapter',
      },
      {
        id: 'evt-item-state',
        type: 'item-state',
        itemId: 'item-state-unknown',
        attribute: 'state',
        value: 'active',
        chapterIndex: 45,
        source: 'chapter',
      },
      {
        id: 'evt-plot',
        type: 'plot-advance',
        plotId: 'plot-unknown',
        beatId: 'beat-unknown',
        chapterIndex: 45,
        source: 'chapter',
      },
      {
        id: 'evt-fulfill',
        type: 'foreshadow-fulfill',
        foreshadowId: 'foreshadow-fulfill-unknown',
        chapterIndex: 45,
        source: 'chapter',
      },
      {
        id: 'evt-deadline',
        type: 'foreshadow-deadline-extend',
        foreshadowId: 'foreshadow-deadline-unknown',
        newExpectedFulfillChapter: 50,
        chapterIndex: 45,
        source: 'chapter',
      },
      {
        id: 'evt-policy',
        type: 'foreshadow-policy-set',
        foreshadowId: 'foreshadow-policy-unknown',
        resolutionPolicy: 'should_resolve',
        expectedFulfillChapter: null,
        chapterIndex: 45,
        source: 'chapter',
      },
      {
        id: 'evt-waive',
        type: 'foreshadow-waive',
        foreshadowId: 'foreshadow-waive-unknown',
        chapterIndex: 45,
        source: 'chapter',
      },
      {
        id: 'evt-merge',
        type: 'foreshadow-merge',
        canonicalForeshadowId: 'foreshadow-canonical-unknown',
        duplicateForeshadowId: 'foreshadow-duplicate-unknown',
        reason: 'Structured reason',
        chapterIndex: 45,
        source: 'outline',
      },
      {
        id: 'evt-resolve',
        type: 'task-resolve',
        taskId: 'task-unknown',
        chapterIndex: 45,
        source: 'chapter',
      },
    ]

    expect(validatePlannedStoryEventAuthority(state(), events)).toEqual([
      {
        index: 0,
        eventType: 'character-location',
        field: 'characterId',
        id: 'character-unknown',
      },
      {
        index: 0,
        eventType: 'character-location',
        field: 'locationId',
        id: 'location-unknown',
      },
      {
        index: 1,
        eventType: 'character-status',
        field: 'characterId',
        id: 'character-status-unknown',
      },
      {
        index: 2,
        eventType: 'item-location',
        field: 'itemId',
        id: 'item-unknown',
      },
      {
        index: 2,
        eventType: 'item-location',
        field: 'holderId',
        id: 'holder-unknown',
      },
      {
        index: 2,
        eventType: 'item-location',
        field: 'locationId',
        id: 'item-location-unknown',
      },
      {
        index: 3,
        eventType: 'item-state',
        field: 'itemId',
        id: 'item-state-unknown',
      },
      {
        index: 4,
        eventType: 'plot-advance',
        field: 'plotId',
        id: 'plot-unknown',
      },
      {
        index: 4,
        eventType: 'plot-advance',
        field: 'beatId',
        id: 'beat-unknown',
      },
      {
        index: 5,
        eventType: 'foreshadow-fulfill',
        field: 'foreshadowId',
        id: 'foreshadow-fulfill-unknown',
      },
      {
        index: 6,
        eventType: 'foreshadow-deadline-extend',
        field: 'foreshadowId',
        id: 'foreshadow-deadline-unknown',
      },
      {
        index: 7,
        eventType: 'foreshadow-policy-set',
        field: 'foreshadowId',
        id: 'foreshadow-policy-unknown',
      },
      {
        index: 8,
        eventType: 'foreshadow-waive',
        field: 'foreshadowId',
        id: 'foreshadow-waive-unknown',
      },
      {
        index: 9,
        eventType: 'foreshadow-merge',
        field: 'canonicalForeshadowId',
        id: 'foreshadow-canonical-unknown',
      },
      {
        index: 9,
        eventType: 'foreshadow-merge',
        field: 'duplicateForeshadowId',
        id: 'foreshadow-duplicate-unknown',
      },
      {
        index: 10,
        eventType: 'task-resolve',
        field: 'taskId',
        id: 'task-unknown',
      },
    ])
  })

  it('accepts nullable and known holder references while checking introduction beats', () => {
    const memory = createEmptyStoryMemory()
    memory.entities.characters['character-holder'] = {
      id: 'character-holder',
      name: 'Holder',
      locationId: null,
      status: {},
      introducedIn: 1,
    }
    memory.entities.items['item-known'] = {
      id: 'item-known',
      name: 'Item',
      holderId: null,
      locationId: null,
      state: {},
      introducedIn: 1,
    }
    memory.beats['beat-known'] = {
      id: 'beat-known',
      description: 'Beat',
      actIndex: 1,
      deadlineAct: 1,
      required: true,
      claimedIn: null,
      provenByEventIds: [],
    }

    const events: StoryEvent[] = [
      {
        id: 'evt-nullable',
        type: 'item-location',
        itemId: 'item-known',
        holderId: null,
        locationId: null,
        chapterIndex: 45,
        source: 'chapter',
      },
      {
        id: 'evt-holder',
        type: 'item-location',
        itemId: 'item-known',
        holderId: 'character-holder',
        locationId: 'character-holder',
        chapterIndex: 45,
        source: 'chapter',
      },
      {
        id: 'evt-known-beat',
        type: 'foreshadow-introduce',
        foreshadowId: 'foreshadow-new-known-beat',
        expectedFulfillChapter: null,
        beatId: 'beat-known',
        chapterIndex: 45,
        source: 'chapter',
      },
      {
        id: 'evt-unknown-beat',
        type: 'foreshadow-introduce',
        foreshadowId: 'foreshadow-new-unknown-beat',
        expectedFulfillChapter: null,
        beatId: 'beat-unknown',
        chapterIndex: 45,
        source: 'chapter',
      },
    ]

    expect(validatePlannedStoryEventAuthority(state({ storyMemory: memory }), events)).toEqual([
      {
        index: 3,
        eventType: 'foreshadow-introduce',
        field: 'beatId',
        id: 'beat-unknown',
      },
    ])
  })

  it('accepts the canonical main plot for the first global key-beat event', () => {
    const input = state({
      storyArc: {
        totalChapters: 10,
        acts: [
          {
            index: 1,
            startChapter: 1,
            endChapter: 10,
            title: 'Act',
            theme: 'Theme',
            function: 'Function',
            mandatoryBeats: [],
          },
        ],
        keyBeats: [
          {
            id: 'beat-global',
            beat: 'Global beat',
            deadlineAct: 1,
            required: true,
          },
        ],
      },
    })

    expect(
      validatePlannedStoryEventAuthority(input, [
        {
          id: 'evt-global-beat',
          type: 'plot-advance',
          plotId: 'plot-main',
          beatId: 'beat-global',
          chapterIndex: 1,
          source: 'outline',
        },
      ])
    ).toEqual([])
  })

  it.each([
    {
      reference: 'known character',
      holderId: 'character-holder',
      locationId: 'character-holder',
    },
    {
      reference: 'known item',
      holderId: 'item-container',
      locationId: 'item-container',
    },
    {
      reference: 'known location',
      holderId: null,
      locationId: 'location-known',
    },
    {
      reference: 'nullable fields',
      holderId: null,
      locationId: null,
    },
  ])('accepts item-location $reference references', ({ holderId, locationId }) => {
    const memory = createEmptyStoryMemory()
    memory.entities.characters['character-holder'] = {
      id: 'character-holder',
      name: 'Holder',
      locationId: null,
      status: {},
      introducedIn: 1,
    }
    memory.entities.items['item-known'] = {
      id: 'item-known',
      name: 'Item',
      holderId: null,
      locationId: null,
      state: {},
      introducedIn: 1,
    }
    memory.entities.items['item-container'] = {
      id: 'item-container',
      name: 'Container',
      holderId: null,
      locationId: null,
      state: {},
      introducedIn: 1,
    }
    memory.entities.locations['location-known'] = {
      id: 'location-known',
      name: 'Location',
      introducedIn: 1,
    }

    expect(
      validatePlannedStoryEventAuthority(state({ storyMemory: memory }), [
        {
          id: 'evt-item-location',
          type: 'item-location',
          itemId: 'item-known',
          holderId,
          locationId,
          chapterIndex: 1,
          source: 'outline',
        },
      ])
    ).toEqual([])
  })

  it('validates item-location authority when story memory is null', () => {
    const input = state({
      characters: [
        {
          id: 'character-holder',
          storyId: 'story-1',
          name: 'Character',
          aliases: [],
          isProtagonist: true,
          description: null,
          dialogueStyle: null,
          createdAt: 1,
        },
      ],
      storyMemory: null,
      storyState: {
        ...state().storyState,
        characterLocations: { 'character-holder': 'location-known' },
        keyItemsState: { 'item-known': 'active' },
      },
    })

    expect(
      validatePlannedStoryEventAuthority(input, [
        {
          id: 'evt-item-location',
          type: 'item-location',
          itemId: 'item-known',
          holderId: 'character-holder',
          locationId: 'location-known',
          chapterIndex: 1,
          source: 'outline',
        },
      ])
    ).toEqual([])
  })
})
