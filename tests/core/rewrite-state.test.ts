import { describe, expect, it } from 'vitest'
import {
  cleanOutlineForRewrite,
  recomputeActProgressForRewrite,
} from '../../src/core/rewrite-state.js'
import type { ReducedGraphState } from '../../src/graph/state.js'
import type { StoryMemory } from '../../src/types/story-memory.js'

describe('recomputeActProgressForRewrite', () => {
  it('uses stable mandatory beat ids from story memory without relying on keyBeat text', () => {
    const storyMemory: StoryMemory = {
      version: '1',
      lastChapterIndex: 0,
      entities: { characters: {}, items: {}, locations: {}, factions: {}, plots: {} },
      events: [],
      foreshadows: {},
      beats: {
        'A1-M2': {
          id: 'A1-M2',
          description: '阵营洗牌',
          actIndex: 1,
          deadlineAct: 1,
          required: true,
          claimedIn: 0,
          provenByEventIds: ['evt-1'],
        },
      },
      tasks: {},
    }
    const state = {
      storyArc: {
        totalChapters: 3,
        acts: [
          {
            index: 1,
            startChapter: 1,
            endChapter: 3,
            title: 'Act',
            theme: '',
            function: '',
            mandatoryBeats: ['身份暴露', '阵营洗牌'],
          },
        ],
        keyBeats: [
          {
            id: 'A1-B1',
            beat: '全局关键节点',
            deadlineAct: 1,
            required: true,
          },
        ],
      },
      outline: [
        {
          number: 1,
          title: 'Chapter 1',
          description: 'Description 1',
          claimedBeats: ['阵营洗牌'],
          claimedMandatoryBeatIds: ['A1-M2'],
        },
        { number: 2, title: 'Chapter 2', description: 'Description 2' },
      ],
      storyMemory,
    } as unknown as ReducedGraphState

    const progress = recomputeActProgressForRewrite(state, 1)

    expect(progress[1]?.consumed).toContain('阵营洗牌')
    expect(progress[1]?.pending).not.toContain('阵营洗牌')
  })

  it('preserves existing completed past-act progress when legacy data lacks mandatory beat ids', () => {
    const state = {
      storyArc: {
        totalChapters: 5,
        acts: [
          {
            index: 1,
            startChapter: 1,
            endChapter: 2,
            title: 'Past',
            theme: '',
            function: '',
            mandatoryBeats: ['身份暴露', '阵营洗牌'],
          },
          {
            index: 2,
            startChapter: 3,
            endChapter: 5,
            title: 'Current',
            theme: '',
            function: '',
            mandatoryBeats: ['终局布局'],
          },
        ],
        keyBeats: [],
      },
      outline: [
        { number: 1, title: 'Chapter 1', description: 'Description 1' },
        { number: 2, title: 'Chapter 2', description: 'Description 2' },
        { number: 3, title: 'Chapter 3', description: 'Description 3' },
      ],
      storyMemory: null,
      actProgress: {
        1: { consumed: ['阵营洗牌'], pending: ['身份暴露'] },
      },
    } as unknown as ReducedGraphState

    const progress = recomputeActProgressForRewrite(state, 3)

    expect(progress[1]?.consumed).toContain('阵营洗牌')
    expect(progress[1]?.pending).not.toContain('阵营洗牌')
  })

  it('maps verified claimedBeatIds back to mandatory beat text when keyBeat text differs', () => {
    const storyMemory: StoryMemory = {
      version: '1',
      lastChapterIndex: 0,
      entities: { characters: {}, items: {}, locations: {}, factions: {}, plots: {} },
      events: [],
      foreshadows: {},
      beats: {
        'A1-B1': {
          id: 'A1-B1',
          description: '身份彻底暴露后的坠落',
          actIndex: 1,
          deadlineAct: 1,
          required: true,
          claimedIn: 0,
          provenByEventIds: ['evt-1'],
        },
      },
      tasks: {},
    }
    const state = {
      storyArc: {
        totalChapters: 3,
        acts: [
          {
            index: 1,
            startChapter: 1,
            endChapter: 3,
            title: 'Act',
            theme: '',
            function: '',
            mandatoryBeats: ['身份暴露', '敌友洗牌'],
          },
        ],
        keyBeats: [
          {
            id: 'A1-B1',
            beat: '身份彻底暴露后的坠落',
            deadlineAct: 1,
            required: true,
          },
        ],
      },
      outline: [
        {
          number: 1,
          title: 'Chapter 1',
          description: 'Description 1',
          claimedBeats: ['身份暴露'],
          claimedBeatIds: ['A1-B1'],
        },
        { number: 2, title: 'Chapter 2', description: 'Description 2' },
      ],
      storyMemory,
    } as unknown as ReducedGraphState

    const progress = recomputeActProgressForRewrite(state, 1)

    expect(progress[1]?.consumed).toContain('身份暴露')
    expect(progress[1]?.pending).not.toContain('身份暴露')
  })

  it('does not let legacy outline verifiedBeats consume unclaimed act beats during rewrite', () => {
    const state = {
      storyArc: {
        totalChapters: 7,
        acts: [
          {
            index: 1,
            startChapter: 1,
            endChapter: 7,
            title: 'Act',
            theme: '',
            function: '',
            mandatoryBeats: ['身份重构', '初次接触', '暴露危机'],
          },
        ],
        keyBeats: [],
      },
      outline: [
        {
          number: 1,
          title: 'Chapter 1',
          description: 'Description 1',
          claimedBeats: ['身份重构'],
          verifiedBeats: ['身份重构', '初次接触', '暴露危机'],
        },
        { number: 2, title: 'Chapter 2', description: 'Description 2' },
        { number: 3, title: 'Chapter 3', description: 'Description 3' },
        { number: 4, title: 'Chapter 4', description: 'Description 4' },
        { number: 5, title: 'Chapter 5', description: 'Description 5' },
        { number: 6, title: 'Chapter 6', description: 'Description 6' },
      ],
      storyMemory: null,
    } as unknown as ReducedGraphState

    const progress = recomputeActProgressForRewrite(state, 6)

    expect(progress[1]?.consumed).toEqual(['身份重构'])
    expect(progress[1]?.pending).toEqual(['初次接触', '暴露危机'])
  })
})

describe('cleanOutlineForRewrite', () => {
  it('prunes legacy verifiedBeats before the target chapter to beats claimed by that chapter', () => {
    const storyArc = {
      totalChapters: 3,
      acts: [
        {
          index: 1,
          startChapter: 1,
          endChapter: 3,
          title: 'Act',
          theme: '',
          function: '',
          mandatoryBeats: ['身份重构', '初次接触', '暴露危机'],
        },
      ],
      keyBeats: [],
    }
    const outline = [
      {
        number: 1,
        title: 'Chapter 1',
        description: 'Description 1',
        claimedBeats: ['身份重构'],
        verifiedBeats: ['身份重构', '初次接触', '暴露危机'],
        verifiedBeatEvidence: [
          {
            beat: '身份重构',
            chapterIndex: 0,
            quote: 'evidence',
            confidence: 'high' as const,
          },
          {
            beat: '初次接触',
            chapterIndex: 0,
            quote: 'evidence',
            confidence: 'medium' as const,
          },
        ],
      },
      {
        number: 2,
        title: 'Chapter 2',
        description: 'Description 2',
        verifiedBeats: ['暴露危机'],
      },
    ] as ReducedGraphState['outline']

    const cleaned = cleanOutlineForRewrite(outline, 1, storyArc)

    expect(cleaned[0]?.verifiedBeats).toEqual(['身份重构'])
    expect(cleaned[0]?.verifiedBeatEvidence).toEqual([
      {
        beat: '身份重构',
        chapterIndex: 0,
        quote: 'evidence',
        confidence: 'high',
      },
    ])
    expect(cleaned[1]?.verifiedBeats).toBeUndefined()
  })
})
