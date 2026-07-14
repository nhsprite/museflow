import { logger } from '../utils/logger.js'
import type { ReducedGraphState } from '../graph/state.js'
import { plan_chapter_with_override } from '../graph/nodes/planning.js'
import {
  buildNextChapterBoundaryHint,
  reconcileOutlineWithState,
} from '../utils/outline-boundary.js'
import { toDisplayChapterNumber } from '../utils/chapter-display.js'
import type { ChapterPlan, ChapterOutlineAgentInput } from '../agents/types.js'
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
import { charactersToString } from '../graph/utils/characters.js'
import { BlockingConflictError, isBlockingConflictError } from '../utils/errors.js'
import type { OutlineRevisionProposal } from './chapter-generation/outline-revision-proposal.js'
import type { Conflict } from '../types/story-state.js'
import {
  applyActBoundaryAdjustment,
  buildArcStatus,
  calculateBeatBudget,
  formatActBoundaryAdjustmentCommand,
  getActForChapter,
  proposeActExtensionAfterForeshadowAdjudication,
  proposeActBoundaryAdjustments,
  type ActBoundaryProposal,
} from '../utils/story-arc.js'
import { findMandatoryBeatById, getMandatoryBeatIdByText } from '../utils/mandatory-beat-ids.js'
import type { ChapterOutlineResult } from '../agents/chapter-outline.js'
import {
  createGenericVerifiedConstraint,
  filterVerifiedConstraintsForChapter,
  renderVerifiedConstraints,
} from '../utils/verified-constraints.js'
import {
  normalizeForeshadowCapacity,
  selectForeshadowsForChapter,
} from '../story-memory/foreshadow-policy.js'
import { normalizeStoryEvents } from '../story-memory/event-contract.js'

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

function isRuntimeContext(source: ChapterContextSource): source is RuntimeContext {
  return 'provider' in source
}

function getProvider(source: ChapterContextSource): ModelProvider {
  return isRuntimeContext(source) ? source.provider : source
}

function normalizeReusableChapterPlan(plan: ChapterPlan, chapterIndex: number): ChapterPlan | null {
  const result = normalizeStoryEvents(
    Array.isArray(plan.expectedEvents) ? plan.expectedEvents : [],
    {
      chapterIndex,
      mode: 'legacy',
    }
  )
  if (result.invalid.length > 0) {
    const first = result.invalid[0]!
    logger.warn(
      `[MuseFlow] 第 ${chapterIndex + 1} 章既有规划的 expectedEvents[${first.index}] 无法安全兼容：${first.reason}，将重新规划`
    )
    return null
  }
  return {
    ...plan,
    chapterIndex,
    expectedEvents: result.events,
  }
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

function getScheduledForeshadowIds(state: ReducedGraphState, chapterIndex: number): string[] {
  if (!state.storyMemory) return []
  const act = getActForChapter(state.storyArc, chapterIndex)
  if (!act) return []
  const chapterNumber = chapterIndex + 1
  const finalActIndex = state.storyArc?.acts.at(-1)?.index
  const planningConfig = getChapterPlanningConfig(state.genre)
  return selectForeshadowsForChapter(
    state.storyMemory,
    chapterNumber,
    planningConfig.foreshadowMaxFulfillmentsPerChapter,
    act.index === finalActIndex
  )
}

function buildScheduledForeshadowConstraint(state: ReducedGraphState, ids: string[]): string {
  const lines = ids.map((id) => {
    const foreshadow = state.storyMemory?.foreshadows[id]
    return `- ${id}（预期回收章节：${foreshadow?.expectedFulfillChapter ?? '全书结尾'}）：${foreshadow?.text ?? id}`
  })
  return `【伏笔调度候选】以下伏笔已进入预期回收窗口，作为本章回收候选。请逐一裁决：本章能自然回收的，放入 fulfilledForeshadowIds，并在 description 中安排正文可验证的真实剧情事件，不得虚假声称回收；与本章核心事件不相容、强行回收会损害章节质量的，放入 deferredForeshadowIds 顺延。每个候选 ID 必须出现在且仅出现在这两个列表之一，不得遗漏。候选列表：\n${lines.join('\n')}`
}

function getMissingScheduledForeshadowIds(
  fulfilledForeshadowIds: string[] | undefined,
  scheduledForeshadowIds: string[]
): string[] {
  const fulfilled = new Set(fulfilledForeshadowIds ?? [])
  return scheduledForeshadowIds.filter((id) => !fulfilled.has(id))
}

interface ScheduledForeshadowPlanEvidence {
  declarationIds: string[]
  eventIds: string[]
}

interface ScheduledForeshadowPlanEvaluation {
  missing: ScheduledForeshadowPlanEvidence
  plan: ChapterPlan
}

/**
 * 以大纲裁决的 fulfilledForeshadowIds 为基准校验章节规划：
 * plan 的 fulfilledForeshadowIds 与 foreshadow-fulfill expectedEvents 必须覆盖大纲声称的每个 id。
 * 调度器只提供候选，规划层不再与调度器对齐。
 */
function evaluateScheduledForeshadowPlanEvidence(
  chapterPlan: ChapterPlan,
  outlineFulfilledForeshadowIds: string[],
  requestedChapterIndex: number
): ScheduledForeshadowPlanEvaluation {
  const declarationIds = getMissingScheduledForeshadowIds(
    chapterPlan.fulfilledForeshadowIds,
    outlineFulfilledForeshadowIds
  )
  const eventForeshadowIds = new Set<string>()
  for (const event of chapterPlan.expectedEvents ?? []) {
    if (event.type === 'foreshadow-fulfill' && event.chapterIndex === requestedChapterIndex) {
      eventForeshadowIds.add(event.foreshadowId)
    }
  }
  const missing = {
    declarationIds,
    eventIds: outlineFulfilledForeshadowIds.filter((id) => !eventForeshadowIds.has(id)),
  }
  return { missing, plan: { ...chapterPlan, chapterIndex: requestedChapterIndex } }
}

function hasMissingScheduledForeshadowPlanEvidence(
  missing: ScheduledForeshadowPlanEvidence
): boolean {
  return missing.declarationIds.length > 0 || missing.eventIds.length > 0
}

function formatMissingScheduledForeshadowPlanEvidence(
  missing: ScheduledForeshadowPlanEvidence
): string {
  return [
    `fulfilledForeshadowIds：${missing.declarationIds.join(', ') || '（无遗漏）'}`,
    `expectedEvents.foreshadow-fulfill：${missing.eventIds.join(', ') || '（无遗漏）'}`,
  ].join('；')
}

function formatScheduledForeshadowPlanDiagnostic(
  missing: ScheduledForeshadowPlanEvidence,
  capacity: number
): string {
  return `${formatMissingScheduledForeshadowPlanEvidence(missing)}（单章容量 ${capacity}）`
}

function logScheduledForeshadowPlanAttempt(
  chapterIndex: number,
  stage: string,
  attempt: number,
  maxAttempts: number,
  missing: ScheduledForeshadowPlanEvidence,
  capacity: number
): void {
  logger.warn(
    `[MuseFlow] 第 ${chapterIndex + 1} 章${stage}第 ${attempt}/${maxAttempts} 次遗漏大纲声称的伏笔兑现证据：${formatScheduledForeshadowPlanDiagnostic(missing, capacity)}`
  )
}

function buildScheduledForeshadowPlanError(
  chapterIndex: number,
  stage: string,
  missing: ScheduledForeshadowPlanEvidence,
  capacity: number
): Error {
  return new Error(
    `第 ${chapterIndex + 1} 章${stage}遗漏大纲声称的伏笔兑现证据：${formatScheduledForeshadowPlanDiagnostic(missing, capacity)}`
  )
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

function ensureOutlineLength(
  outline: ReducedGraphState['outline'],
  totalChapters: number
): ReducedGraphState['outline'] {
  const next = [...outline]
  for (let i = next.length; i < totalChapters; i++) {
    next.push({ number: i + 1, title: '', description: '' })
  }
  return next
}

function ensureChaptersLength(
  chapters: ReducedGraphState['chapters'],
  totalChapters: number
): ReducedGraphState['chapters'] {
  const next = [...chapters]
  while (next.length < totalChapters) {
    next.push(null)
  }
  return next
}

function synchronizeStateWithStoryArc(
  state: ReducedGraphState,
  updatedStoryArc: NonNullable<ReducedGraphState['storyArc']>
): ReducedGraphState {
  if (updatedStoryArc === state.storyArc) return state

  const updatedTotalChapters = Math.max(state.totalChapters, updatedStoryArc.totalChapters)
  const updatedOutline = ensureOutlineLength(state.outline, updatedTotalChapters)
  const updatedChapters = ensureChaptersLength(state.chapters, updatedTotalChapters)
  const updatedStory =
    updatedTotalChapters === state.story.totalChapters
      ? state.story
      : { ...state.story, totalChapters: updatedTotalChapters, updatedAt: Date.now() }

  return {
    ...state,
    story: updatedStory,
    totalChapters: updatedTotalChapters,
    storyArc: updatedStoryArc,
    outline: updatedOutline,
    chapters: updatedChapters,
  }
}

function applyAutomaticActExtensions(
  state: ReducedGraphState,
  chapterIndex: number,
  proposals: readonly ActBoundaryProposal[],
  stage: string
): ReducedGraphState {
  if (!state.storyArc || proposals.length === 0) return state

  let updatedStoryArc = state.storyArc
  for (const proposal of proposals) {
    const result = applyActBoundaryAdjustment(updatedStoryArc, proposal, chapterIndex)
    if (!result.applied) {
      logger.warn(`[MuseFlow] ${stage}自动延长第 ${proposal.actIndex} 幕失败：${result.reason}`)
      const command = formatActBoundaryAdjustmentCommand(state.story.id, proposal)
      logger.warn(`[MuseFlow] 建议运行：${command}`)
      if (result.requiresManualResolution) {
        throw new Error(
          [
            `${stage}自动延长第 ${proposal.actIndex} 幕失败：${result.reason ?? '需要人工调整幕边界。'}`,
            `请先运行：${command}`,
          ].join('\n')
        )
      }
      continue
    }
    updatedStoryArc = result.storyArc
    logger.info(`[MuseFlow] ${stage}${result.reason}`)
  }

  return synchronizeStateWithStoryArc(state, updatedStoryArc)
}

async function autoExtendCurrentActBeforeOutline(
  state: ReducedGraphState,
  chapterIndex: number
): Promise<ReducedGraphState> {
  if (!state.storyArc) return state

  const currentChapterNumber = chapterIndex + 1
  const currentAct = state.storyArc.acts.find(
    (act) => currentChapterNumber >= act.startChapter && currentChapterNumber <= act.endChapter
  )
  if (!currentAct) return state

  const planningConfig = getChapterPlanningConfig(state.genre)

  const extensionProposals = proposeActBoundaryAdjustments(
    state.storyArc,
    state.actProgress,
    chapterIndex,
    state.storyMemory,
    planningConfig.foreshadowMaxFulfillmentsPerChapter
  ).filter(
    (proposal) =>
      proposal.actIndex === currentAct.index && proposal.proposedEndChapter > currentAct.endChapter
  )

  if (extensionProposals.length === 0) return state

  return applyAutomaticActExtensions(state, chapterIndex, extensionProposals, '写前')
}

function ensureActCapacityAfterForeshadowAdjudication(
  state: ReducedGraphState,
  chapterIndex: number,
  plannedFulfillmentIds: readonly string[]
): ReducedGraphState {
  if (!state.storyArc || !state.storyMemory) return state

  const planningConfig = getChapterPlanningConfig(state.genre)
  const proposal = proposeActExtensionAfterForeshadowAdjudication(
    state.storyArc,
    chapterIndex,
    state.storyMemory,
    planningConfig.foreshadowMaxFulfillmentsPerChapter,
    plannedFulfillmentIds
  )
  if (!proposal) return state

  return applyAutomaticActExtensions(state, chapterIndex, [proposal], '伏笔裁决后')
}

function buildArcStatusConstraint(
  storyArc: import('../types/outline.js').StoryArc,
  actProgress: Record<number, { consumed: string[]; pending: string[] }>,
  chapterIndex: number
): string | undefined {
  const arcStatus = buildArcStatus(storyArc, actProgress, chapterIndex)
  const currentAct = arcStatus.currentAct
  if (!currentAct) return undefined

  const chaptersRemaining = currentAct.endChapter - (chapterIndex + 1)
  const pendingCount = arcStatus.beatsPending.length

  if (arcStatus.riskLevel === 'high') {
    return `【幕边界压力 - 高】第 ${currentAct.index} 幕还剩 ${chaptersRemaining} 章结束，仍有 ${pendingCount} 个 mandatory beats 未消费：${arcStatus.beatsPending.join('、')}。本章规划必须优先推进这些节拍中的至少 1 个，且严禁引入无关过渡场景。`
  }
  if (arcStatus.riskLevel === 'medium') {
    return `【幕边界压力 - 中】第 ${currentAct.index} 幕还剩 ${chaptersRemaining} 章结束，仍有 ${pendingCount} 个 mandatory beats 未消费。本章规划应视情节自然性推进其中 1 个，避免把全部压力留到幕末。`
  }
  return undefined
}

function finalizeChapterOutlineCandidate(
  candidate: ChapterOutlineResult,
  state: ReducedGraphState,
  chapterIndex: number,
  beatBudget: number
): ChapterOutlineResult {
  const filteredClaimedBeatPairs = filterClaimedMandatoryBeatPairsToCurrentAct(
    candidate.claimedBeats,
    candidate.claimedMandatoryBeatIds,
    state,
    chapterIndex
  )
  const cappedClaimedBeatPairs =
    beatBudget > 0 ? filteredClaimedBeatPairs.slice(0, beatBudget) : filteredClaimedBeatPairs
  const cappedClaimedBeats = cappedClaimedBeatPairs.map((pair) => pair.beat)
  const cappedClaimedMandatoryBeatIds = cappedClaimedBeatPairs.map((pair) => pair.id)
  const claimedBeatIds = filterClaimedKeyBeatIdsToStoryArc(
    candidate.claimedBeatIds,
    state,
    chapterIndex
  )
  if (filteredClaimedBeatPairs.length > cappedClaimedBeatPairs.length) {
    logger.info(
      `[MuseFlow] 第 ${chapterIndex + 1} 章声称节拍 ${filteredClaimedBeatPairs.length} 个，超出预算 ${beatBudget} 个，已裁剪为：${cappedClaimedBeats.join('、') || '（无）'}`
    )
  }

  return {
    ...candidate,
    claimedBeats: cappedClaimedBeats,
    claimedMandatoryBeatIds: cappedClaimedMandatoryBeatIds,
    claimedBeatIds,
  }
}

function getCurrentActMandatoryBeats(state: ReducedGraphState, chapterIndex: number): Set<string> {
  if (!state.storyArc) return new Set()
  const chapterNumber = chapterIndex + 1
  const currentAct = state.storyArc.acts.find(
    (act) => chapterNumber >= act.startChapter && chapterNumber <= act.endChapter
  )
  return new Set((currentAct?.mandatoryBeats ?? []).map((beat) => beat.trim()).filter(Boolean))
}

function isBeatAlreadyProven(state: ReducedGraphState, beatId: string): boolean {
  const beatMemory = state.storyMemory?.beats[beatId]
  if (!beatMemory) return false
  return beatMemory.provenByEventIds.length > 0
}

function filterClaimedMandatoryBeatPairsToCurrentAct(
  claimedBeats: string[] | undefined,
  claimedMandatoryBeatIds: string[] | undefined,
  state: ReducedGraphState,
  chapterIndex: number
): Array<{ beat: string; id: string }> {
  const currentAct = getActForChapter(state.storyArc, chapterIndex)
  const currentActMandatoryBeats = getCurrentActMandatoryBeats(state, chapterIndex)
  if (currentActMandatoryBeats.size === 0) return []

  const pairs: Array<{ beat: string; id: string }> = []
  const addPair = (beat: string, id: string) => {
    if (!pairs.some((pair) => pair.id === id)) {
      pairs.push({ beat, id })
    }
  }

  for (const id of claimedMandatoryBeatIds ?? []) {
    const trimmed = id.trim()
    const lookup = findMandatoryBeatById(state.storyArc, trimmed)
    if (!lookup || lookup.act.index !== currentAct?.index) continue
    if (isBeatAlreadyProven(state, trimmed)) {
      logger.info(
        `[MuseFlow] 第 ${chapterIndex + 1} 章声称的节拍 ${trimmed} 已在之前章节被证明，跳过`
      )
      continue
    }
    addPair(lookup.beat, trimmed)
  }

  if (pairs.length > 0) {
    return pairs
  }

  for (const beat of claimedBeats ?? []) {
    const trimmed = beat.trim()
    if (!trimmed || !currentActMandatoryBeats.has(trimmed)) continue
    const id = currentAct
      ? getMandatoryBeatIdByText(state.storyArc, currentAct.index, trimmed)
      : undefined
    if (!id) continue
    if (isBeatAlreadyProven(state, id)) {
      logger.info(`[MuseFlow] 第 ${chapterIndex + 1} 章声称的节拍 ${id} 已在之前章节被证明，跳过`)
      continue
    }
    addPair(trimmed, id)
  }
  return pairs
}

function filterClaimedKeyBeatIdsToStoryArc(
  claimedBeatIds: string[] | undefined,
  state: ReducedGraphState,
  chapterIndex: number
): string[] {
  if (!state.storyArc) return []
  const currentAct = getActForChapter(state.storyArc, chapterIndex)
  const allowed = new Set(
    state.storyArc.keyBeats
      .filter((beat) => !currentAct || beat.deadlineAct === currentAct.index)
      .map((beat) => beat.id)
  )
  const result: string[] = []
  for (const id of claimedBeatIds ?? []) {
    const trimmed = id.trim()
    if (allowed.has(trimmed) && !result.includes(trimmed)) {
      result.push(trimmed)
    }
  }
  return result
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
        0.3
      )
      return response.results
    }

    const text = await provider.chat(messages, 0.3)
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

  if (handoff?.endTime || storyTime) {
    parts.push(`【上一章结束时间】${handoff?.endTime ?? storyTime}`)
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

async function generateChapterOutlineIfNeeded(
  state: ReducedGraphState,
  chapterIndex: number,
  provider: ModelProvider
): Promise<GenerateChapterOutlineResult> {
  const outlineItem = state.outline[chapterIndex]
  if (!outlineItem) {
    throw new Error(`第 ${chapterIndex + 1} 章大纲不存在`)
  }

  // 已有具体描述，不需要重新生成
  if (outlineItem.description.trim().length > 0) {
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
  const scheduledForeshadowIds = getScheduledForeshadowIds(state, chapterIndex)
  const scheduledForeshadowConstraint =
    scheduledForeshadowIds.length > 0
      ? buildScheduledForeshadowConstraint(state, scheduledForeshadowIds)
      : ''

  // 计算本章节拍预算，防止幕前期把全部 mandatory beats 一次性消费完
  const currentAct = getActForChapter(state.storyArc, chapterIndex)
  const actProgressForAct = currentAct ? state.actProgress?.[currentAct.index] : undefined
  const pendingBeats = actProgressForAct?.pending ?? currentAct?.mandatoryBeats ?? []
  const beatBudget = currentAct ? calculateBeatBudget(currentAct, chapterIndex, pendingBeats) : 0
  const beatBudgetConstraint =
    beatBudget > 0
      ? `【节拍预算】本章属于第 ${currentAct?.index ?? '?'} 幕，剩余 ${pendingBeats.length} 个 mandatory beats、${currentAct ? currentAct.endChapter - (chapterIndex + 1) : 0} 章未写。本章 description 与 claimedBeats 最多承载 ${beatBudget} 个 mandatory beat，严禁在本章内一次性推进本幕其余所有节拍。`
      : ''

  let correctionConstraints: string[] = []
  let result: ChapterOutlineResult | null = null
  let lastCandidate: ChapterOutlineResult | null = null
  let lastMissingScheduledForeshadowIds: string[] = []
  let autoDeferredForeshadowIds: string[] = []

  for (let attempt = 0; attempt < MAX_JIT_OUTLINE_ATTEMPTS; attempt++) {
    const verifiedConstraints = [
      ...renderVerifiedConstraints(baseVerifiedConstraints),
      ...(beatBudgetConstraint ? [beatBudgetConstraint] : []),
      ...(scheduledForeshadowConstraint ? [scheduledForeshadowConstraint] : []),
      ...correctionConstraints,
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
      currentStateSnapshot: buildCurrentStateSnapshot(state),
    }

    const output = await agent.run(agentState)
    if (!output.success || !output.data) {
      throw new Error(`第 ${chapterIndex + 1} 章即时大纲生成失败：${output.error || '未知错误'}`)
    }

    const candidate = output.data as ChapterOutlineResult
    lastCandidate = candidate
    if (candidate.conflict) {
      throw new Error(
        `第 ${chapterIndex + 1} 章即时大纲与权威事实冲突：${candidate.conflictReason || '未说明原因'}`
      )
    }

    const missingScheduledForeshadowIds = getMissingScheduledForeshadowIds(
      [...(candidate.fulfilledForeshadowIds ?? []), ...(candidate.deferredForeshadowIds ?? [])],
      scheduledForeshadowIds
    )
    if (missingScheduledForeshadowIds.length > 0) {
      lastMissingScheduledForeshadowIds = missingScheduledForeshadowIds
      logger.warn(
        `[MuseFlow] 第 ${chapterIndex + 1} 章即时大纲第 ${attempt + 1}/${MAX_JIT_OUTLINE_ATTEMPTS} 次存在未裁决伏笔候选：${missingScheduledForeshadowIds.join(', ')}`
      )
      correctionConstraints = [
        `【伏笔调度修正】以下候选伏笔未裁决：${missingScheduledForeshadowIds.join(', ')}。每个候选 ID 必须出现在且仅出现在 fulfilledForeshadowIds 与 deferredForeshadowIds 之一；只有本章能自然回收的候选才能放入 fulfilledForeshadowIds，并在 description 中安排正文可验证的真实回收事件，不得虚假声称。`,
      ]
      continue
    }

    result = finalizeChapterOutlineCandidate(candidate, state, chapterIndex, beatBudget)
    break
  }

  if (!result) {
    if (lastCandidate && lastMissingScheduledForeshadowIds.length > 0) {
      logger.warn(
        `[MuseFlow] 第 ${chapterIndex + 1} 章即时大纲连续 ${MAX_JIT_OUTLINE_ATTEMPTS} 次存在未裁决伏笔候选，已自动顺延：${lastMissingScheduledForeshadowIds.join(', ')}`
      )
      autoDeferredForeshadowIds = lastMissingScheduledForeshadowIds
      const candidateWithDeferred = {
        ...lastCandidate,
        deferredForeshadowIds: [
          ...(lastCandidate.deferredForeshadowIds ?? []),
          ...autoDeferredForeshadowIds,
        ],
      }
      result = finalizeChapterOutlineCandidate(
        candidateWithDeferred,
        state,
        chapterIndex,
        beatBudget
      )
    } else {
      throw new Error(`第 ${chapterIndex + 1} 章即时大纲生成失败：未返回可执行大纲`)
    }
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
      type: 'outline_foreshadow',
      severity: 'warning',
      description: `即时大纲连续 ${MAX_JIT_OUTLINE_ATTEMPTS} 次未对候选伏笔 ${autoDeferredForeshadowIds.join(', ')} 作出裁决，已自动顺延至 deferredForeshadowIds。`,
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
  if (proposalMode === 'generate' && isRuntimeContext(source)) {
    await prepareStoryStateForChapterCached(state, chapterIndex, source)
    return
  }
  await prepareStoryStateForChapter(state, chapterIndex, getProvider(source), {
    proposalMode,
  })
}

type OutlineCandidateResolution =
  | { status: 'accepted'; state: ReducedGraphState }
  | { status: 'conflict'; error: BlockingConflictError }

async function reconcileOutlineCandidate(
  state: ReducedGraphState,
  chapterIndex: number,
  source: ChapterContextSource,
  applyValidatedProposal: boolean
): Promise<OutlineCandidateResolution> {
  let blockingError: BlockingConflictError
  try {
    await validateOutlineState(state, chapterIndex, source, 'generate')
    return { status: 'accepted', state }
  } catch (err) {
    if (!isBlockingConflictError(err)) throw err
    blockingError = err
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

  if (applyValidatedProposal) {
    logger.info(`[MuseFlow] 第 ${chapterIndex + 1} 章临时大纲修订已通过权威事实校验`)
    return { status: 'accepted', state: proposedState }
  }

  return {
    status: 'conflict',
    error: new BlockingConflictError([...blockingError.conflicts], chapterIndex, proposal),
  }
}

export async function expandOutlineForChapter(
  state: ReducedGraphState,
  chapterIndex: number,
  source: ChapterContextSource
): Promise<ExpandedOutline> {
  const provider = getProvider(source)
  let pendingIssues: Issue[] = []
  state = await autoExtendCurrentActBeforeOutline(state, chapterIndex)
  const persistedOutline = Boolean(state.outline[chapterIndex]?.description.trim())

  if (persistedOutline) {
    const resolution = await reconcileOutlineCandidate(state, chapterIndex, source, false)
    if (resolution.status === 'conflict') {
      throw resolution.error
    }
    state = resolution.state
  } else {
    const jitBaseState = state
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
        provider
      )
      const resolution = await reconcileOutlineCandidate(
        outlineResult.state,
        chapterIndex,
        source,
        true
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

  let outlineItem = state.outline[chapterIndex]
  if (!outlineItem) {
    throw new Error(`第 ${chapterIndex + 1} 章大纲不存在`)
  }

  state = ensureActCapacityAfterForeshadowAdjudication(
    state,
    chapterIndex,
    outlineItem.fulfilledForeshadowIds ?? []
  )
  outlineItem = state.outline[chapterIndex]
  if (!outlineItem) {
    throw new Error(`第 ${chapterIndex + 1} 章大纲在幕边界调整后不存在`)
  }

  const nextItem = state.outline[chapterIndex + 1]
  const scheduledForeshadowIds = getScheduledForeshadowIds(state, chapterIndex)
  const scheduledForeshadowConstraint =
    scheduledForeshadowIds.length > 0
      ? buildScheduledForeshadowConstraint(state, scheduledForeshadowIds)
      : ''

  const planningConfig = getChapterPlanningConfig(state.genre)
  const foreshadowCapacity = normalizeForeshadowCapacity(
    planningConfig.foreshadowMaxFulfillmentsPerChapter
  )

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
      ? normalizeReusableChapterPlan(state.chapterPlan, chapterIndex)
      : null
  let currentConstraints = filterVerifiedConstraintsForChapter(
    state.verifiedConstraints,
    state.storyArc,
    chapterIndex
  )
  if (scheduledForeshadowConstraint) {
    currentConstraints = [
      ...currentConstraints,
      createGenericVerifiedConstraint(scheduledForeshadowConstraint),
    ]
  }

  // 前置幕边界压力提示：当当前幕存在 mandatory beat 消费风险时，提前向规划层注入约束，
  // 避免到了幕末才发现 pending beats 无法消费完。
  const arcStatusConstraint = state.storyArc
    ? buildArcStatusConstraint(state.storyArc, state.actProgress ?? {}, chapterIndex)
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
    const planResult = await plan_chapter_with_override(provider, planState, formattedOutline)
    chapterPlan = planResult.chapterPlan ?? null
    if (chapterPlan) {
      state = { ...state, chapterPlan }
    }
  }

  if (!chapterPlan) {
    throw new Error(`第 ${chapterIndex + 1} 章详细计划生成失败`)
  }

  const outlineFulfilledForeshadowIds = outlineItem.fulfilledForeshadowIds ?? []
  let planEvaluation = evaluateScheduledForeshadowPlanEvidence(
    chapterPlan,
    outlineFulfilledForeshadowIds,
    chapterIndex
  )
  if (hasMissingScheduledForeshadowPlanEvidence(planEvaluation.missing)) {
    logScheduledForeshadowPlanAttempt(
      chapterIndex,
      '章节规划',
      1,
      2,
      planEvaluation.missing,
      foreshadowCapacity
    )
    currentConstraints = [
      ...currentConstraints,
      createGenericVerifiedConstraint(
        `【伏笔兑现修正】章节规划缺少大纲声称伏笔的结构化证据：${formatMissingScheduledForeshadowPlanEvidence(planEvaluation.missing)}。必须将这些精确 ID 同时写入 fulfilledForeshadowIds，并在 expectedEvents 中生成对应的 foreshadow-fulfill 事件。`
      ),
    ]
    const planState: ReducedGraphState = {
      ...state,
      currentChapterIndex: chapterIndex,
      verifiedConstraints: currentConstraints,
      chapterPlan: null,
    }
    const planResult = await plan_chapter_with_override(provider, planState, formattedOutline)
    const replanned = planResult.chapterPlan ?? null
    if (!replanned) {
      throw new Error(`第 ${chapterIndex + 1} 章详细计划生成失败`)
    }
    planEvaluation = evaluateScheduledForeshadowPlanEvidence(
      replanned,
      outlineFulfilledForeshadowIds,
      chapterIndex
    )
    if (hasMissingScheduledForeshadowPlanEvidence(planEvaluation.missing)) {
      logScheduledForeshadowPlanAttempt(
        chapterIndex,
        '章节规划',
        2,
        2,
        planEvaluation.missing,
        foreshadowCapacity
      )
      const missingForeshadowIds = Array.from(
        new Set([...planEvaluation.missing.declarationIds, ...planEvaluation.missing.eventIds])
      )
      logger.warn(
        `[MuseFlow] 第 ${chapterIndex + 1} 章章节规划连续 2 次无法为大纲声称伏笔生成结构化证据，已自动顺延：${missingForeshadowIds.join(', ')}`
      )

      // 自动顺延：从大纲 fulfilled 移除，加入大纲与规划的 deferred
      const newOutline = [...state.outline]
      const updatedOutlineItem = { ...outlineItem }
      const fulfilledSet = new Set(updatedOutlineItem.fulfilledForeshadowIds ?? [])
      const deferredSet = new Set(updatedOutlineItem.deferredForeshadowIds ?? [])
      const planFulfilledSet = new Set(planEvaluation.plan.fulfilledForeshadowIds ?? [])
      for (const id of missingForeshadowIds) {
        fulfilledSet.delete(id)
        deferredSet.add(id)
        planFulfilledSet.delete(id)
      }
      updatedOutlineItem.fulfilledForeshadowIds = Array.from(fulfilledSet)
      updatedOutlineItem.deferredForeshadowIds = Array.from(deferredSet)
      newOutline[chapterIndex] = updatedOutlineItem
      state = { ...state, outline: newOutline }
      outlineItem = updatedOutlineItem

      chapterPlan = {
        ...planEvaluation.plan,
        fulfilledForeshadowIds: Array.from(planFulfilledSet),
      }
      planEvaluation = { missing: { declarationIds: [], eventIds: [] }, plan: chapterPlan }

      pendingIssues.push({
        id: `plan-foreshadow-auto-deferred-${chapterIndex}`,
        type: 'outline_foreshadow',
        severity: 'warning',
        description: `章节规划连续 2 次无法为大纲声称的伏笔 ${missingForeshadowIds.join(', ')} 生成结构化兑现证据，已自动将其顺延。`,
        source: 'outline_compliance',
      })
    }
  }

  chapterPlan = planEvaluation.plan
  state = { ...state, chapterPlan }
  state = ensureActCapacityAfterForeshadowAdjudication(
    state,
    chapterIndex,
    chapterPlan.fulfilledForeshadowIds ?? []
  )

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
      const planResult = await plan_chapter_with_override(provider, planState, formattedOutline)
      const replanned = planResult.chapterPlan ?? null
      if (!replanned) break
      const replanEvaluation = evaluateScheduledForeshadowPlanEvidence(
        replanned,
        outlineFulfilledForeshadowIds,
        chapterIndex
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
    const planResult = await plan_chapter_with_override(provider, planState, formattedOutline)
    const replanned = planResult.chapterPlan ?? null
    if (!replanned) break
    const replanEvaluation = evaluateScheduledForeshadowPlanEvidence(
      replanned,
      outlineFulfilledForeshadowIds,
      chapterIndex
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
        type: 'outline_density',
        severity: 'warning',
        description: `经过 ${maxBudgetAttempts} 次预算修正仍存在重心问题：${budgetValidation.reason}。`,
      },
    ]
  } else if (budgetAttempts > 0) {
    logger.info('[MuseFlow] 重新规划后重心已修正')
  }

  chapterPlan = reconcileChapterPlanBeatContract(chapterPlan, state.outline[chapterIndex])

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
