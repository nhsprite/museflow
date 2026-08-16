import type {
  BeatCorroborationEvaluation,
  BeatId,
  BeatMemory,
  ChapterFinalStateDeclaration,
  ForeshadowId,
  ForeshadowMemory,
  StoryEvent,
  StoryMemory,
} from '../types/story-memory.js'
import type { StoryArc } from '../types/outline.js'
import { FINAL_STATE_EVENT_TYPES, entityIdFromEvent, finalStateEventValue } from './validator.js'
import { findMandatoryBeatById } from '../utils/mandatory-beat-ids.js'

/**
 * mandatory beat 消费佐证（D.2.1）：纯结构化绑定规则。
 *
 * 一个 mandatory beat 被消费，除了其 plot-advance 推进事件通过正文语义验证（proven），
 * 还必须留下结构化痕迹（corroborated），满足以下任一条件：
 * 1. 同章状态类事件（位置/状态/物品/伏笔回收/任务）与该 beat 的推进事件因果绑定——
 *    共享 @pN 证据锚点，或共享主体实体（角色/物品实体与 plot 实体同 id，
 *    或伏笔注册表的 beatId 归属该 beat）；
 * 2. 受佐证的章末终态声明（STORY_FINAL_STATE）与该 beat 绑定——声明自身被本章
 *    事件流支撑（复用 validator 的 FINAL_STATE_EVENT_TYPES / finalStateEventValue /
 *    entityIdFromEvent 判定件），且声明主体或其支撑事件与推进事件绑定。
 *
 * 只比较事件 ID、证据锚点段落序号与实体 ID，不做任何自然语言匹配。
 */

/** 可作为 beat 消费佐证的同章状态类事件类型。 */
const CORROBORATING_EVENT_TYPES: ReadonlySet<StoryEvent['type']> = new Set([
  'character-location',
  'character-status',
  'character-revival',
  'item-location',
  'item-state',
  'foreshadow-fulfill',
  'task-create',
  'task-resolve',
])

type PlotAdvanceEvent = Extract<StoryEvent, { type: 'plot-advance' }>

function isPlotAdvanceEvent(event: StoryEvent): event is PlotAdvanceEvent {
  return event.type === 'plot-advance'
}

function sharesEvidenceAnchor(a: StoryEvent, b: StoryEvent): boolean {
  const anchorA = a.evidence?.paragraphIndex
  const anchorB = b.evidence?.paragraphIndex
  return anchorA !== undefined && anchorB !== undefined && anchorA === anchorB
}

/** 绑定判定用的事件主体 ID（实体/伏笔/任务 ID 空间；plot-advance 无主体，返回 null）。 */
function bindingSubjectId(event: StoryEvent): string | null {
  switch (event.type) {
    case 'character-location':
    case 'character-status':
    case 'character-revival':
      return event.characterId
    case 'item-location':
    case 'item-state':
      return event.itemId
    case 'foreshadow-introduce':
    case 'foreshadow-fulfill':
      return event.foreshadowId
    case 'task-create':
    case 'task-resolve':
      return event.taskId
    default:
      return null
  }
}

/**
 * 状态类事件与推进事件的因果绑定：共享证据锚点，或共享主体实体
 * （角色/物品实体与 plot 实体同 id；伏笔回收事件按注册表 beatId 归属绑定）。
 */
function isBoundToProvingEvent(
  event: StoryEvent,
  provingEvent: PlotAdvanceEvent,
  foreshadows: Record<ForeshadowId, ForeshadowMemory>
): boolean {
  if (sharesEvidenceAnchor(event, provingEvent)) return true
  const subjectId = bindingSubjectId(event)
  if (subjectId !== null && subjectId === provingEvent.plotId) return true
  if (event.type === 'foreshadow-fulfill') {
    return foreshadows[event.foreshadowId]?.beatId === provingEvent.beatId
  }
  return false
}

/**
 * 终态声明的事件流佐证判定（与 validator 的终态校验同一规则）：
 * 本章存在该实体受支撑类型的状态事件，且最后一条事件的终态值等于声明值。
 * 返回全部支撑候选事件（供绑定判定复用）；未佐证时返回空数组。
 */
function corroboratingCandidatesForDeclaration(
  declaration: ChapterFinalStateDeclaration,
  chapterEvents: readonly StoryEvent[]
): StoryEvent[] {
  const supportedTypes = FINAL_STATE_EVENT_TYPES[declaration.attribute]
  const candidates = chapterEvents.filter(
    (event) =>
      (supportedTypes as readonly string[]).includes(event.type) &&
      entityIdFromEvent(event) === declaration.entityId
  )
  const lastEvent = candidates[candidates.length - 1]
  if (!lastEvent) return []
  return finalStateEventValue(lastEvent) === declaration.value ? candidates : []
}

/** 受佐证的终态声明与该 beat 绑定：声明主体即 plot 实体，或任一支撑事件与推进事件绑定。 */
function isDeclarationBoundToBeat(
  declaration: ChapterFinalStateDeclaration,
  supportingEvents: readonly StoryEvent[],
  provingEvents: readonly PlotAdvanceEvent[],
  foreshadows: Record<ForeshadowId, ForeshadowMemory>
): boolean {
  return provingEvents.some(
    (provingEvent) =>
      declaration.entityId === provingEvent.plotId ||
      supportingEvents.some((event) => isBoundToProvingEvent(event, provingEvent, foreshadows))
  )
}

export interface EvaluateChapterBeatCorroborationsInput {
  /** 本章已接受（通过结构与语义过滤）的事件。 */
  chapterEvents: readonly StoryEvent[]
  finalStateDeclarations: readonly ChapterFinalStateDeclaration[]
  foreshadows: Record<ForeshadowId, ForeshadowMemory>
  /** 仅评估这些 beat（调用方传入 mandatory beat 集合）；缺省评估所有本章有推进事件的 beat。 */
  beatIds?: ReadonlySet<BeatId>
}

/**
 * 评估本章有推进事件的 beat 的佐证完整性。
 * 仅输出本章确有推进事件的 beat；无推进事件的 beat 不在本章审计范围内。
 */
export function evaluateChapterBeatCorroborations(
  input: EvaluateChapterBeatCorroborationsInput
): BeatCorroborationEvaluation[] {
  const { chapterEvents, finalStateDeclarations, foreshadows, beatIds } = input

  const provingEventsByBeat = new Map<BeatId, PlotAdvanceEvent[]>()
  for (const event of chapterEvents) {
    if (!isPlotAdvanceEvent(event)) continue
    if (beatIds && !beatIds.has(event.beatId)) continue
    const list = provingEventsByBeat.get(event.beatId) ?? []
    list.push(event)
    provingEventsByBeat.set(event.beatId, list)
  }

  const stateClassEvents = chapterEvents.filter((event) =>
    CORROBORATING_EVENT_TYPES.has(event.type)
  )

  const evaluations: BeatCorroborationEvaluation[] = []
  for (const [beatId, provingEvents] of provingEventsByBeat) {
    const corroboratingEventIds = [
      ...new Set(
        stateClassEvents
          .filter((event) =>
            provingEvents.some((provingEvent) =>
              isBoundToProvingEvent(event, provingEvent, foreshadows)
            )
          )
          .map((event) => event.id)
      ),
    ]

    const corroboratedByFinalState = finalStateDeclarations.some((declaration) => {
      const supportingEvents = corroboratingCandidatesForDeclaration(declaration, chapterEvents)
      return (
        supportingEvents.length > 0 &&
        isDeclarationBoundToBeat(declaration, supportingEvents, provingEvents, foreshadows)
      )
    })

    evaluations.push({
      beatId,
      provingEventIds: provingEvents.map((event) => event.id),
      corroboratingEventIds,
      corroboratedByFinalState,
      corroborated: corroboratingEventIds.length > 0 || corroboratedByFinalState,
    })
  }
  return evaluations
}

/**
 * 把本章的佐证评估合并进 StoryMemory 的 beat 审计记录（D.2.3）。
 * 状态单向升级：已 consumed 的 beat 不因后续未佐证评估回退；
 * 未佐证的 beat 在后续章节获得佐证后升级为 consumed。
 */
export function mergeBeatCorroborationIntoMemory(
  memory: StoryMemory,
  evaluations: readonly BeatCorroborationEvaluation[]
): StoryMemory {
  if (evaluations.length === 0) return memory
  const beats: StoryMemory['beats'] = { ...memory.beats }
  for (const evaluation of evaluations) {
    const existing = beats[evaluation.beatId]
    if (!existing) continue
    const previous = existing.corroboration
    const consumed = evaluation.corroborated || previous?.status === 'consumed'
    beats[evaluation.beatId] = {
      ...existing,
      corroboration: {
        status: consumed ? 'consumed' : 'proven_uncorroborated',
        corroboratingEventIds: [
          ...new Set([
            ...(previous?.corroboratingEventIds ?? []),
            ...evaluation.corroboratingEventIds,
          ]),
        ],
        corroboratedByFinalState:
          (previous?.corroboratedByFinalState ?? false) || evaluation.corroboratedByFinalState,
      },
    }
  }
  return { ...memory, beats }
}

/**
 * 定稿环节的 beat 佐证审计（D.2.1/D.2.3）：对本章新获证明的 mandatory beat
 * 评估佐证并把审计记录写入 memory。key beat 维持单段验证标准，不参与审计。
 */
export function auditChapterBeatCorroboration(
  memory: StoryMemory,
  storyArc: StoryArc | null | undefined,
  chapterIndex: number,
  finalStateDeclarations: readonly ChapterFinalStateDeclaration[]
): StoryMemory {
  const chapterEvents = memory.events.filter((event) => event.chapterIndex === chapterIndex)
  const mandatoryBeatIds = new Set(
    chapterEvents
      .filter(isPlotAdvanceEvent)
      .map((event) => event.beatId)
      .filter((beatId) => findMandatoryBeatById(storyArc, beatId) !== undefined)
  )
  if (mandatoryBeatIds.size === 0) return memory
  const evaluations = evaluateChapterBeatCorroborations({
    chapterEvents,
    finalStateDeclarations,
    foreshadows: memory.foreshadows,
    beatIds: mandatoryBeatIds,
  })
  return mergeBeatCorroborationIntoMemory(memory, evaluations)
}

/**
 * 幕进度消费判定（D.2.1/D.2.2）：mandatory beat 须 proven 且佐证审计通过才算消费；
 * 采用前已消费（无审计记录）的 beat 按 grandfathered 处理，视为 consumed。
 */
export function isConsumedMandatoryBeat(beat: BeatMemory | undefined): boolean {
  if (!beat || beat.provenByEventIds.length === 0) return false
  if (!beat.corroboration) return true
  return beat.corroboration.status === 'consumed'
}
