import { logger } from '../utils/logger.js'
import type { ReducedGraphState } from '../graph/state.js'
import { plan_chapter_with_override } from '../graph/nodes/planning.js'
import {
  buildNextChapterBoundaryHint,
  reconcileOutlineWithState,
} from '../utils/outline-boundary.js'
import { toDisplayChapterNumber } from '../utils/chapter-display.js'
import { formatStoryTime } from '../utils/story-time.js'
import type {
  BeatClaimPlanningRejection,
  ChapterPlan,
  ChapterOutlineAgentInput,
  ForeshadowPlanningRejection,
  ZeroProgressRejection,
} from '../agents/types.js'
import { readChapterContent } from '../storage/filesystem/writer.js'
import {
  getChapterPlanningConfig,
  validateChapterPlanBudget,
  type ChapterPlanBudgetValidation,
  type CoreSectionJudge,
} from '../utils/chapter-planning.js'
import type { Issue } from '../types/agent.js'
import type { ModelProvider, Message, JsonSchema } from '../model/provider.js'
import { batchValidateTimeAnchors } from '../utils/context-judge.js'
import { getChapterOutlineAgent } from '../graph/agent-factory.js'
import { buildLayeredSummaries } from '../utils/summary-compressor.js'
import { selectChapterSummaries } from '../utils/chapter-summaries.js'
import { formatStoryState, prepareStoryStateForChapter } from '../graph/utils/reconciler/index.js'
import { prepareStoryStateForChapterCached } from '../graph/utils/chapter-context.js'
import { buildPreviousChapterEndingContext } from '../graph/utils/chapter-window.js'
import type { RuntimeContext } from './context.js'
import { getCoveredMandatoryBeatId } from '../utils/beat-coverage.js'
import { charactersToString } from '../graph/utils/characters.js'
import { BlockingConflictError, isBlockingConflictError } from '../utils/errors.js'
import type { OutlineRevisionProposal } from './chapter-generation/outline-revision-proposal.js'
import type { Conflict } from '../types/story-state.js'
import {
  buildArcStatus,
  calculateBeatBudget,
  formatActBoundaryAdjustmentCommand,
  getActForChapter,
  getVerifiedBeatsFromMemory,
} from '../utils/story-arc.js'
import { findMandatoryBeatById, getMandatoryBeatEntries } from '../utils/mandatory-beat-ids.js'
import type { ChapterOutlineResult } from '../agents/chapter-outline.js'
import {
  createGenericVerifiedConstraint,
  filterVerifiedConstraintsForChapter,
  renderVerifiedConstraints,
} from '../utils/verified-constraints.js'
import { normalizeForeshadowCapacity } from '../story-memory/foreshadow-policy.js'
import { normalizeStoryEvents } from '../story-memory/event-contract.js'
import { verifyForeshadowPlan } from '../graph/services/foreshadow-fulfillment/planning-verifier.js'
import {
  verifyBeatClaims,
  type BeatClaimRejection,
} from '../graph/services/plot-advance/beat-claim-verifier.js'
import { findForeshadowFulfillmentConflictIds } from '../story-memory/foreshadow-alias.js'
import { validatePlannedStoryEventAuthority } from '../story-memory/event-authority.js'
import {
  buildForeshadowPlanningObligations,
  computeForeshadowConstraintContext,
  getForeshadowScheduleContext,
} from './outline/foreshadow-scheduling.js'
import {
  buildScheduledForeshadowPlanError,
  canonicalizeChapterForeshadowClaims,
  canonicalizeForeshadowClaimIds,
  canonicalizeStateForeshadowClaims,
  deferForeshadowClaims,
  evaluateScheduledForeshadowPlanEvidence,
  formatMissingScheduledForeshadowPlanEvidence,
  getConflictingForeshadowDecisionIds,
  getMissingForeshadowPlanEvidenceIds,
  hasMissingScheduledForeshadowPlanEvidence,
  logScheduledForeshadowPlanAttempt,
} from './outline/foreshadow-claims.js'
import {
  autoExtendCurrentActBeforeOutline,
  buildArcStatusConstraint,
  ensureActCapacityAfterForeshadowAdjudication,
} from './outline/act-boundary.js'
import {
  candidateHasBeatClaim,
  collectClaimsForBeatVerification,
  finalizeChapterOutlineCandidate,
  isBeatAlreadyProven,
  stripRejectedBeatClaims,
} from './outline/beat-claims.js'

export interface ExpandedOutline {
  chapterPlan: ChapterPlan
  boundaryHints: string[]
  pendingIssues?: Issue[]
  outline?: ReducedGraphState['outline']
  story?: ReducedGraphState['story']
  totalChapters?: ReducedGraphState['totalChapters']
  storyArc?: ReducedGraphState['storyArc']
  chapters?: ReducedGraphState['chapters']
}

type ChapterContextSource = ModelProvider | RuntimeContext

const MAX_JIT_OUTLINE_ATTEMPTS = 3
const BASE_SEMANTIC_PLANNING_ATTEMPTS = 3

interface SemanticPlanningRetryContext {
  attempt: number
  rejection?: ForeshadowPlanningRejection
  outlineOrigin?: 'persisted' | 'jit-generated'
  /** 正文阶段节拍驳回反馈：存在时强制重生成大纲（保留认领，仅重做实现方式）。 */
  beatClaimRejection?: BeatClaimPlanningRejection
  /** 跨章零增量闸反馈：存在时强制重生成大纲（围绕可观察变化重组本章）。 */
  zeroProgressRejection?: ZeroProgressRejection
}

function isRuntimeContext(source: ChapterContextSource): source is RuntimeContext {
  return 'provider' in source
}

function getProvider(source: ChapterContextSource): ModelProvider {
  return isRuntimeContext(source) ? source.provider : source
}

function normalizeReusableChapterPlan(
  plan: ChapterPlan,
  chapterIndex: number,
  state: ReducedGraphState
): ChapterPlan | null {
  const memory = state.storyMemory
  const expectedEvents = Array.isArray(plan.expectedEvents) ? plan.expectedEvents : []
  const existingConflictIds = Array.isArray(plan.foreshadowFulfillmentConflictIds)
    ? plan.foreshadowFulfillmentConflictIds
    : []
  const detectedConflictIds = findForeshadowFulfillmentConflictIds(memory, expectedEvents)
  const conflictIds = memory
    ? canonicalizeForeshadowClaimIds(memory, [...existingConflictIds, ...detectedConflictIds])
    : Array.from(new Set([...existingConflictIds, ...detectedConflictIds]))
  const result = normalizeStoryEvents(expectedEvents, {
    chapterIndex,
    mode: 'legacy',
  })
  if (result.invalid.length > 0) {
    const first = result.invalid[0]!
    logger.warn(
      `[MuseFlow] 第 ${chapterIndex + 1} 章既有规划的 expectedEvents[${first.index}] 无法安全兼容：${first.reason}，将重新规划`
    )
    return null
  }
  const { foreshadowFulfillmentConflictIds: _existingConflictIds, ...normalizedPlan } = plan
  const reusablePlan: ChapterPlan = {
    ...normalizedPlan,
    chapterIndex,
    expectedEvents: result.events,
    ...(conflictIds.length > 0 ? { foreshadowFulfillmentConflictIds: conflictIds } : {}),
  }
  const authorityIssues = validatePlannedStoryEventAuthority(state, reusablePlan.expectedEvents)
  if (authorityIssues.length > 0) {
    const details = authorityIssues
      .map(
        (issue) => `expectedEvents[${issue.index}].${issue.field}=${issue.id} (${issue.eventType})`
      )
      .join(', ')
    logger.warn(
      `[MuseFlow] 第 ${chapterIndex + 1} 章既有规划引用了未授权的结构化 ID：${details}，将重新规划`
    )
    return null
  }
  return reusablePlan
}

function reconcileChapterPlanBeatContract(
  plan: ChapterPlan,
  outlineItem: ReducedGraphState['outline'][number] | undefined
): ChapterPlan {
  if (!outlineItem) return plan

  const claimedMandatoryBeatIds = Array.from(new Set(outlineItem.claimedMandatoryBeatIds ?? []))
  const claimedBeatIds = Array.from(new Set(outlineItem.claimedBeatIds ?? []))
  const authorizedBeatIds = new Set([...claimedMandatoryBeatIds, ...claimedBeatIds])

  return {
    ...plan,
    claimedMandatoryBeatIds,
    claimedBeatIds,
    expectedEvents: (plan.expectedEvents ?? []).filter(
      (event) => event.type !== 'plot-advance' || authorizedBeatIds.has(event.beatId)
    ),
  }
}

function getMissingScheduledForeshadowIds(
  fulfilledForeshadowIds: string[] | undefined,
  scheduledForeshadowIds: string[]
): string[] {
  const fulfilled = new Set(fulfilledForeshadowIds ?? [])
  return scheduledForeshadowIds.filter((id) => !fulfilled.has(id))
}

function canonicalizeStateCoveredBeatClaims(
  state: ReducedGraphState,
  chapterIndex: number
): ReducedGraphState {
  const storyArc = state.storyArc
  const outlineItem = state.outline[chapterIndex]
  if (!storyArc || !outlineItem || (outlineItem.claimedBeatIds?.length ?? 0) === 0) return state

  const currentAct = getActForChapter(storyArc, chapterIndex)
  const retainedKeyBeatIds: string[] = []
  const canonicalMandatoryBeatIds = [...(outlineItem.claimedMandatoryBeatIds ?? [])]
  const replacedKeyBeatIds: string[] = []

  for (const beatId of outlineItem.claimedBeatIds ?? []) {
    const coveredBy = getCoveredMandatoryBeatId(storyArc, beatId)
    if (!coveredBy) {
      retainedKeyBeatIds.push(beatId)
      continue
    }

    replacedKeyBeatIds.push(beatId)
    const mandatoryBeat = findMandatoryBeatById(storyArc, coveredBy)
    if (
      mandatoryBeat &&
      mandatoryBeat.act.index === currentAct?.index &&
      !isBeatAlreadyProven(state, coveredBy)
    ) {
      if (!canonicalMandatoryBeatIds.includes(coveredBy)) {
        canonicalMandatoryBeatIds.push(coveredBy)
      }
    }
  }

  if (replacedKeyBeatIds.length === 0) return state

  const canonicalMandatoryBeats = canonicalMandatoryBeatIds.flatMap((beatId) => {
    const mandatoryBeat = findMandatoryBeatById(storyArc, beatId)
    return mandatoryBeat ? [mandatoryBeat.beat] : []
  })
  const outline = [...state.outline]
  outline[chapterIndex] = {
    ...outlineItem,
    claimedBeatIds: retainedKeyBeatIds,
    claimedMandatoryBeatIds: canonicalMandatoryBeatIds,
    claimedBeats: canonicalMandatoryBeats,
  }
  logger.info(
    `[MuseFlow] 第 ${chapterIndex + 1} 章将 mandatory beat 别名认领归一到规范 ID：${replacedKeyBeatIds.join(', ')}`
  )
  return {
    ...state,
    outline,
    chapterPlan: state.chapterPlan?.chapterIndex === chapterIndex ? null : state.chapterPlan,
  }
}

const CORE_SECTION_JUDGE_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: { type: 'boolean' },
    },
  },
  required: ['results'],
}

async function judgeCoreSectionsWithModel(
  provider: ModelProvider,
  outlineDescription: string | undefined,
  sections: ChapterPlan['sections']
): Promise<boolean[]> {
  if (!outlineDescription || sections.length === 0) {
    return sections.map(() => true)
  }

  const sectionsText = sections
    .map((s, i) => {
      const parts = [
        `${i + 1}. 标题：${s.title || '未命名'}`,
        `摘要：${s.summary || ''}`,
        `事件：${(s.events ?? []).join('、')}`,
        `字数：${s.wordCount ?? 0}`,
      ]
      return parts.join('\n')
    })
    .join('\n\n')

  const messages: Message[] = [
    {
      role: 'system',
      content: `你是小说章节规划校验助手。请根据本章大纲描述，判断每个 section 是否直接服务于大纲核心事件。

判断标准：
1. section 的标题、摘要或事件必须与大纲描述中的核心情节、核心动作、核心冲突直接相关，才算核心事件。
2. 如果只是铺垫、过渡、回忆、支线、前章遗留差事、背景介绍、气氛描写，不算核心事件。
3. 不要过度宽容，只有明显属于大纲核心事件的 section 才返回 true。
4. 只输出 JSON，格式为 {"results": [true, false, ...]}，顺序与输入 section 一致，不要解释。`,
    },
    {
      role: 'user',
      content: `【本章大纲描述】\n${outlineDescription}\n\n【章节规划 sections】\n${sectionsText}`,
    },
  ]

  try {
    if (provider.chatStructured) {
      const response = await provider.chatStructured<{ results: boolean[] }>(
        messages,
        CORE_SECTION_JUDGE_SCHEMA,
        0.3,
        { purpose: 'outline.core-section-judge' }
      )
      return response.results
    }

    const text = await provider.chat(messages, 0.3, {
      purpose: 'outline.core-section-judge',
    })
    const parsed = JSON.parse(text) as { results: boolean[] }
    return parsed.results
  } catch (err) {
    logger.warn('[MuseFlow] 模型判断核心事件失败，回退到宽松模式:', err)
    return sections.map(() => true)
  }
}

export async function validateChapterTimeAnchor(
  chapterPlan: ChapterPlan,
  previousChapterContent: string | null,
  provider: ModelProvider
): Promise<{ valid: boolean; reason?: string }> {
  const anchor = chapterPlan.chapterTimeAnchor ?? ''
  if (!anchor || !previousChapterContent || previousChapterContent.trim().length === 0) {
    return { valid: true }
  }

  const results = await batchValidateTimeAnchors(provider, [
    { anchor, previousContent: previousChapterContent },
  ])
  return results[0] ?? { valid: true }
}

function buildCurrentStateSnapshot(state: ReducedGraphState): string {
  const memory = state.storyMemory
  const handoff = state.storyState?.chapterHandoff
  const storyTime = state.storyState?.storyTime

  const parts: string[] = []

  const previousEndTime = handoff ? formatStoryTime(handoff.endTime) : formatStoryTime(storyTime)
  if (previousEndTime) {
    parts.push(`【上一章结束时间】${previousEndTime}`)
  }
  if (handoff?.charactersPresent && handoff.charactersPresent.length > 0) {
    parts.push(`【上一章结尾在场角色】${handoff.charactersPresent.join('、')}`)
  }
  if (handoff?.endScene) {
    parts.push(`【上一章结尾场景】${handoff.endScene}`)
  }
  if (handoff?.lastAction) {
    parts.push(`【上一章最后动作】${handoff.lastAction}`)
  }

  if (memory) {
    const characterLocations = Object.values(memory.entities.characters)
      .filter((c) => c.locationId)
      .map((c) => {
        const loc = memory.entities.locations[c.locationId!]
        return `- ${c.id}（${c.name}）: ${loc ? loc.name : c.locationId}`
      })
    if (characterLocations.length > 0) {
      parts.push('【角色当前位置】')
      parts.push(...characterLocations)
    }

    const itemLocations = Object.values(memory.entities.items)
      .filter((item) => item.locationId || item.holderId)
      .map((item) => {
        const holder = item.holderId ? memory.entities.characters[item.holderId] : undefined
        const location = item.locationId ? memory.entities.locations[item.locationId] : undefined
        const where = holder
          ? `持有者 ${holder.name}（${item.holderId}）`
          : location
            ? `位置 ${location.name}（${item.locationId}）`
            : `位置 ${item.locationId ?? item.holderId}`
        return `- ${item.id}（${item.name}）: ${where}`
      })
    if (itemLocations.length > 0) {
      parts.push('【关键物品当前位置/持有者】')
      parts.push(...itemLocations)
    }
  }

  if (parts.length === 0) {
    return '（暂无结构化状态快照）'
  }

  return parts.join('\n')
}

interface GenerateChapterOutlineResult {
  state: ReducedGraphState
  pendingIssues: Issue[]
}

interface GenerateChapterOutlineOptions {
  force?: boolean
  foreshadowPlanningRejection?: ForeshadowPlanningRejection
  beatClaimRejection?: BeatClaimPlanningRejection
  zeroProgressRejection?: ZeroProgressRejection
}

async function generateChapterOutlineIfNeeded(
  state: ReducedGraphState,
  chapterIndex: number,
  provider: ModelProvider,
  options: GenerateChapterOutlineOptions = {}
): Promise<GenerateChapterOutlineResult> {
  const outlineItem = state.outline[chapterIndex]
  if (!outlineItem) {
    throw new Error(`第 ${chapterIndex + 1} 章大纲不存在`)
  }

  // 已有具体描述，不需要重新生成
  if (outlineItem.description.trim().length > 0 && !options.force) {
    return { state, pendingIssues: [] }
  }

  if (!state.storyArc) {
    throw new Error('未生成故事弧线，无法即时生成章节大纲')
  }

  const worldContent = state.world?.content
  const agent = getChapterOutlineAgent(provider)
  const baseVerifiedConstraints = filterVerifiedConstraintsForChapter(
    state.verifiedConstraints,
    state.storyArc,
    chapterIndex
  )
  const foreshadowSchedule = getForeshadowScheduleContext(state, chapterIndex)
  const scheduledForeshadowIds = foreshadowSchedule.deadlineCandidateIds
  const opportunityForeshadowIds = foreshadowSchedule.opportunityCandidateIds
  const foreshadowConstraintContext = computeForeshadowConstraintContext(
    state,
    chapterIndex,
    scheduledForeshadowIds
  )
  const { mustFulfillIds: mustFulfillForeshadowIds } = foreshadowConstraintContext
  const foreshadowObligations = buildForeshadowPlanningObligations(
    state,
    foreshadowSchedule,
    mustFulfillForeshadowIds
  )

  // 计算本章节拍预算，防止幕前期把全部 mandatory beats 一次性消费完
  const currentAct = getActForChapter(state.storyArc, chapterIndex)
  const actProgressForAct = currentAct ? state.actProgress?.[currentAct.index] : undefined
  const pendingBeats = actProgressForAct?.pending ?? currentAct?.mandatoryBeats ?? []
  const beatBudget = currentAct ? calculateBeatBudget(currentAct, chapterIndex, pendingBeats) : 0
  const beatBudgetConstraint =
    beatBudget > 0
      ? `【节拍预算】本章属于第 ${currentAct?.index ?? '?'} 幕，剩余 ${pendingBeats.length} 个 mandatory beats、${currentAct ? currentAct.endChapter - (chapterIndex + 1) : 0} 章未写。本章 description 与 claimedBeats 最多承载 ${beatBudget} 个 mandatory beat，严禁在本章内一次性推进本幕其余所有节拍。`
      : ''

  // 幕边界压力（高/中）此前只注入规划阶段，大纲阶段完全看不到；
  // 这里同步注入大纲 agent，并在高压时对「零认领」做打回重试。
  const planningConfig = getChapterPlanningConfig(state.genre)
  const verifiedBeatIdSet = new Set(
    state.storyMemory ? getVerifiedBeatsFromMemory(state.storyMemory, state.storyArc) : []
  )
  const arcStatus = state.storyArc
    ? buildArcStatus(
        state.storyArc,
        state.actProgress ?? {},
        chapterIndex,
        planningConfig.bookClosingPhaseRatio,
        verifiedBeatIdSet
      )
    : undefined
  const arcStatusConstraint = state.storyArc
    ? buildArcStatusConstraint(
        state.storyArc,
        state.actProgress ?? {},
        chapterIndex,
        planningConfig.bookClosingPhaseRatio,
        verifiedBeatIdSet
      )
    : undefined
  const chaptersRemainingInAct = currentAct ? currentAct.endChapter - (chapterIndex + 1) : 0
  // 高压 = 未消费 mandatory beats 多于幕内剩余章节；此时本章再不认领，幕末必然阻塞。
  // 中压 = 配速压力（pending 超过隔章消费配速）：同样要求认领并打回重试，但重试
  // 耗尽后允许零认领软着陆（记警告）——配速压力的意义是提前给消费机会，而非挡死
  // 章节；硬中止只留给高压（幕末零余量）。
  const mandatoryBeatPressure = arcStatus?.mandatoryBeatPressure
  const hardMandatoryBeatPressure =
    mandatoryBeatPressure === 'high' && (arcStatus?.beatsPending.length ?? 0) > 0
  const beatArithmeticClaimPressure =
    (mandatoryBeatPressure === 'high' || mandatoryBeatPressure === 'medium') &&
    (arcStatus?.beatsPending.length ?? 0) > 0
  // 零认领连击升级（C.2.3）：连续 zeroClaimEscalationThreshold 章大纲零认领 mandatory beat 后，
  // 无论 beat 算术如何都强制本章认领——关闭零认领逃逸口，重试/中止机制与幕边界高压一致。
  // 当前幕没有可认领节拍时不构成认领义务，不升级。
  const zeroClaimStreak = state.consecutiveZeroClaimChapters ?? 0
  const currentActPendingMandatoryPairs = getMandatoryBeatEntries(state.storyArc)
    .filter((entry) => entry.actIndex === currentAct?.index)
    .filter((entry) => !isBeatAlreadyProven(state, entry.id))
    .map((entry) => ({ beatId: entry.id, beat: entry.beat }))
  const zeroClaimEscalation =
    zeroClaimStreak >= planningConfig.zeroClaimEscalationThreshold &&
    currentActPendingMandatoryPairs.length > 0
  const mustClaimMandatoryBeat = beatArithmeticClaimPressure || zeroClaimEscalation
  const pendingMandatoryBeatPairs = mustClaimMandatoryBeat ? currentActPendingMandatoryPairs : []
  // 强制认领反馈的触发源：beat 算术压力优先如实呈现，否则为连续零认领升级。
  const claimPressureSource = beatArithmeticClaimPressure ? 'act_boundary' : 'zero_claim_streak'
  if (zeroClaimEscalation && !beatArithmeticClaimPressure) {
    logger.warn(
      `[MuseFlow] 此前已连续 ${zeroClaimStreak} 章大纲零认领 mandatory beat，第 ${chapterIndex + 1} 章按升级压力强制认领（关闭零认领逃逸口）`
    )
  }

  let foreshadowPlanningRejection = options.foreshadowPlanningRejection
  let result: ChapterOutlineResult | null = null
  let lastCandidate: ChapterOutlineResult | null = null
  let lastMissingScheduledForeshadowIds: string[] = []
  let lastConflictingDecisionIds: string[] = []
  let beatClaimRejection: BeatClaimPlanningRejection | undefined = options.beatClaimRejection
  let lastBeatClaimRejections: BeatClaimRejection[] = []
  let strippedBeatClaimRejections: BeatClaimRejection[] = []
  let zeroClaimRejected = false
  let pacingZeroClaimAccepted = false
  const requiredFulfillmentIds = [...mustFulfillForeshadowIds]
  let preservedFulfillmentIds = new Set(foreshadowPlanningRejection?.preservedFulfillmentIds ?? [])
  const regressedFulfillmentIds = new Set(
    foreshadowPlanningRejection?.regressedFulfillmentIds ?? []
  )
  let autoDeferredForeshadowIds: string[] = []

  for (let attempt = 0; attempt < MAX_JIT_OUTLINE_ATTEMPTS; attempt++) {
    const verifiedConstraints = [
      ...renderVerifiedConstraints(baseVerifiedConstraints),
      ...(beatBudgetConstraint ? [beatBudgetConstraint] : []),
      ...(arcStatusConstraint ? [arcStatusConstraint] : []),
    ]
    const previousChapters = [
      buildLayeredSummaries(selectChapterSummaries(state.chapters, chapterIndex), chapterIndex),
      await buildPreviousChapterEndingContext(state, chapterIndex),
    ]
      .filter(Boolean)
      .join('\n\n')

    const agentState: ChapterOutlineAgentInput = {
      idea: state.idea,
      genre: state.genre,
      totalChapters: state.totalChapters,
      title: state.story.title,
      chapterIndex,
      storyArc: state.storyArc,
      actProgress: state.actProgress,
      ...(worldContent ? { world: worldContent } : {}),
      characters: charactersToString(state.characters),
      previousChapters,
      storyState: state.storyState
        ? formatStoryState(state.storyState, state.storyMemory?.entities)
        : '',
      ...(state.storyState?.canonicalFacts
        ? { canonicalFacts: state.storyState.canonicalFacts }
        : {}),
      ...(verifiedConstraints.length > 0 ? { verifiedConstraints } : {}),
      ...(foreshadowObligations.length > 0 ? { foreshadowObligations } : {}),
      ...(foreshadowPlanningRejection ? { foreshadowPlanningRejection } : {}),
      ...(beatClaimRejection ? { beatClaimRejection } : {}),
      ...(mustClaimMandatoryBeat ? { mandatoryBeatClaimRequired: true } : {}),
      // 连续零认领升级（非 beat 算术压力）时标记触发源，prompt 据此给出正确的强制原因。
      ...(zeroClaimEscalation && !beatArithmeticClaimPressure ? { zeroClaimEscalation: true } : {}),
      ...(options.zeroProgressRejection
        ? { zeroProgressRejection: options.zeroProgressRejection }
        : {}),
      currentStateSnapshot: buildCurrentStateSnapshot(state),
    }

    const output = await agent.run(agentState)
    if (!output.success || !output.data) {
      throw new Error(`第 ${chapterIndex + 1} 章即时大纲生成失败：${output.error || '未知错误'}`)
    }

    const {
      conflict: _ignoredConflict,
      conflictReason: _ignoredConflictReason,
      ...rawCandidate
    } = output.data as ChapterOutlineResult & {
      conflict?: unknown
      conflictReason?: unknown
    }
    const canonicalCandidate = state.storyMemory
      ? canonicalizeChapterForeshadowClaims(state.storyMemory, rawCandidate, null)
      : {
          outline: rawCandidate,
          conflictingDecisionIds: getConflictingForeshadowDecisionIds(rawCandidate),
        }
    const candidate = canonicalCandidate.outline

    const adjudicatedForeshadowIds = new Set([
      ...(candidate.fulfilledForeshadowIds ?? []),
      ...(candidate.deferredForeshadowIds ?? []),
    ])
    const omittedOpportunityIds = opportunityForeshadowIds.filter(
      (id) => !adjudicatedForeshadowIds.has(id)
    )
    const normalizedCandidate: ChapterOutlineResult = {
      ...candidate,
      deferredForeshadowIds: Array.from(
        new Set([...(candidate.deferredForeshadowIds ?? []), ...omittedOpportunityIds])
      ),
    }
    lastCandidate = normalizedCandidate

    const missingScheduledForeshadowIds = getMissingScheduledForeshadowIds(
      [
        ...(normalizedCandidate.fulfilledForeshadowIds ?? []),
        ...(normalizedCandidate.deferredForeshadowIds ?? []),
      ],
      scheduledForeshadowIds
    )
    const deferredMustFulfillIds = mustFulfillForeshadowIds.filter((id) =>
      normalizedCandidate.deferredForeshadowIds?.includes(id)
    )
    const conflictingDecisionIds = canonicalCandidate.conflictingDecisionIds
    if (
      missingScheduledForeshadowIds.length > 0 ||
      deferredMustFulfillIds.length > 0 ||
      conflictingDecisionIds.length > 0
    ) {
      const correctionIds = Array.from(
        new Set([
          ...missingScheduledForeshadowIds,
          ...deferredMustFulfillIds,
          ...conflictingDecisionIds,
        ])
      )
      lastMissingScheduledForeshadowIds = correctionIds
      lastConflictingDecisionIds = conflictingDecisionIds
      const fulfilledIds = new Set(normalizedCandidate.fulfilledForeshadowIds ?? [])
      for (const id of preservedFulfillmentIds) {
        if (!fulfilledIds.has(id)) regressedFulfillmentIds.add(id)
      }
      const nextPreservedFulfillmentIds = requiredFulfillmentIds.filter((id) =>
        fulfilledIds.has(id)
      )
      logger.warn(
        `[MuseFlow] 第 ${chapterIndex + 1} 章即时大纲第 ${attempt + 1}/${MAX_JIT_OUTLINE_ATTEMPTS} 次存在未裁决或错误顺延伏笔候选：${correctionIds.join(', ')}`
      )
      foreshadowPlanningRejection = {
        ...(foreshadowPlanningRejection ?? {}),
        missingDeclarationIds: missingScheduledForeshadowIds,
        missingEventIds: [],
        incorrectlyDeferredIds: deferredMustFulfillIds,
        requiredFulfillmentIds,
        preservedFulfillmentIds: nextPreservedFulfillmentIds,
        regressedFulfillmentIds: [...regressedFulfillmentIds],
        conflictingDecisionIds,
        currentOutline: {
          title: normalizedCandidate.title,
          description: normalizedCandidate.description,
        },
      }
      preservedFulfillmentIds = new Set(nextPreservedFulfillmentIds)
      continue
    }

    const claimsToVerify = collectClaimsForBeatVerification(
      normalizedCandidate,
      state,
      chapterIndex,
      beatBudget
    )
    const beatClaimRejections =
      claimsToVerify.length > 0
        ? await verifyBeatClaims({
            provider,
            claims: claimsToVerify,
            outlineDescription: normalizedCandidate.description,
          })
        : []
    if (beatClaimRejections.length > 0) {
      lastBeatClaimRejections = beatClaimRejections
      logger.warn(
        `[MuseFlow] 第 ${chapterIndex + 1} 章即时大纲第 ${attempt + 1}/${MAX_JIT_OUTLINE_ATTEMPTS} 次的节拍认领未在 description 中呈现：${beatClaimRejections.map((rejection) => rejection.beatId).join(', ')}`
      )
      beatClaimRejection = {
        rejectedClaims: beatClaimRejections,
        // 高压下附上待消费节拍清单：被驳回的重试允许改认另一个更适配当前叙事位置的节拍。
        ...(mustClaimMandatoryBeat
          ? {
              requiredClaims: {
                pendingMandatoryBeats: pendingMandatoryBeatPairs,
                chaptersRemainingInAct,
                pressureSource: claimPressureSource,
              },
            }
          : {}),
        currentOutline: {
          title: normalizedCandidate.title,
          description: normalizedCandidate.description,
        },
      }
      continue
    }

    const finalizedCandidate = finalizeChapterOutlineCandidate(
      normalizedCandidate,
      state,
      chapterIndex,
      beatBudget
    )
    // 高压下零认领打回：过滤后仍一个 mandatory beat 都没认领时，
    // 本章必将在幕末留下比剩余章数更多的未消费节拍，直接打回比放行更省代价。
    // 连续零认领升级（C.2.3）下同理：零认领逃逸口已关闭，打回重试。
    if (mustClaimMandatoryBeat && (finalizedCandidate.claimedMandatoryBeatIds ?? []).length === 0) {
      zeroClaimRejected = true
      logger.warn(
        `[MuseFlow] 第 ${chapterIndex + 1} 章即时大纲第 ${attempt + 1}/${MAX_JIT_OUTLINE_ATTEMPTS} 次在强制认领压力（${claimPressureSource === 'zero_claim_streak' ? '连续零认领升级' : '幕边界高压'}）下未认领任何 mandatory beat，打回重试`
      )
      beatClaimRejection = {
        rejectedClaims: [],
        requiredClaims: {
          pendingMandatoryBeats: pendingMandatoryBeatPairs,
          chaptersRemainingInAct,
          pressureSource: claimPressureSource,
        },
        currentOutline: {
          title: normalizedCandidate.title,
          description: normalizedCandidate.description,
        },
      }
      continue
    }
    result = finalizedCandidate
    break
  }

  if (!result) {
    if (lastConflictingDecisionIds.length > 0) {
      throw new Error(
        `第 ${chapterIndex + 1} 章即时大纲无法裁决相互冲突的伏笔决策：${lastConflictingDecisionIds.join(', ')}。已完成一次定向纠正，请人工确认每个 ID 仅保留兑现或顺延其中一种决策。`
      )
    }
    if (lastCandidate && lastMissingScheduledForeshadowIds.length > 0) {
      const nonDeferrableIds = lastMissingScheduledForeshadowIds.filter((id) =>
        mustFulfillForeshadowIds.includes(id)
      )
      if (nonDeferrableIds.length > 0) {
        throw new Error(
          `第 ${chapterIndex + 1} 章伏笔大纲修订未收敛：必须回收 ${requiredFulfillmentIds.join(', ')}；最终未裁决或错误顺延 ${nonDeferrableIds.join(', ')}；修订中回退 ${regressedFulfillmentIds.size > 0 ? [...regressedFulfillmentIds].join(', ') : '无'}。`
        )
      }
      logger.warn(
        `[MuseFlow] 第 ${chapterIndex + 1} 章即时大纲连续 ${MAX_JIT_OUTLINE_ATTEMPTS} 次存在未裁决伏笔候选，已自动顺延：${lastMissingScheduledForeshadowIds.join(', ')}`
      )
      // 候选大纲可能已自行将部分 id 放入 deferredForeshadowIds（tight 模式下强制回收项
      // 被错误顺延也会触发重试），自动顺延时跳过这些 id，避免重复。
      const alreadyDeferred = new Set(lastCandidate.deferredForeshadowIds ?? [])
      autoDeferredForeshadowIds = lastMissingScheduledForeshadowIds.filter(
        (id) => !alreadyDeferred.has(id)
      )
      const candidateWithDeferred = {
        ...lastCandidate,
        deferredForeshadowIds: [
          ...(lastCandidate.deferredForeshadowIds ?? []),
          ...autoDeferredForeshadowIds,
        ],
      }
      // 同一次生成若还曾认领未通过语义校验的节拍，落地前一并剥离，避免把不可兑现的认领带入正文。
      strippedBeatClaimRejections = lastBeatClaimRejections.filter((rejection) =>
        candidateHasBeatClaim(candidateWithDeferred, rejection.beatId)
      )
      if (strippedBeatClaimRejections.length > 0) {
        logger.warn(
          `[MuseFlow] 第 ${chapterIndex + 1} 章即时大纲的节拍认领未在 description 中呈现，已自动剥离认领：${strippedBeatClaimRejections.map((rejection) => rejection.beatId).join(', ')}`
        )
      }
      result = finalizeChapterOutlineCandidate(
        stripRejectedBeatClaims(
          candidateWithDeferred,
          strippedBeatClaimRejections.map((rejection) => rejection.beatId)
        ),
        state,
        chapterIndex,
        beatBudget
      )
    } else if (lastCandidate && lastBeatClaimRejections.length > 0) {
      strippedBeatClaimRejections = lastBeatClaimRejections.filter((rejection) =>
        candidateHasBeatClaim(lastCandidate, rejection.beatId)
      )
      logger.warn(
        `[MuseFlow] 第 ${chapterIndex + 1} 章即时大纲连续 ${MAX_JIT_OUTLINE_ATTEMPTS} 次认领未在 description 中呈现的节拍，已自动剥离认领：${strippedBeatClaimRejections.map((rejection) => rejection.beatId).join(', ')}`
      )
      result = finalizeChapterOutlineCandidate(
        stripRejectedBeatClaims(
          lastCandidate,
          strippedBeatClaimRejections.map((rejection) => rejection.beatId)
        ),
        state,
        chapterIndex,
        beatBudget
      )
    } else if (lastCandidate && zeroClaimRejected) {
      if (hardMandatoryBeatPressure || zeroClaimEscalation) {
        // 高压/零认领升级下重试仍零认领：中止本章转人工。再放行只会让幕末
        // pending-beats-at-boundary 以更高代价爆发，或让零认领连击继续扩大
        // （与伏笔严格模式同一处置哲学）。
        throw new Error(
          hardMandatoryBeatPressure
            ? `第 ${chapterIndex + 1} 章即时大纲在幕边界高压状态（未消费 mandatory beats 多于幕内剩余章节）下连续 ${MAX_JIT_OUTLINE_ATTEMPTS} 次未认领任何 mandatory beat，已中止本章。请重新运行本章生成；若模型持续不认领，可运行 adjust-act 延长本幕，或人工修订大纲后再继续。`
            : `第 ${chapterIndex + 1} 章即时大纲在连续零认领升级压力（此前已连续 ${zeroClaimStreak} 章零认领）下连续 ${MAX_JIT_OUTLINE_ATTEMPTS} 次未认领任何 mandatory beat，已中止本章。请重新运行本章生成；若模型持续不认领，请人工修订大纲后再继续。`
        )
      }
      // 中压（配速）下重试仍零认领：软着陆。配速压力的意义是提前给消费机会，
      // 而不是把章节挡死；未消费节拍保留给后续章节，幕末硬闸判定不变。
      pacingZeroClaimAccepted = true
      logger.warn(
        `[MuseFlow] 第 ${chapterIndex + 1} 章即时大纲在幕边界配速压力下连续 ${MAX_JIT_OUTLINE_ATTEMPTS} 次未认领任何 mandatory beat，本章按零认领软着陆，未消费节拍保留给后续章节`
      )
      result = finalizeChapterOutlineCandidate(lastCandidate, state, chapterIndex, beatBudget)
    } else {
      throw new Error(`第 ${chapterIndex + 1} 章即时大纲生成失败：未返回可执行大纲`)
    }
  }

  // 高压/零认领升级下「认领被拒→剥离」与「零认领」同等处置：剥离只是换了一条到达
  // 零认领的路径，放行同样会在幕末留下比剩余章数更多的未消费节拍（或让零认领连击
  // 继续扩大）。循环内的零认领打回覆盖常规路径，这里兜住剥离兜底分支，保证强制认领
  // 模式下大纲必须持有有效 mandatory beat 认领。
  // 中压（配速）剥离到零认领时软着陆，不中止（ stripped 警告已记录）。
  if (
    (hardMandatoryBeatPressure || zeroClaimEscalation) &&
    (result.claimedMandatoryBeatIds ?? []).length === 0
  ) {
    throw new Error(
      hardMandatoryBeatPressure
        ? `第 ${chapterIndex + 1} 章即时大纲在幕边界高压状态（未消费 mandatory beats 多于幕内剩余章节）下未能形成有效 mandatory beat 认领（认领未通过 description 呈现校验或始终未认领），已中止本章。请重新运行本章生成；若模型持续无法认领，可运行 adjust-act 延长本幕，或人工修订大纲后再继续。`
        : `第 ${chapterIndex + 1} 章即时大纲在连续零认领升级压力（此前已连续 ${zeroClaimStreak} 章零认领）下未能形成有效 mandatory beat 认领（认领未通过 description 呈现校验或始终未认领），已中止本章。请重新运行本章生成；若模型持续无法认领，请人工修订大纲后再继续。`
    )
  }

  const newOutline = [...state.outline]
  const newOutlineItem: ReducedGraphState['outline'][number] = {
    number: chapterIndex + 1,
    title: result.title,
    description: result.description,
    introducedCharacters: result.introducedCharacters ?? [],
    claimedBeats: result.claimedBeats ?? [],
    claimedMandatoryBeatIds: result.claimedMandatoryBeatIds ?? [],
    touchedCharacterIds: result.touchedCharacterIds ?? [],
    touchedItemIds: result.touchedItemIds ?? [],
    touchedLocationIds: result.touchedLocationIds ?? [],
    claimedBeatIds: result.claimedBeatIds ?? [],
    fulfilledForeshadowIds: result.fulfilledForeshadowIds ?? [],
    deferredForeshadowIds: result.deferredForeshadowIds ?? [],
    introducedForeshadowIds: result.introducedForeshadowIds ?? [],
    resolvedTaskIds: result.resolvedTaskIds ?? [],
    createdTaskIds: result.createdTaskIds ?? [],
  }
  newOutline[chapterIndex] = newOutlineItem

  const pendingIssues: Issue[] = []
  if (autoDeferredForeshadowIds.length > 0) {
    pendingIssues.push({
      id: `outline-foreshadow-auto-deferred-${chapterIndex}`,
      ruleId: 'outline.foreshadow-compliance',
      type: 'outline_foreshadow',
      severity: 'warning',
      description: `即时大纲连续 ${MAX_JIT_OUTLINE_ATTEMPTS} 次未对候选伏笔 ${autoDeferredForeshadowIds.join(', ')} 作出裁决，已自动顺延至 deferredForeshadowIds。`,
      source: 'outline_compliance',
    })
  }
  if (pacingZeroClaimAccepted) {
    pendingIssues.push({
      id: `outline-zero-claim-pacing-${chapterIndex}`,
      ruleId: 'outline.zero-claim-under-pacing-pressure',
      type: 'outline_beat_claim',
      severity: 'warning',
      description: `即时大纲在幕边界配速压力下连续 ${MAX_JIT_OUTLINE_ATTEMPTS} 次未认领 mandatory beat，本章按零认领软着陆；未消费节拍保留给后续章节，幕末硬闸判定不变。`,
      source: 'outline_compliance',
    })
  }
  if (strippedBeatClaimRejections.length > 0) {
    pendingIssues.push({
      id: `outline-beat-claim-stripped-${chapterIndex}`,
      ruleId: 'outline.beat-claim-stripped',
      type: 'outline_beat_claim',
      severity: 'warning',
      description: `即时大纲连续 ${MAX_JIT_OUTLINE_ATTEMPTS} 次认领未在 description 中呈现的节拍，已自动剥离认领：${strippedBeatClaimRejections.map((rejection) => `${rejection.beatId}（${rejection.reason}）`).join('；')}。相关节拍保持未消费状态，由后续章节重新规划。`,
      source: 'outline_compliance',
    })
  }

  logger.info(`[MuseFlow] 已即时生成第 ${chapterIndex + 1} 章大纲：${result.title}`)
  logger.info(`  ${result.description}`)
  if (result.claimedBeats && result.claimedBeats.length > 0) {
    logger.info(`  声称推进节拍：${result.claimedBeats.join('、')}`)
  }

  return { state: { ...state, outline: newOutline }, pendingIssues }
}

const MAX_JIT_CONFLICT_CANDIDATES = 3

function conflictFingerprint(conflicts: readonly Conflict[]): string {
  return JSON.stringify(
    conflicts
      .map(({ type, subject, attribute, oldValue, newValue }) => ({
        type,
        subject,
        attribute,
        oldValue,
        newValue,
      }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  )
}

function stateWithOutlineProposal(
  state: ReducedGraphState,
  chapterIndex: number,
  proposal: OutlineRevisionProposal
): ReducedGraphState {
  const outline = [...state.outline]
  const current = outline[chapterIndex]
  outline[chapterIndex] = {
    ...current,
    number: current?.number ?? chapterIndex + 1,
    title: proposal.revisedTitle ?? current?.title ?? `第${chapterIndex + 1}章`,
    description: proposal.revisedDescription,
  }
  return { ...state, outline }
}

async function validateOutlineState(
  state: ReducedGraphState,
  chapterIndex: number,
  source: ChapterContextSource,
  proposalMode: 'generate' | 'omit'
): Promise<void> {
  if (isRuntimeContext(source)) {
    await prepareStoryStateForChapterCached(state, chapterIndex, source, { proposalMode })
    return
  }
  await prepareStoryStateForChapter(state, chapterIndex, getProvider(source), {
    proposalMode,
  })
}

type OutlineCandidateResolution =
  | { status: 'accepted'; state: ReducedGraphState }
  | { status: 'conflict'; error: BlockingConflictError }

type OutlineProposalPolicy = 'apply' | 'expose' | 'discard'

async function reconcileOutlineCandidate(
  state: ReducedGraphState,
  chapterIndex: number,
  source: ChapterContextSource,
  proposalPolicy: OutlineProposalPolicy
): Promise<OutlineCandidateResolution> {
  let blockingError: BlockingConflictError
  try {
    await validateOutlineState(
      state,
      chapterIndex,
      source,
      proposalPolicy === 'discard' ? 'omit' : 'generate'
    )
    return { status: 'accepted', state }
  } catch (err) {
    if (!isBlockingConflictError(err)) throw err
    blockingError = err
  }

  if (proposalPolicy === 'discard') {
    return {
      status: 'conflict',
      error: new BlockingConflictError([...blockingError.conflicts], chapterIndex),
    }
  }

  const proposal = blockingError.proposal
  if (!proposal) {
    return {
      status: 'conflict',
      error: new BlockingConflictError([...blockingError.conflicts], chapterIndex),
    }
  }

  const proposedState = stateWithOutlineProposal(state, chapterIndex, proposal)
  try {
    await validateOutlineState(proposedState, chapterIndex, source, 'omit')
  } catch (err) {
    if (!isBlockingConflictError(err)) throw err
    return {
      status: 'conflict',
      error: new BlockingConflictError([...blockingError.conflicts], chapterIndex),
    }
  }

  if (proposalPolicy === 'apply') {
    logger.info(`[MuseFlow] 第 ${chapterIndex + 1} 章临时大纲修订已通过权威事实校验`)
    return { status: 'accepted', state: proposedState }
  }

  return {
    status: 'conflict',
    error: new BlockingConflictError([...blockingError.conflicts], chapterIndex, proposal),
  }
}

export interface ExpandOutlineOptions {
  beatClaimRejection?: BeatClaimPlanningRejection
  zeroProgressRejection?: ZeroProgressRejection
}

export async function expandOutlineForChapter(
  state: ReducedGraphState,
  chapterIndex: number,
  source: ChapterContextSource,
  options?: ExpandOutlineOptions
): Promise<ExpandedOutline> {
  return expandOutlineForChapterInternal(state, chapterIndex, source, {
    attempt: 0,
    ...(options?.beatClaimRejection ? { beatClaimRejection: options.beatClaimRejection } : {}),
    ...(options?.zeroProgressRejection
      ? { zeroProgressRejection: options.zeroProgressRejection }
      : {}),
  })
}

async function expandOutlineForChapterInternal(
  state: ReducedGraphState,
  chapterIndex: number,
  source: ChapterContextSource,
  semanticRetry: SemanticPlanningRetryContext
): Promise<ExpandedOutline> {
  const provider = getProvider(source)
  let pendingIssues: Issue[] = []
  state = canonicalizeStateForeshadowClaims(state, chapterIndex)
  state = canonicalizeStateCoveredBeatClaims(state, chapterIndex)
  state = await autoExtendCurrentActBeforeOutline(state, chapterIndex)
  const jitBaseState = state
  const generatedSemanticRetry = semanticRetry.outlineOrigin === 'jit-generated'
  // 正文阶段驳回反馈（节拍驳回 / 跨章零增量）触发的大纲重生成：即使已有 description
  // 也强制重新生成，但状态协调仍走 'apply'（与常规 JIT 生成一致，自动协调冲突而非丢弃候选）。
  const outlineRegenRequested = Boolean(
    semanticRetry.beatClaimRejection ?? semanticRetry.zeroProgressRejection
  )
  const persistedOutline =
    Boolean(state.outline[chapterIndex]?.description.trim()) &&
    !generatedSemanticRetry &&
    !outlineRegenRequested

  if (persistedOutline) {
    const resolution = await reconcileOutlineCandidate(state, chapterIndex, source, 'expose')
    if (resolution.status === 'conflict') {
      throw resolution.error
    }
    state = resolution.state
  } else {
    const failures: BlockingConflictError[] = []
    let resolved:
      | {
          state: ReducedGraphState
          pendingIssues: Issue[]
        }
      | undefined

    for (let attempt = 0; attempt < MAX_JIT_CONFLICT_CANDIDATES; attempt++) {
      const outlineResult = await generateChapterOutlineIfNeeded(
        jitBaseState,
        chapterIndex,
        provider,
        {
          ...(generatedSemanticRetry || outlineRegenRequested ? { force: true } : {}),
          ...(semanticRetry.rejection
            ? { foreshadowPlanningRejection: semanticRetry.rejection }
            : {}),
          ...(semanticRetry.beatClaimRejection
            ? { beatClaimRejection: semanticRetry.beatClaimRejection }
            : {}),
          ...(semanticRetry.zeroProgressRejection
            ? { zeroProgressRejection: semanticRetry.zeroProgressRejection }
            : {}),
        }
      )
      const resolution = await reconcileOutlineCandidate(
        outlineResult.state,
        chapterIndex,
        source,
        generatedSemanticRetry ? 'discard' : 'apply'
      )
      if (resolution.status === 'accepted') {
        resolved = {
          state: resolution.state,
          pendingIssues: outlineResult.pendingIssues,
        }
        break
      }

      failures.push(resolution.error)
      logger.warn(
        `[MuseFlow] 第 ${chapterIndex + 1} 章临时大纲候选 ${attempt + 1}/${MAX_JIT_CONFLICT_CANDIDATES} 未通过权威事实校验，已丢弃并重新生成`
      )
    }

    if (!resolved) {
      const fingerprints = failures.map((error) => conflictFingerprint(error.conflicts))
      const firstFingerprint = fingerprints[0]
      const stable =
        firstFingerprint !== undefined &&
        fingerprints.every((fingerprint) => fingerprint === firstFingerprint)
      if (stable) {
        const last = failures.at(-1)
        if (last) {
          throw new BlockingConflictError([...last.conflicts], chapterIndex)
        }
      }
      throw new Error(
        `第 ${chapterIndex + 1} 章连续 ${MAX_JIT_CONFLICT_CANDIDATES} 个临时大纲候选均未通过权威事实校验，且冲突集合不稳定；请重新运行本章生成。`
      )
    }

    state = resolved.state
    pendingIssues = resolved.pendingIssues
  }

  const currentOutline = state.outline[chapterIndex]
  const conflictingDecisionIds = currentOutline
    ? getConflictingForeshadowDecisionIds(currentOutline)
    : []
  if (currentOutline && conflictingDecisionIds.length > 0) {
    logger.warn(
      `[MuseFlow] 第 ${chapterIndex + 1} 章大纲存在相互冲突的伏笔裁决，将定向修订：${conflictingDecisionIds.join(', ')}`
    )
    const rejection: ForeshadowPlanningRejection = {
      missingDeclarationIds: [],
      missingEventIds: [],
      incorrectlyDeferredIds: [],
      conflictingDecisionIds,
      currentOutline: {
        title: currentOutline.title,
        description: currentOutline.description,
      },
    }
    const outlineResult = await generateChapterOutlineIfNeeded(
      { ...state, chapterPlan: null },
      chapterIndex,
      provider,
      {
        force: true,
        foreshadowPlanningRejection: rejection,
      }
    )
    const resolution = await reconcileOutlineCandidate(
      outlineResult.state,
      chapterIndex,
      source,
      'apply'
    )
    if (resolution.status === 'conflict') {
      throw resolution.error
    }
    state = resolution.state
    pendingIssues = [...pendingIssues, ...outlineResult.pendingIssues]
  }

  let outlineItem = state.outline[chapterIndex]
  if (!outlineItem) {
    throw new Error(`第 ${chapterIndex + 1} 章大纲不存在`)
  }

  let capacityResult = ensureActCapacityAfterForeshadowAdjudication(
    state,
    chapterIndex,
    outlineItem.fulfilledForeshadowIds ?? []
  )
  state = capacityResult.state
  outlineItem = state.outline[chapterIndex]
  if (!outlineItem) {
    throw new Error(`第 ${chapterIndex + 1} 章大纲在幕边界调整后不存在`)
  }

  if (capacityResult.requiresManualResolution) {
    const proposal = capacityResult.proposal
    const command = proposal
      ? formatActBoundaryAdjustmentCommand(state.story.id, proposal)
      : `museflow adjust-act ${state.story.id} --act ... --end-chapter ...`
    throw new Error(
      [
        `伏笔裁决后自动延长第 ${proposal?.actIndex ?? '?'} 幕失败：${capacityResult.reason ?? '需要人工调整幕边界。'}`,
        `请先运行：${command}`,
      ].join('\n')
    )
  }

  const nextItem = state.outline[chapterIndex + 1]
  const foreshadowSchedule = getForeshadowScheduleContext(state, chapterIndex)
  const scheduledForeshadowIds = foreshadowSchedule.deadlineCandidateIds
  const opportunityForeshadowIds = foreshadowSchedule.opportunityCandidateIds
  const plannerForeshadowConstraintContext = computeForeshadowConstraintContext(
    state,
    chapterIndex,
    scheduledForeshadowIds
  )
  const foreshadowObligations = buildForeshadowPlanningObligations(
    state,
    foreshadowSchedule,
    plannerForeshadowConstraintContext.mustFulfillIds
  )
  const baseForeshadowPlanningInput =
    foreshadowObligations.length > 0 || semanticRetry.rejection
      ? {
          ...(foreshadowObligations.length > 0 ? { foreshadowObligations } : {}),
          ...(semanticRetry.rejection
            ? { foreshadowPlanningRejection: semanticRetry.rejection }
            : {}),
        }
      : undefined
  const mustFulfillForeshadowIdSet = new Set(
    foreshadowObligations
      .filter((obligation) => obligation.mustFulfillThisChapter)
      .map((obligation) => obligation.id)
  )
  const planningConfig = getChapterPlanningConfig(state.genre)
  const foreshadowCapacity = normalizeForeshadowCapacity(
    planningConfig.foreshadowMaxFulfillmentsPerChapter
  )
  const opportunityForeshadowIdSet = new Set(opportunityForeshadowIds)

  const judgeCoreSections: CoreSectionJudge = (description, sections) =>
    judgeCoreSectionsWithModel(provider, description, sections)

  const nextBoundaryHint = buildNextChapterBoundaryHint(state.outline, chapterIndex, state.storyArc)
  const pendingTasksHint = await reconcileOutlineWithState(
    state,
    chapterIndex,
    planningConfig,
    provider
  )
  let boundaryHints = [nextBoundaryHint].filter((h) => h.length > 0)

  // 如果下一章进入新幕，优先使用幕边界提示；否则使用下一章具体描述作为边界
  const currentAct = state.storyArc
    ? state.storyArc.acts.find(
        (a) => chapterIndex + 1 >= a.startChapter && chapterIndex + 1 <= a.endChapter
      )
    : undefined
  const nextAct = state.storyArc
    ? state.storyArc.acts.find(
        (a) => chapterIndex + 2 >= a.startChapter && chapterIndex + 2 <= a.endChapter
      )
    : undefined
  const entersNewAct = currentAct && nextAct && currentAct.index !== nextAct.index

  const nextBoundaryForPlanner = entersNewAct
    ? nextBoundaryHint
    : nextItem?.description
      ? `\n【后续章节边界】第${nextItem.number}章「${nextItem.title}」大纲：${nextItem.description}`
      : nextBoundaryHint

  const declarations = [
    { label: '【本章伏笔调度候选】', ids: scheduledForeshadowIds },
    { label: '【本章自然回收候选】', ids: opportunityForeshadowIds },
    { label: '【本章兑现伏笔】', ids: outlineItem.fulfilledForeshadowIds },
    { label: '【本章顺延伏笔】', ids: outlineItem.deferredForeshadowIds },
    { label: '【本章认领 mandatory beats】', ids: outlineItem.claimedMandatoryBeatIds },
    { label: '【本章认领 key beats】', ids: outlineItem.claimedBeatIds },
    { label: '【本章引入伏笔】', ids: outlineItem.introducedForeshadowIds },
    { label: '【本章出场角色】', ids: outlineItem.touchedCharacterIds },
    { label: '【本章涉及物品】', ids: outlineItem.touchedItemIds },
    { label: '【本章涉及地点】', ids: outlineItem.touchedLocationIds },
    { label: '【本章解决任务】', ids: outlineItem.resolvedTaskIds },
    { label: '【本章创建任务】', ids: outlineItem.createdTaskIds },
  ]
  const structuredDeclarations = declarations
    .filter((d) => d.ids && d.ids.length > 0)
    .map((d) => `${d.label}${d.ids!.join(', ')}`)

  const formattedOutline = [
    `第${toDisplayChapterNumber(chapterIndex)}章：${outlineItem.title}`,
    outlineItem.description,
    nextBoundaryForPlanner,
    pendingTasksHint,
    structuredDeclarations.join('\n'),
  ]
    .filter((part) => part.length > 0)
    .join('\n')

  let chapterPlan: ChapterPlan | null =
    state.chapterPlan?.chapterIndex === chapterIndex
      ? normalizeReusableChapterPlan(state.chapterPlan, chapterIndex, state)
      : null
  let currentConstraints = filterVerifiedConstraintsForChapter(
    state.verifiedConstraints,
    state.storyArc,
    chapterIndex
  )
  // 前置幕边界压力提示：当当前幕存在 mandatory beat 消费风险时，提前向规划层注入约束，
  // 避免到了幕末才发现 pending beats 无法消费完。
  const arcStatusConstraint = state.storyArc
    ? buildArcStatusConstraint(
        state.storyArc,
        state.actProgress ?? {},
        chapterIndex,
        planningConfig.bookClosingPhaseRatio,
        new Set(
          state.storyMemory ? getVerifiedBeatsFromMemory(state.storyMemory, state.storyArc) : []
        )
      )
    : undefined
  if (arcStatusConstraint) {
    currentConstraints = [
      ...currentConstraints,
      createGenericVerifiedConstraint(arcStatusConstraint),
    ]
  }

  // 首次生成规划
  if (!chapterPlan) {
    const planState: ReducedGraphState = {
      ...state,
      currentChapterIndex: chapterIndex,
      verifiedConstraints: currentConstraints,
      chapterPlan: null,
    }
    const planResult = await plan_chapter_with_override(
      provider,
      planState,
      formattedOutline,
      baseForeshadowPlanningInput
    )
    chapterPlan = planResult.chapterPlan ?? null
    if (chapterPlan) {
      state = { ...state, chapterPlan }
    }
  }

  if (!chapterPlan) {
    throw new Error(`第 ${chapterIndex + 1} 章详细计划生成失败`)
  }

  const outlineFulfilledForeshadowIds = outlineItem.fulfilledForeshadowIds ?? []
  const outlineDeferredForeshadowIds = outlineItem.deferredForeshadowIds ?? []
  let planEvaluation = evaluateScheduledForeshadowPlanEvidence(
    chapterPlan,
    outlineFulfilledForeshadowIds,
    outlineDeferredForeshadowIds,
    chapterIndex,
    state.storyMemory
  )
  if (hasMissingScheduledForeshadowPlanEvidence(planEvaluation.missing)) {
    const firstMissingEvidenceIds = getMissingForeshadowPlanEvidenceIds(planEvaluation.missing)
    logScheduledForeshadowPlanAttempt(
      chapterIndex,
      '章节规划',
      1,
      2,
      planEvaluation.missing,
      foreshadowCapacity,
      firstMissingEvidenceIds.length > 0 &&
        firstMissingEvidenceIds.every((id) => opportunityForeshadowIdSet.has(id))
    )
    const missingEvidenceIds = Array.from(
      new Set([...planEvaluation.missing.declarationIds, ...planEvaluation.missing.eventIds])
    )
    const correctionInstructions = [
      ...(missingEvidenceIds.length > 0
        ? [
            `必须将缺失证据的精确 ID ${missingEvidenceIds.join(', ')} 同时写入 fulfilledForeshadowIds，并在 expectedEvents 中生成对应的 foreshadow-fulfill 事件。`,
          ]
        : []),
      ...(planEvaluation.missing.forbiddenFulfillmentIds.length > 0
        ? [
            `必须从 fulfilledForeshadowIds 和 foreshadow-fulfill expectedEvents 中移除大纲已顺延的精确 ID：${planEvaluation.missing.forbiddenFulfillmentIds.join(', ')}。`,
          ]
        : []),
    ]
    currentConstraints = [
      ...currentConstraints,
      createGenericVerifiedConstraint(
        `【伏笔兑现修正】章节规划未通过结构化证据校验：${formatMissingScheduledForeshadowPlanEvidence(planEvaluation.missing)}。${correctionInstructions.join('')}`
      ),
    ]
    const planState: ReducedGraphState = {
      ...state,
      currentChapterIndex: chapterIndex,
      verifiedConstraints: currentConstraints,
      chapterPlan: null,
    }
    const planResult = await plan_chapter_with_override(provider, planState, formattedOutline, {
      ...(baseForeshadowPlanningInput ?? {}),
      foreshadowPlanningRejection: {
        missingDeclarationIds: planEvaluation.missing.declarationIds,
        missingEventIds: planEvaluation.missing.eventIds,
        incorrectlyDeferredIds: [],
        ...(planEvaluation.missing.forbiddenFulfillmentIds.length > 0
          ? { forbiddenFulfillmentIds: planEvaluation.missing.forbiddenFulfillmentIds }
          : {}),
      },
    })
    const replanned = planResult.chapterPlan ?? null
    if (!replanned) {
      throw new Error(`第 ${chapterIndex + 1} 章详细计划生成失败`)
    }
    planEvaluation = evaluateScheduledForeshadowPlanEvidence(
      replanned,
      outlineFulfilledForeshadowIds,
      outlineDeferredForeshadowIds,
      chapterIndex,
      state.storyMemory
    )
    if (hasMissingScheduledForeshadowPlanEvidence(planEvaluation.missing)) {
      const secondMissingEvidenceIds = getMissingForeshadowPlanEvidenceIds(planEvaluation.missing)
      logScheduledForeshadowPlanAttempt(
        chapterIndex,
        '章节规划',
        2,
        2,
        planEvaluation.missing,
        foreshadowCapacity,
        secondMissingEvidenceIds.length > 0 &&
          secondMissingEvidenceIds.every((id) => opportunityForeshadowIdSet.has(id))
      )
      const missingForeshadowIds = secondMissingEvidenceIds
      const missingMustFulfillIds = missingForeshadowIds.filter((id) =>
        mustFulfillForeshadowIdSet.has(id)
      )
      if (missingMustFulfillIds.length > 0) {
        throw new Error(
          `第 ${chapterIndex + 1} 章章节规划无法为本章必须回收的伏笔生成结构化证据：${missingMustFulfillIds.join(', ')}。已完成一次定向纠正，禁止自动顺延。`
        )
      }
      const missingOpportunityIds = missingForeshadowIds.filter((id) =>
        opportunityForeshadowIdSet.has(id)
      )
      const missingDeadlineIds = missingForeshadowIds.filter(
        (id) => !opportunityForeshadowIdSet.has(id)
      )
      if (missingDeadlineIds.length > 0) {
        logger.warn(
          `[MuseFlow] 第 ${chapterIndex + 1} 章章节规划连续 2 次无法为大纲声称伏笔生成结构化证据，已自动顺延：${missingDeadlineIds.join(', ')}`
        )
      }
      if (missingOpportunityIds.length > 0) {
        logger.info(
          `[MuseFlow] 第 ${chapterIndex + 1} 章自然回收机会 ${missingOpportunityIds.join(', ')} 未形成完整规划证据，已无损顺延`
        )
      }

      const deferred = deferForeshadowClaims(
        state,
        chapterIndex,
        planEvaluation.plan,
        missingForeshadowIds
      )
      state = deferred.state
      outlineItem = state.outline[chapterIndex] ?? outlineItem
      chapterPlan = deferred.plan
      planEvaluation = {
        missing: { declarationIds: [], eventIds: [], forbiddenFulfillmentIds: [] },
        plan: chapterPlan,
      }

      if (missingDeadlineIds.length > 0) {
        pendingIssues.push({
          id: `plan-foreshadow-auto-deferred-${chapterIndex}`,
          ruleId: 'outline.foreshadow-compliance',
          type: 'outline_foreshadow',
          severity: 'warning',
          description: `章节规划连续 2 次无法为大纲声称的伏笔 ${missingDeadlineIds.join(', ')} 生成结构化兑现证据，已自动将其顺延。`,
          source: 'outline_compliance',
        })
      }
    }
  }

  chapterPlan = planEvaluation.plan
  state = { ...state, chapterPlan }
  const finalCapacityResult = ensureActCapacityAfterForeshadowAdjudication(
    state,
    chapterIndex,
    chapterPlan.fulfilledForeshadowIds ?? []
  )
  state = finalCapacityResult.state
  if (finalCapacityResult.requiresManualResolution) {
    const proposal = finalCapacityResult.proposal
    const command = proposal
      ? formatActBoundaryAdjustmentCommand(state.story.id, proposal)
      : `museflow adjust-act ${state.story.id} --act ... --end-chapter ...`
    throw new Error(
      [
        `伏笔裁决后自动延长第 ${proposal?.actIndex ?? '?'} 幕失败：${finalCapacityResult.reason ?? '需要人工调整幕边界。'}`,
        `请先运行：${command}`,
      ].join('\n')
    )
  }

  if (chapterIndex > 0) {
    const previousContent = await readChapterContent(state.story.outputDir, chapterIndex)
    const maxTimeAnchorAttempts = 2
    let timeAnchorAttempts = 0
    while (timeAnchorAttempts < maxTimeAnchorAttempts) {
      const validation = await validateChapterTimeAnchor(chapterPlan, previousContent, provider)
      if (validation.valid) break

      logger.warn(`[MuseFlow] ${validation.reason}`)

      timeAnchorAttempts++
      const reason = validation.reason ?? 'chapterTimeAnchor 与上一章正文不一致'
      if (timeAnchorAttempts >= maxTimeAnchorAttempts) {
        logger.warn('[MuseFlow] 时间锚点重新规划后仍不一致，将移除本章时间锚点继续')
        const { chapterTimeAnchor, ...restPlan } = chapterPlan
        void chapterTimeAnchor
        chapterPlan = restPlan
        pendingIssues = [
          ...pendingIssues,
          {
            id: `time-anchor-removed-${chapterIndex}`,
            ruleId: 'continuity.time-anchor',
            type: 'continuity',
            severity: 'warning',
            description: `本章 chapterTimeAnchor 经过 ${maxTimeAnchorAttempts} 次重新规划仍与上一章正文不一致，已移除：${reason}。`,
            source: 'consistency',
            retryStrategy: 'fix',
          },
        ]
        break
      }

      logger.warn('[MuseFlow] 时间锚点与上一章正文不一致，将带约束重新规划...')
      currentConstraints = [
        ...currentConstraints,
        createGenericVerifiedConstraint(
          `【时间锚点修正】${reason}。本章必须自然承接上一章结尾的位置、动作和时间；如果确实需要跳转，必须在 chapterTimeAnchor、timeline 和首个 section 中明确说明跳转。`
        ),
      ]

      const planState: ReducedGraphState = {
        ...state,
        currentChapterIndex: chapterIndex,
        verifiedConstraints: currentConstraints,
        chapterPlan: null,
      }
      const planResult = await plan_chapter_with_override(
        provider,
        planState,
        formattedOutline,
        baseForeshadowPlanningInput
      )
      const replanned = planResult.chapterPlan ?? null
      if (!replanned) break
      const replanEvaluation = evaluateScheduledForeshadowPlanEvidence(
        replanned,
        outlineFulfilledForeshadowIds,
        outlineDeferredForeshadowIds,
        chapterIndex,
        state.storyMemory
      )
      if (hasMissingScheduledForeshadowPlanEvidence(replanEvaluation.missing)) {
        throw buildScheduledForeshadowPlanError(
          chapterIndex,
          '时间锚点重规划',
          replanEvaluation.missing,
          foreshadowCapacity
        )
      }
      chapterPlan = replanEvaluation.plan
      state = { ...state, chapterPlan }
    }
  }

  // 强制预算循环：校验核心事件占比和非核心段落字数，不合格则带约束重试
  const outlineDescription = outlineItem.description

  let budgetValidation = await validateChapterPlanBudget(
    chapterPlan,
    planningConfig,
    outlineDescription,
    judgeCoreSections
  )
  let budgetAttempts = 0
  const maxBudgetAttempts = 3

  while (!budgetValidation.valid && budgetAttempts < maxBudgetAttempts) {
    logger.warn(`[MuseFlow] ${budgetValidation.reason}`)
    logger.warn('[MuseFlow] 章节规划重心偏离大纲核心事件，将使用约束重新规划...')

    const focusConstraint = buildFocusConstraint(budgetValidation, planningConfig)
    currentConstraints = [...currentConstraints, createGenericVerifiedConstraint(focusConstraint)]

    const planState: ReducedGraphState = {
      ...state,
      currentChapterIndex: chapterIndex,
      verifiedConstraints: currentConstraints,
    }
    const planResult = await plan_chapter_with_override(
      provider,
      planState,
      formattedOutline,
      baseForeshadowPlanningInput
    )
    const replanned = planResult.chapterPlan ?? null
    if (!replanned) break
    const replanEvaluation = evaluateScheduledForeshadowPlanEvidence(
      replanned,
      outlineFulfilledForeshadowIds,
      outlineDeferredForeshadowIds,
      chapterIndex,
      state.storyMemory
    )
    if (hasMissingScheduledForeshadowPlanEvidence(replanEvaluation.missing)) {
      throw buildScheduledForeshadowPlanError(
        chapterIndex,
        '预算重规划',
        replanEvaluation.missing,
        foreshadowCapacity
      )
    }

    chapterPlan = replanEvaluation.plan
    state = { ...state, chapterPlan }
    budgetValidation = await validateChapterPlanBudget(
      chapterPlan,
      planningConfig,
      outlineDescription,
      judgeCoreSections
    )
    budgetAttempts++
  }

  if (!budgetValidation.valid) {
    logger.warn(
      `[MuseFlow] 经过 ${maxBudgetAttempts} 次预算修正仍存在重心问题：${budgetValidation.reason}，将使用最新规划继续`
    )
    pendingIssues = [
      {
        id: `outline-budget-failure-${chapterIndex}`,
        ruleId: 'outline.density',
        type: 'outline_density',
        severity: 'warning',
        description: `经过 ${maxBudgetAttempts} 次预算修正仍存在重心问题：${budgetValidation.reason}。`,
      },
    ]
  } else if (budgetAttempts > 0) {
    logger.info('[MuseFlow] 重新规划后重心已修正')
  }

  chapterPlan = reconcileChapterPlanBeatContract(chapterPlan, state.outline[chapterIndex])

  const semanticOutline = state.outline[chapterIndex]
  if (state.storyMemory && semanticOutline) {
    const semanticJudgments = await verifyForeshadowPlan({
      provider,
      memory: state.storyMemory,
      outline: semanticOutline,
      plan: chapterPlan,
      mandatoryIds: Array.from(mustFulfillForeshadowIdSet),
    })
    const verificationFailures = semanticJudgments.filter(
      (judgment) => judgment.verdict === 'verification_failed'
    )
    if (verificationFailures.length > 0) {
      throw new Error(
        `第 ${chapterIndex + 1} 章伏笔语义规划验证失败：${verificationFailures.map((judgment) => `${judgment.foreshadowId}（${judgment.reason}）`).join('、')}`
      )
    }

    const semanticRejections = semanticJudgments.filter(
      (judgment) => judgment.verdict === 'not_fulfilled' || judgment.verdict === 'uncertain'
    )
    const mandatoryRejections = semanticRejections.filter((judgment) => judgment.mandatory)

    if (mandatoryRejections.length > 0) {
      const rejectionIds = mandatoryRejections.map((judgment) => judgment.foreshadowId)
      const requiredFulfillmentIds = Array.from(mustFulfillForeshadowIdSet)
      const preservedFulfillmentIds = semanticJudgments
        .filter(
          (judgment) =>
            judgment.mandatory &&
            judgment.verdict === 'fulfilled' &&
            mustFulfillForeshadowIdSet.has(judgment.foreshadowId)
        )
        .map((judgment) => judgment.foreshadowId)
      const preservedFulfillmentIdSet = new Set(preservedFulfillmentIds)
      const regressedFulfillmentIds = Array.from(
        new Set([
          ...(semanticRetry.rejection?.regressedFulfillmentIds ?? []),
          ...(semanticRetry.rejection?.preservedFulfillmentIds ?? []).filter(
            (id) => !preservedFulfillmentIdSet.has(id)
          ),
        ])
      )
      const previousRejectionIds =
        semanticRetry.rejection?.semanticRejections?.map((item) => item.foreshadowId) ?? []
      const previousRejectionIdSet = new Set(previousRejectionIds)
      const madeStrictProgress =
        previousRejectionIds.length > 0 &&
        rejectionIds.length < previousRejectionIdSet.size &&
        rejectionIds.every((id) => previousRejectionIdSet.has(id))
      const semanticAttemptCount = semanticRetry.attempt + 1
      const semanticAttemptLimit = Math.max(
        BASE_SEMANTIC_PLANNING_ATTEMPTS,
        requiredFulfillmentIds.length + 1
      )
      const exhaustedHardLimit = semanticAttemptCount >= semanticAttemptLimit
      if (exhaustedHardLimit) {
        throw new Error(
          `第 ${chapterIndex + 1} 章伏笔语义规划连续 ${semanticAttemptCount} 次未通过：${rejectionIds.join(', ')}`
        )
      }

      const rejection: ForeshadowPlanningRejection = {
        missingDeclarationIds: [],
        missingEventIds: [],
        incorrectlyDeferredIds: [],
        requiredFulfillmentIds,
        preservedFulfillmentIds,
        regressedFulfillmentIds,
        currentOutline: {
          title: semanticOutline.title,
          description: semanticOutline.description,
        },
        semanticRejections: mandatoryRejections.map((judgment) => ({
          foreshadowId: judgment.foreshadowId,
          verdict: judgment.verdict === 'not_fulfilled' ? 'not_fulfilled' : ('uncertain' as const),
          reason: judgment.reason,
        })),
      }
      if (madeStrictProgress) {
        logger.info(
          `[MuseFlow] 第 ${chapterIndex + 1} 章伏笔语义规划取得进展，剩余 ${rejectionIds.length} 个未通过项，将继续定向修订`
        )
      }
      logger.warn(
        `[MuseFlow] 第 ${chapterIndex + 1} 章伏笔语义规划第 ${semanticAttemptCount}/${semanticAttemptLimit} 次未通过，将定向修订大纲与计划：${rejectionIds.join(', ')}`
      )

      const retried = await expandOutlineForChapterInternal(
        { ...state, chapterPlan: null },
        chapterIndex,
        source,
        {
          attempt: semanticRetry.attempt + 1,
          rejection,
          outlineOrigin: 'jit-generated',
        }
      )
      return {
        ...retried,
        pendingIssues: [...pendingIssues, ...(retried.pendingIssues ?? [])],
      }
    }

    const deferrableIds = semanticRejections.map((judgment) => judgment.foreshadowId)
    if (deferrableIds.length > 0) {
      const deferred = deferForeshadowClaims(state, chapterIndex, chapterPlan, deferrableIds)
      chapterPlan = deferred.plan
      state = { ...deferred.state, chapterPlan }
      outlineItem = state.outline[chapterIndex] ?? outlineItem

      const semanticCapacityResult = ensureActCapacityAfterForeshadowAdjudication(
        state,
        chapterIndex,
        chapterPlan.fulfilledForeshadowIds
      )
      state = semanticCapacityResult.state
      if (semanticCapacityResult.requiresManualResolution) {
        const proposal = semanticCapacityResult.proposal
        const command = proposal
          ? formatActBoundaryAdjustmentCommand(state.story.id, proposal)
          : `museflow adjust-act ${state.story.id} --act ... --end-chapter ...`
        throw new Error(
          [
            `伏笔语义裁决后自动延长第 ${proposal?.actIndex ?? '?'} 幕失败：${semanticCapacityResult.reason ?? '需要人工调整幕边界。'}`,
            `请先运行：${command}`,
          ].join('\n')
        )
      }
    }
  }

  logger.info(`[MuseFlow] 已动态展开第 ${outlineItem.number} 章详细大纲`)

  if (chapterPlan.sections.length > 0) {
    logger.info('\n📋 章节规划：')
    for (let i = 0; i < chapterPlan.sections.length; i++) {
      const section = chapterPlan.sections[i]
      if (!section) continue
      logger.info(
        `  ${i + 1}. ${section.title || '未命名'}${section.wordCount ? `（约${section.wordCount}字）` : ''}`
      )
      if (section.events && section.events.length > 0) {
        logger.info(`     事件：${section.events.join('、')}`)
      }
      if (section.characters && section.characters.length > 0) {
        logger.info(`     人物：${section.characters.join('、')}`)
      }
      if (section.timeMark) {
        logger.info(`     时间：${section.timeMark}`)
      }
    }
    logger.info('')
  }

  if (chapterPlan.chapterTimeAnchor) {
    logger.info(`[MuseFlow] 本章时间锚点：${chapterPlan.chapterTimeAnchor}`)
  }

  if (chapterPlan.taskResolutions && chapterPlan.taskResolutions.length > 0) {
    logger.info('[MuseFlow] 前章差事处理：')
    for (const tr of chapterPlan.taskResolutions) {
      logger.info(`  - ${tr.assignee}：${tr.description} → ${tr.resolution}（${tr.reason}）`)
    }
  }

  boundaryHints = [
    buildNextChapterBoundaryHint(state.outline, chapterIndex, state.storyArc),
  ].filter((hint) => hint.length > 0)

  if (boundaryHints.length > 0) {
    logger.info('边界约束：')
    for (const hint of boundaryHints) {
      const clean = hint
        .replace(/<\/?[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim()
      logger.info(`  ${clean}`)
    }
  }

  return {
    chapterPlan,
    boundaryHints,
    pendingIssues,
    outline: state.outline,
    story: state.story,
    totalChapters: state.totalChapters,
    storyArc: state.storyArc,
    chapters: state.chapters,
  }
}

function buildFocusConstraint(
  validation: ChapterPlanBudgetValidation,
  config: ReturnType<typeof getChapterPlanningConfig>
): string {
  const targetPercent = Math.round(config.coreEventRatioTarget * 100)
  const parts: string[] = [
    `【规划重心修正】前次规划 ${validation.reason}。`,
    `本次规划必须：`,
    `1) 核心事件场景字数之和 ≥ 总字数 × ${targetPercent}%，这是硬性要求；`,
    `2) 与核心事件无关的前章遗留差事必须选择 postponed 或 background（一句话带过），不得在 sections 中分配独立场景；`,
    `3) 任何非核心段落字数不得超过 ${config.maxNonCoreSectionWordCount} 字；`,
    `4) 核心事件场景不得少于 ${config.minCoreSections} 个，总场景数不得超过 ${config.maxSections} 个。`,
  ]
  return parts.join('')
}
