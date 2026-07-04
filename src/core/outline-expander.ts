import { logger } from '../utils/logger.js'
import type { ReducedGraphState } from '../graph/state.js'
import { plan_chapter_with_override } from '../graph/nodes/planning.js'
import {
  buildNextChapterBoundaryHint,
  reconcileOutlineWithState,
} from '../utils/outline-boundary.js'
import { toDisplayChapterNumber } from '../utils/chapter-display.js'
import type { ChapterPlan, ChapterOutlineAgentInput } from '../agents/types.js'
import { readChapterContent, writeOutlineContent } from '../storage/filesystem/writer.js'
import { getChapterPlanningConfig, validateChapterPlanBudget, type ChapterPlanBudgetValidation, type CoreSectionJudge } from '../utils/chapter-planning.js'
import type { Issue } from '../types/agent.js'
import type { ModelProvider, Message, JsonSchema } from '../model/provider.js'
import { batchValidateTimeAnchors } from '../utils/context-judge.js'
import { getChapterOutlineAgent } from '../graph/agent-factory.js'
import { buildLayeredSummaries } from '../utils/summary-compressor.js'
import { formatStoryState, prepareStoryStateForChapter } from '../graph/utils/reconciler/index.js'
import { prepareStoryStateForChapterCached } from '../graph/utils/chapter-context.js'
import type { RuntimeContext } from './context.js'
import { charactersToString } from '../graph/utils/characters.js'
import { BlockingConflictError, isBlockingConflictError } from '../utils/errors.js'
import { generateOutlineRevisionProposal } from './chapter-generation/outline-revision-proposal.js'
import { createEmptyStoryState } from '../storage/meta/stores/story-state.js'
import type { Conflict } from '../types/story-state.js'
import { applyActBoundaryAdjustment, proposeActBoundaryAdjustments } from '../utils/story-arc.js'

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

function isRuntimeContext(source: ChapterContextSource): source is RuntimeContext {
  return 'provider' in source
}

function getProvider(source: ChapterContextSource): ModelProvider {
  return isRuntimeContext(source) ? source.provider : source
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

async function autoExtendCurrentActBeforeOutline(
  state: ReducedGraphState,
  chapterIndex: number
): Promise<ReducedGraphState> {
  if (!state.storyArc) return state

  const currentChapterNumber = chapterIndex + 1
  const currentAct = state.storyArc.acts.find(
    act => currentChapterNumber >= act.startChapter && currentChapterNumber <= act.endChapter
  )
  if (!currentAct) return state

  const extensionProposals = proposeActBoundaryAdjustments(
    state.storyArc,
    state.actProgress,
    chapterIndex
  ).filter(proposal => proposal.actIndex === currentAct.index && proposal.proposedEndChapter > currentAct.endChapter)

  if (extensionProposals.length === 0) return state

  let updatedStoryArc = state.storyArc
  for (const proposal of extensionProposals) {
    const result = applyActBoundaryAdjustment(updatedStoryArc, proposal, chapterIndex)
    if (!result.applied) {
      logger.warn(`[MuseFlow] 写前自动延长第 ${proposal.actIndex} 幕失败：${result.reason}`)
      continue
    }
    updatedStoryArc = result.storyArc
    logger.info(`[MuseFlow] 写前${result.reason}`)
  }

  if (updatedStoryArc === state.storyArc) return state

  const updatedTotalChapters = Math.max(state.totalChapters, updatedStoryArc.totalChapters)
  const updatedOutline = ensureOutlineLength(state.outline, updatedTotalChapters)
  const updatedChapters = ensureChaptersLength(state.chapters, updatedTotalChapters)
  const updatedStory = updatedTotalChapters === state.story.totalChapters
    ? state.story
    : { ...state.story, totalChapters: updatedTotalChapters, updatedAt: Date.now() }

  await writeOutlineContent(
    state.story.outputDir,
    state.story.title,
    updatedOutline,
    updatedStoryArc
  )

  return {
    ...state,
    story: updatedStory,
    totalChapters: updatedTotalChapters,
    storyArc: updatedStoryArc,
    outline: updatedOutline,
    chapters: updatedChapters,
  }
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

async function generateChapterOutlineIfNeeded(
  state: ReducedGraphState,
  chapterIndex: number,
  provider: ModelProvider
): Promise<ReducedGraphState> {
  const outlineItem = state.outline[chapterIndex]
  if (!outlineItem) {
    throw new Error(`第 ${chapterIndex + 1} 章大纲不存在`)
  }

  // 已有具体描述，不需要重新生成
  if (outlineItem.description.trim().length > 0) {
    return state
  }

  if (!state.storyArc) {
    throw new Error('未生成故事弧线，无法即时生成章节大纲')
  }

  const worldContent = state.world?.content
  const agent = getChapterOutlineAgent(provider)
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
    previousChapters: buildLayeredSummaries(state.chapterSummaries, chapterIndex),
    storyState: state.storyState ? formatStoryState(state.storyState) : '',
    ...(state.storyState?.canonicalFacts ? { canonicalFacts: state.storyState.canonicalFacts } : {}),
    ...(state.verifiedConstraints ? { verifiedConstraints: state.verifiedConstraints } : {}),
  }

  const output = await agent.run(agentState)
  if (!output.success || !output.data) {
    throw new Error(`第 ${chapterIndex + 1} 章即时大纲生成失败：${output.error || '未知错误'}`)
  }

  const result = output.data as import('../agents/chapter-outline.js').ChapterOutlineResult
  if (result.conflict) {
    throw new Error(`第 ${chapterIndex + 1} 章即时大纲与权威事实冲突：${result.conflictReason || '未说明原因'}`)
  }

  const newOutline = [...state.outline]
  const newOutlineItem: ReducedGraphState['outline'][number] = {
    number: chapterIndex + 1,
    title: result.title,
    description: result.description,
  }
  if (result.introducedCharacters && result.introducedCharacters.length > 0) {
    newOutlineItem.introducedCharacters = result.introducedCharacters
  }
  if (result.claimedBeats && result.claimedBeats.length > 0) {
    newOutlineItem.claimedBeats = result.claimedBeats
  }
  newOutline[chapterIndex] = newOutlineItem

  logger.info(`[MuseFlow] 已即时生成第 ${chapterIndex + 1} 章大纲：${result.title}`)
  logger.info(`  ${result.description}`)
  if (result.claimedBeats && result.claimedBeats.length > 0) {
    logger.info(`  声称推进节拍：${result.claimedBeats.join('、')}`)
  }

  // 持久化更新后的 outline.md
  await writeOutlineContent(state.story.outputDir, state.story.title, newOutline, state.storyArc)

  return { ...state, outline: newOutline }
}

const MAX_AUTO_REVISION_ATTEMPTS = 3

function conflictsEqual(a: readonly Conflict[], b: readonly Conflict[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const ca = a[i]
    const cb = b[i]
    if (!ca || !cb) return false
    if (
      ca.subject !== cb.subject ||
      ca.attribute !== cb.attribute ||
      ca.oldValue !== cb.oldValue ||
      ca.newValue !== cb.newValue
    ) {
      return false
    }
  }
  return true
}

/**
 * 自动修订与权威事实存在阻断性冲突的章节大纲。
 *
 * 在将大纲交给章节规划前，先运行一次状态协调；若发现 blocking 级冲突，
 * 则调用修订建议生成器改写大纲，并重新校验，最多重试 MAX_AUTO_REVISION_ATTEMPTS 次。
 * 仍无法解决时才把冲突抛给上层/作者裁决。
 */
async function autoResolveBlockingOutlineConflicts(
  state: ReducedGraphState,
  chapterIndex: number,
  source: ChapterContextSource
): Promise<ReducedGraphState> {
  const provider = getProvider(source)
  let currentState = state
  let lastError: BlockingConflictError | undefined

  for (let attempt = 0; attempt < MAX_AUTO_REVISION_ATTEMPTS; attempt++) {
    try {
      if (isRuntimeContext(source)) {
        await prepareStoryStateForChapterCached(currentState, chapterIndex, source)
      } else {
        await prepareStoryStateForChapter(currentState, chapterIndex, provider)
      }
      if (attempt > 0) {
        logger.info(`[MuseFlow] 大纲自动修订成功，第 ${chapterIndex + 1} 章冲突已解决`)
      }
      return currentState
    } catch (err) {
      if (!isBlockingConflictError(err)) {
        throw err
      }

      // 避免反复陷入同一组冲突（例如修订建议无效时）
      if (lastError && conflictsEqual(lastError.conflicts, err.conflicts)) {
        logger.warn('[MuseFlow] 自动修订未能改变冲突集合，停止重试')
        lastError = err
        break
      }
      lastError = err

      if (attempt === MAX_AUTO_REVISION_ATTEMPTS - 1) {
        break
      }

      logger.info(
        `[MuseFlow] 检测到 ${err.conflicts.length} 个阻断性冲突，尝试自动修订大纲（${attempt + 1}/${MAX_AUTO_REVISION_ATTEMPTS}）...`
      )

      const proposal = await generateOutlineRevisionProposal(
        currentState.outline,
        chapterIndex,
        [...err.conflicts],
        currentState.storyState ?? createEmptyStoryState(),
        provider
      )

      if (!proposal) {
        logger.warn('[MuseFlow] 无法生成修订建议，停止自动修订')
        break
      }

      const currentDescription = currentState.outline[chapterIndex]?.description ?? ''
      if (proposal.revisedDescription === currentDescription) {
        logger.warn('[MuseFlow] 修订建议与原大纲相同，停止自动修订')
        break
      }

      const newOutline = [...currentState.outline]
      const existingOutlineItem = newOutline[chapterIndex]
      newOutline[chapterIndex] = {
        ...existingOutlineItem,
        number: existingOutlineItem?.number ?? chapterIndex + 1,
        title: proposal.revisedTitle ?? existingOutlineItem?.title ?? `第${chapterIndex + 1}章`,
        description: proposal.revisedDescription,
      }
      currentState = { ...currentState, outline: newOutline }

      await writeOutlineContent(
        currentState.story.outputDir,
        currentState.story.title,
        newOutline,
        currentState.storyArc
      )

      logger.info(`[MuseFlow] 已自动修订第 ${chapterIndex + 1} 章大纲`)
      if (proposal.revisedTitle) {
        logger.info(`  新标题：${proposal.revisedTitle}`)
      }
      logger.info(`  新描述：${proposal.revisedDescription}`)
    }
  }

  if (lastError) {
    throw lastError
  }

  return currentState
}

export async function expandOutlineForChapter(
  state: ReducedGraphState,
  chapterIndex: number,
  source: ChapterContextSource
): Promise<ExpandedOutline> {
  const provider = getProvider(source)
  state = await autoExtendCurrentActBeforeOutline(state, chapterIndex)
  state = await generateChapterOutlineIfNeeded(state, chapterIndex, provider)
  state = await autoResolveBlockingOutlineConflicts(state, chapterIndex, source)

  const outlineItem = state.outline[chapterIndex]
  if (!outlineItem) {
    throw new Error(`第 ${chapterIndex + 1} 章大纲不存在`)
  }

  const nextItem = state.outline[chapterIndex + 1]

  const planningConfig = getChapterPlanningConfig(state.genre)

  const judgeCoreSections: CoreSectionJudge = (description, sections) =>
    judgeCoreSectionsWithModel(provider, description, sections)

  const nextBoundaryHint = buildNextChapterBoundaryHint(state.outline, chapterIndex, state.storyArc)
  const pendingTasksHint = await reconcileOutlineWithState(state, chapterIndex, planningConfig, provider)
  const boundaryHints = [nextBoundaryHint].filter(h => h.length > 0)

  // 如果下一章进入新幕，优先使用幕边界提示；否则使用下一章具体描述作为边界
  const currentAct = state.storyArc
    ? state.storyArc.acts.find(a => (chapterIndex + 1) >= a.startChapter && (chapterIndex + 1) <= a.endChapter)
    : undefined
  const nextAct = state.storyArc
    ? state.storyArc.acts.find(a => (chapterIndex + 2) >= a.startChapter && (chapterIndex + 2) <= a.endChapter)
    : undefined
  const entersNewAct = currentAct && nextAct && currentAct.index !== nextAct.index

  const nextBoundaryForPlanner = entersNewAct
    ? nextBoundaryHint
    : nextItem?.description
      ? `\n【后续章节边界】第${nextItem.number}章「${nextItem.title}」大纲：${nextItem.description}`
      : nextBoundaryHint

  const formattedOutline = [
    `第${toDisplayChapterNumber(chapterIndex)}章：${outlineItem.title}`,
    outlineItem.description,
    nextBoundaryForPlanner,
    pendingTasksHint,
  ].filter(part => part.length > 0).join('\n')

  let chapterPlan: ChapterPlan | null = state.chapterPlan
  let currentConstraints = [...(state.verifiedConstraints ?? [])]
  let pendingIssues: Issue[] = []

  // 首次生成规划
  if (!chapterPlan) {
    const planState: ReducedGraphState = {
      ...state,
      currentChapterIndex: chapterIndex,
      verifiedConstraints: currentConstraints,
    }
    const planResult = await plan_chapter_with_override(provider, planState, formattedOutline)
    chapterPlan = planResult.chapterPlan ?? null
  }

  if (!chapterPlan) {
    throw new Error(`第 ${chapterIndex + 1} 章详细计划生成失败`)
  }

  // 强制预算循环：校验核心事件占比和非核心段落字数，不合格则带约束重试
  const outlineDescription = outlineItem.description

  let budgetValidation = await validateChapterPlanBudget(chapterPlan, planningConfig, outlineDescription, judgeCoreSections)
  let budgetAttempts = 0
  const maxBudgetAttempts = 3

  while (!budgetValidation.valid && budgetAttempts < maxBudgetAttempts) {
    logger.warn(`[MuseFlow] ${budgetValidation.reason}`)
    logger.warn('[MuseFlow] 章节规划重心偏离大纲核心事件，将使用约束重新规划...')

    const focusConstraint = buildFocusConstraint(budgetValidation, planningConfig)
    currentConstraints = [...currentConstraints, focusConstraint]

    const planState: ReducedGraphState = {
      ...state,
      currentChapterIndex: chapterIndex,
      verifiedConstraints: currentConstraints,
    }
    const planResult = await plan_chapter_with_override(provider, planState, formattedOutline)
    const replanned = planResult.chapterPlan ?? null
    if (!replanned) break

    chapterPlan = replanned
    budgetValidation = await validateChapterPlanBudget(chapterPlan, planningConfig, outlineDescription, judgeCoreSections)
    budgetAttempts++
  }

  if (!budgetValidation.valid) {
    logger.warn(`[MuseFlow] 经过 ${maxBudgetAttempts} 次预算修正仍存在重心问题：${budgetValidation.reason}，将使用最新规划继续`)
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

  if (chapterIndex > 0) {
    const previousContent = await readChapterContent(state.story.outputDir, chapterIndex)
    const validation = await validateChapterTimeAnchor(chapterPlan, previousContent, provider)
    if (!validation.valid) {
      logger.warn(`[MuseFlow] ${validation.reason}`)
      logger.warn('[MuseFlow] 时间锚点与上一章正文不一致，将使用 storyState 时间作为参考')
      const { chapterTimeAnchor, ...restPlan } = chapterPlan
      void chapterTimeAnchor
      chapterPlan = restPlan
    }
  }

  logger.info(`[MuseFlow] 已动态展开第 ${outlineItem.number} 章详细大纲`)

  if (chapterPlan.sections.length > 0) {
    logger.info('\n📋 章节规划：')
    for (let i = 0; i < chapterPlan.sections.length; i++) {
      const section = chapterPlan.sections[i]
      if (!section) continue
      logger.info(`  ${i + 1}. ${section.title || '未命名'}${section.wordCount ? `（约${section.wordCount}字）` : ''}`)
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

  if (boundaryHints.length > 0) {
    logger.info('边界约束：')
    for (const hint of boundaryHints) {
      const clean = hint.replace(/<\/?[^>]+>/g, '').replace(/\s+/g, ' ').trim()
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
