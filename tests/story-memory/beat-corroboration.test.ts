import { describe, expect, it } from 'vitest'
import {
  auditChapterBeatCorroboration,
  evaluateChapterBeatCorroborations,
  isConsumedMandatoryBeat,
  mergeBeatCorroborationIntoMemory,
} from '../../src/story-memory/beat-corroboration.js'
import { applyEvents, createEmptyStoryMemory } from '../../src/story-memory/projector.js'
import type {
  BeatMemory,
  ChapterFinalStateDeclaration,
  ForeshadowMemory,
  StoryEvent,
  StoryMemory,
} from '../../src/types/story-memory.js'
import type { StoryArc } from '../../src/types/outline.js'

/**
 * D.2.1/D.2.3 mandatory beat 消费佐证的单元测试：
 * 绑定规则（共享锚点 / 共享主体 / 受佐证终态声明）、审计记录合并、
 * 幕进度消费判定（含 grandfathering）。
 */

function plotAdvance(
  id: string,
  beatId: string,
  paragraphIndex?: number,
  plotId = 'plot-1'
): StoryEvent {
  return {
    id,
    type: 'plot-advance',
    plotId,
    beatId,
    chapterIndex: 0,
    source: 'chapter',
    ...(paragraphIndex !== undefined ? { evidence: { paragraphIndex } } : {}),
  }
}

function statusEvent(id: string, characterId: string, paragraphIndex?: number): StoryEvent {
  return {
    id,
    type: 'character-status',
    characterId,
    attribute: 'health',
    value: '重伤',
    chapterIndex: 0,
    source: 'chapter',
    ...(paragraphIndex !== undefined ? { evidence: { paragraphIndex } } : {}),
  }
}

function locationEvent(id: string, characterId: string, paragraphIndex?: number): StoryEvent {
  return {
    id,
    type: 'character-location',
    characterId,
    locationId: 'loc-1',
    chapterIndex: 0,
    source: 'chapter',
    ...(paragraphIndex !== undefined ? { evidence: { paragraphIndex } } : {}),
  }
}

function foreshadowFulfill(id: string, foreshadowId: string, paragraphIndex?: number): StoryEvent {
  return {
    id,
    type: 'foreshadow-fulfill',
    foreshadowId,
    chapterIndex: 0,
    source: 'chapter',
    ...(paragraphIndex !== undefined ? { evidence: { paragraphIndex } } : {}),
  }
}

function taskResolve(id: string, taskId: string, paragraphIndex?: number): StoryEvent {
  return {
    id,
    type: 'task-resolve',
    taskId,
    chapterIndex: 0,
    source: 'chapter',
    ...(paragraphIndex !== undefined ? { evidence: { paragraphIndex } } : {}),
  }
}

function makeForeshadow(beatId: string | null): ForeshadowMemory {
  return {
    id: 'fs-1',
    text: '伏笔',
    introducedIn: 0,
    expectedFulfillChapter: null,
    fulfilledIn: null,
    resolutionPolicy: 'must_resolve',
    required: true,
    beatId,
  }
}

function evaluate(
  chapterEvents: StoryEvent[],
  overrides: {
    finalStateDeclarations?: ChapterFinalStateDeclaration[]
    foreshadows?: Record<string, ForeshadowMemory>
    beatIds?: ReadonlySet<string>
  } = {}
) {
  return evaluateChapterBeatCorroborations({
    chapterEvents,
    finalStateDeclarations: overrides.finalStateDeclarations ?? [],
    foreshadows: overrides.foreshadows ?? {},
    ...(overrides.beatIds ? { beatIds: overrides.beatIds } : {}),
  })
}

describe('evaluateChapterBeatCorroborations 绑定规则', () => {
  it('共享证据锚点的状态类事件构成佐证', () => {
    const [evaluation] = evaluate([
      plotAdvance('evt-p1', 'A1-M1', 5),
      statusEvent('evt-s1', 'char-1', 5),
    ])
    expect(evaluation).toMatchObject({
      beatId: 'A1-M1',
      provingEventIds: ['evt-p1'],
      corroboratingEventIds: ['evt-s1'],
      corroboratedByFinalState: false,
      corroborated: true,
    })
  })

  it('锚点不同的状态类事件不构成佐证', () => {
    const [evaluation] = evaluate([
      plotAdvance('evt-p1', 'A1-M1', 5),
      statusEvent('evt-s1', 'char-1', 7),
    ])
    expect(evaluation?.corroborated).toBe(false)
    expect(evaluation?.corroboratingEventIds).toEqual([])
  })

  it('推进事件缺证据锚点时锚点绑定不成立', () => {
    const [evaluation] = evaluate([
      plotAdvance('evt-p1', 'A1-M1'),
      statusEvent('evt-s1', 'char-1', 5),
    ])
    expect(evaluation?.corroborated).toBe(false)
  })

  it('共享主体实体（角色实体与 plot 实体同 id）构成佐证', () => {
    const [evaluation] = evaluate([
      plotAdvance('evt-p1', 'A1-M1', 5, 'char-9'),
      statusEvent('evt-s1', 'char-9', 7),
    ])
    expect(evaluation?.corroborated).toBe(true)
    expect(evaluation?.corroboratingEventIds).toEqual(['evt-s1'])
  })

  it('伏笔回收事件按注册表 beatId 归属绑定', () => {
    const [evaluation] = evaluate(
      [plotAdvance('evt-p1', 'A1-M1', 5), foreshadowFulfill('evt-f1', 'fs-1', 9)],
      { foreshadows: { 'fs-1': makeForeshadow('A1-M1') } }
    )
    expect(evaluation?.corroborated).toBe(true)
    expect(evaluation?.corroboratingEventIds).toEqual(['evt-f1'])
  })

  it('伏笔归属其他 beat 且锚点不同则不构成佐证', () => {
    const [evaluation] = evaluate(
      [plotAdvance('evt-p1', 'A1-M1', 5), foreshadowFulfill('evt-f1', 'fs-1', 9)],
      { foreshadows: { 'fs-1': makeForeshadow('A1-M2') } }
    )
    expect(evaluation?.corroborated).toBe(false)
  })

  it('多个推进事件时任一绑定即佐证', () => {
    const [evaluation] = evaluate([
      plotAdvance('evt-p1', 'A1-M1', 5),
      plotAdvance('evt-p2', 'A1-M1', 8),
      locationEvent('evt-l1', 'char-1', 8),
    ])
    expect(evaluation?.corroborated).toBe(true)
    expect(evaluation?.provingEventIds).toEqual(['evt-p1', 'evt-p2'])
  })

  it('任务事件共享锚点可佐证；非状态类事件不参与佐证', () => {
    const [withTask] = evaluate([
      plotAdvance('evt-p1', 'A1-M1', 5),
      taskResolve('evt-t1', 'task-1', 5),
    ])
    expect(withTask?.corroborated).toBe(true)

    // plot-advance 不是状态类事件：另一个 beat 的推进事件不能佐证本 beat
    const [otherBeatOnly] = evaluate([
      plotAdvance('evt-p1', 'A1-M1', 5),
      plotAdvance('evt-p2', 'A1-M2', 5),
    ])
    expect(otherBeatOnly?.corroborated).toBe(false)
  })

  it('beatIds 过滤：集合外的 beat 不评估；无推进事件的 beat 不输出', () => {
    const evaluations = evaluate(
      [plotAdvance('evt-p1', 'A1-M1', 5), plotAdvance('evt-p2', 'A1-B1', 5)],
      { beatIds: new Set(['A1-M1']) }
    )
    expect(evaluations.map((evaluation) => evaluation.beatId)).toEqual(['A1-M1'])
  })
})

describe('evaluateChapterBeatCorroborations 终态声明佐证', () => {
  const declaration: ChapterFinalStateDeclaration = {
    entityId: 'char-1',
    attribute: 'status',
    value: '重伤',
  }

  it('受事件流佐证且支撑事件与推进事件绑定的终态声明构成佐证', () => {
    const [evaluation] = evaluate(
      [plotAdvance('evt-p1', 'A1-M1', 5), statusEvent('evt-s1', 'char-1', 5)],
      { finalStateDeclarations: [declaration] }
    )
    expect(evaluation?.corroboratedByFinalState).toBe(true)
    expect(evaluation?.corroborated).toBe(true)
  })

  it('声明主体即 plot 实体时直接绑定', () => {
    const [evaluation] = evaluate(
      [plotAdvance('evt-p1', 'A1-M1', 5, 'char-1'), statusEvent('evt-s1', 'char-1', 9)],
      { finalStateDeclarations: [declaration] }
    )
    expect(evaluation?.corroboratedByFinalState).toBe(true)
  })

  it('未被事件流支撑的声明不构成佐证', () => {
    const [evaluation] = evaluate([plotAdvance('evt-p1', 'A1-M1', 5)], {
      finalStateDeclarations: [declaration],
    })
    expect(evaluation?.corroboratedByFinalState).toBe(false)
    expect(evaluation?.corroborated).toBe(false)
  })

  it('支撑事件末值与声明值不符时不构成佐证', () => {
    const [evaluation] = evaluate(
      [plotAdvance('evt-p1', 'A1-M1', 5), statusEvent('evt-s1', 'char-1', 5)],
      {
        finalStateDeclarations: [{ entityId: 'char-1', attribute: 'status', value: '痊愈' }],
      }
    )
    expect(evaluation?.corroboratedByFinalState).toBe(false)
  })

  it('受佐证声明与 beat 无绑定（锚点/主体均不同）时不构成佐证', () => {
    // 支撑事件锚点 9 ≠ 推进事件锚点 5，声明主体 char-1 ≠ plotId plot-1
    const [evaluation] = evaluate(
      [plotAdvance('evt-p1', 'A1-M1', 5), statusEvent('evt-s1', 'char-1', 9)],
      { finalStateDeclarations: [declaration] }
    )
    expect(evaluation?.corroboratedByFinalState).toBe(false)
    expect(evaluation?.corroborated).toBe(false)
  })
})

describe('mergeBeatCorroborationIntoMemory', () => {
  function makeBeat(corroboration?: BeatMemory['corroboration']): BeatMemory {
    return {
      id: 'A1-M1',
      description: '节拍',
      actIndex: 1,
      deadlineAct: 1,
      required: true,
      claimedIn: 0,
      provenByEventIds: ['evt-p1'],
      ...(corroboration ? { corroboration } : {}),
    }
  }

  function memoryWithBeat(beat: BeatMemory): StoryMemory {
    const memory = createEmptyStoryMemory()
    return { ...memory, beats: { 'A1-M1': beat } }
  }

  it('未佐证评估写入 proven_uncorroborated 审计记录', () => {
    const memory = mergeBeatCorroborationIntoMemory(memoryWithBeat(makeBeat()), [
      {
        beatId: 'A1-M1',
        provingEventIds: ['evt-p1'],
        corroboratingEventIds: [],
        corroboratedByFinalState: false,
        corroborated: false,
      },
    ])
    expect(memory.beats['A1-M1']?.corroboration).toEqual({
      status: 'proven_uncorroborated',
      corroboratingEventIds: [],
      corroboratedByFinalState: false,
    })
  })

  it('佐证评估写入 consumed 并记录佐证事件', () => {
    const memory = mergeBeatCorroborationIntoMemory(memoryWithBeat(makeBeat()), [
      {
        beatId: 'A1-M1',
        provingEventIds: ['evt-p1'],
        corroboratingEventIds: ['evt-s1'],
        corroboratedByFinalState: false,
        corroborated: true,
      },
    ])
    expect(memory.beats['A1-M1']?.corroboration?.status).toBe('consumed')
    expect(memory.beats['A1-M1']?.corroboration?.corroboratingEventIds).toEqual(['evt-s1'])
  })

  it('proven_uncorroborated 在后续章节获得佐证后升级为 consumed', () => {
    const initial = memoryWithBeat(
      makeBeat({
        status: 'proven_uncorroborated',
        corroboratingEventIds: [],
        corroboratedByFinalState: false,
      })
    )
    const memory = mergeBeatCorroborationIntoMemory(initial, [
      {
        beatId: 'A1-M1',
        provingEventIds: ['evt-p2'],
        corroboratingEventIds: ['evt-s2'],
        corroboratedByFinalState: true,
        corroborated: true,
      },
    ])
    expect(memory.beats['A1-M1']?.corroboration).toEqual({
      status: 'consumed',
      corroboratingEventIds: ['evt-s2'],
      corroboratedByFinalState: true,
    })
  })

  it('已 consumed 的记录不因后续未佐证评估回退', () => {
    const initial = memoryWithBeat(
      makeBeat({
        status: 'consumed',
        corroboratingEventIds: ['evt-s1'],
        corroboratedByFinalState: false,
      })
    )
    const memory = mergeBeatCorroborationIntoMemory(initial, [
      {
        beatId: 'A1-M1',
        provingEventIds: ['evt-p2'],
        corroboratingEventIds: [],
        corroboratedByFinalState: false,
        corroborated: false,
      },
    ])
    expect(memory.beats['A1-M1']?.corroboration?.status).toBe('consumed')
    expect(memory.beats['A1-M1']?.corroboration?.corroboratingEventIds).toEqual(['evt-s1'])
  })

  it('memory 中不存在的 beat 跳过；空评估列表原样返回', () => {
    const memory = memoryWithBeat(makeBeat())
    expect(mergeBeatCorroborationIntoMemory(memory, [])).toBe(memory)
    const skipped = mergeBeatCorroborationIntoMemory(memory, [
      {
        beatId: 'A9-M9',
        provingEventIds: ['evt-x'],
        corroboratingEventIds: [],
        corroboratedByFinalState: false,
        corroborated: false,
      },
    ])
    expect(skipped.beats['A9-M9']).toBeUndefined()
  })
})

describe('isConsumedMandatoryBeat 消费判定（含 grandfathering）', () => {
  const base: BeatMemory = {
    id: 'A1-M1',
    description: '节拍',
    actIndex: 1,
    deadlineAct: 1,
    required: true,
    claimedIn: 0,
    provenByEventIds: ['evt-p1'],
  }

  it('beat 不存在或未证明时不消费', () => {
    expect(isConsumedMandatoryBeat(undefined)).toBe(false)
    expect(isConsumedMandatoryBeat({ ...base, provenByEventIds: [] })).toBe(false)
  })

  it('已证明但无审计记录的旧数据 grandfathered 为 consumed', () => {
    expect(isConsumedMandatoryBeat(base)).toBe(true)
  })

  it('审计通过为 consumed；未佐证保持未消费', () => {
    expect(
      isConsumedMandatoryBeat({
        ...base,
        corroboration: {
          status: 'consumed',
          corroboratingEventIds: ['evt-s1'],
          corroboratedByFinalState: false,
        },
      })
    ).toBe(true)
    expect(
      isConsumedMandatoryBeat({
        ...base,
        corroboration: {
          status: 'proven_uncorroborated',
          corroboratingEventIds: [],
          corroboratedByFinalState: false,
        },
      })
    ).toBe(false)
  })
})

describe('auditChapterBeatCorroboration 定稿审计', () => {
  const storyArc: StoryArc = {
    totalChapters: 3,
    acts: [
      {
        index: 1,
        startChapter: 1,
        endChapter: 3,
        title: 'Act 1',
        theme: '',
        function: '',
        mandatoryBeats: ['节拍一'],
      },
    ],
    keyBeats: [{ id: 'A1-B1', beat: '关键节拍', deadlineAct: 1, required: true }],
  }

  it('只审计 mandatory beat，key beat 维持单段验证标准', () => {
    const memory = applyEvents(createEmptyStoryMemory(), [
      plotAdvance('evt-p1', 'A1-M1', 5),
      plotAdvance('evt-p2', 'A1-B1', 6),
    ])
    const audited = auditChapterBeatCorroboration(memory, storyArc, 0, [])
    expect(audited.beats['A1-M1']?.corroboration?.status).toBe('proven_uncorroborated')
    expect(audited.beats['A1-B1']?.corroboration).toBeUndefined()
  })

  it('本章无 mandatory 推进事件时 memory 原样返回', () => {
    const memory = applyEvents(createEmptyStoryMemory(), [statusEvent('evt-s1', 'char-1', 1)])
    expect(auditChapterBeatCorroboration(memory, storyArc, 0, [])).toBe(memory)
  })

  it('其他章节的推进事件不纳入本章审计', () => {
    const earlier: StoryEvent = { ...plotAdvance('evt-p0', 'A1-M1', 5), chapterIndex: 0 }
    const memory = applyEvents(createEmptyStoryMemory(), [earlier])
    // 审计第 2 章（index 1）：本章无该 beat 的推进事件，不写审计记录
    expect(auditChapterBeatCorroboration(memory, storyArc, 1, [])).toBe(memory)
  })
})
