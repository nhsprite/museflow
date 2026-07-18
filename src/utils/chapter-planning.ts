import type { ChapterPlanningConfig, GenreSkill } from '../types/genre.js'
import type { ChapterPlan } from '../agents/types.js'
import { getGenreSkill } from '../genres/registry.js'

/**
 * 判断章节规划中哪些 section 直接服务于大纲核心事件。
 * 由调用方注入实现：可以是模型语义判断，也可以是基于规则的回退。
 */
export type CoreSectionJudge = (
  outlineDescription: string | undefined,
  sections: ChapterPlan['sections']
) => Promise<boolean[]> | boolean[]

export const DEFAULT_CHAPTER_PLANNING_CONFIG: Required<ChapterPlanningConfig> = {
  storyActCountMin: 3,
  storyActCountMax: 5,
  chapterWordCountToleranceRatio: 0.1,
  coreEventRatioMin: 0.3,
  coreEventRatioTarget: 0.5,
  maxNonCoreSectionWordCount: 800,
  minCoreSectionWordCount: 1000,
  maxBackgroundTaskWordCount: 50,
  maxExecutedTaskRatio: 0.1,
  maxBridgeSceneRatio: 0.3,
  maxVerifiedConstraints: 20,
  maxNonErrorIssuesPerType: 3,
  closingForeshadowRecoveryRatio: 0.6,
  minSections: 3,
  maxSections: 6,
  minCoreSections: 2,
  criticalFactAttributes: ['origin', 'maker', 'giver', 'holder', 'identity', 'status', 'location'],
  outlineDescriptionLengthMin: 30,
  outlineDescriptionLengthMax: 60,
  outlineDescriptionSentenceCountMin: 1,
  outlineDescriptionSentenceCountMax: 2,
  foreshadowMinLength: 40,
  foreshadowMinFulfillDistance: 2,
  foreshadowMaxFulfillDistance: 8,
  foreshadowMaxStackSize: 20,
  foreshadowMaxFulfillmentsPerChapter: 3,
  foreshadowFulfillmentHeadroomPerChapter: 1,
  foreshadowMaxOpportunisticCandidatesPerChapter: 1,
  bookClosingPhaseRatio: 0.15,
  actClosingPhaseRatio: 0.2,
  maxAutoFixAttempts: 3,
  maxStateRepairAttempts: 2,
  maxErrorRewriteAttempts: 3,
  issueSetSimilarityThreshold: 0.5,
  rewriteStallSimilarityThreshold: 0.7,
  rewriteStallMinRounds: 3,
  actBoundaryAutoAdjustmentMaxChapters: 3,
  actBoundaryAutoAdjustmentMaxCumulativeChapters: 3,
  actBoundaryAutoAdjustmentMaxGlobalRatio: 0.15,
  downgradeInterpretiveErrors: true,
}

export function getChapterPlanningConfig(genreName: string): Required<ChapterPlanningConfig> {
  const skill = getGenreSkill(genreName)
  return mergeChapterPlanningConfig(skill)
}

function mergeChapterPlanningConfig(skill: GenreSkill | null): Required<ChapterPlanningConfig> {
  return {
    ...DEFAULT_CHAPTER_PLANNING_CONFIG,
    ...(skill?.chapterPlanning ?? {}),
  }
}

export interface ChapterPlanBudgetValidation {
  valid: boolean
  reason: string | undefined
  totalWordCount: number
  coreWordCount: number
  coreRatio: number
  maxNonCoreWordCount: number
}

interface RuleBasedCoreSectionResult {
  flags: boolean[]
  ambiguousIndices: Set<number>
}

function computeRuleBasedCoreSectionFlags(plan: ChapterPlan): RuleBasedCoreSectionResult {
  const sections = plan.sections
  const coreSectionTitles = new Set(
    (plan.outlineCheck ?? []).filter((c) => c.fulfilled && c.section).map((c) => c.section!.trim())
  )

  const flags: boolean[] = []
  const ambiguousIndices = new Set<number>()

  for (let i = 0; i < sections.length; i++) {
    const s = sections[i]
    if (!s) {
      flags.push(false)
      continue
    }
    const title = s.title?.trim() ?? ''
    if (coreSectionTitles.has(title)) {
      flags.push(true)
    } else if (!s.events || s.events.length === 0) {
      // 没有明确事件描述的 section 不可能为核心事件
      flags.push(false)
    } else {
      // 有事件但标题未命中 outlineCheck，属于模糊边界，交给 LLM 兜底
      flags.push(false)
      ambiguousIndices.add(i)
    }
  }

  return { flags, ambiguousIndices }
}

function computeBudgetValidation(
  plan: ChapterPlan,
  config: ChapterPlanningConfig,
  coreFlags: boolean[]
): ChapterPlanBudgetValidation {
  const sections = plan.sections
  if (!sections || sections.length === 0) {
    return {
      valid: true,
      reason: undefined,
      totalWordCount: 0,
      coreWordCount: 0,
      coreRatio: 0,
      maxNonCoreWordCount: 0,
    }
  }

  let totalWordCount = 0
  let coreWordCount = 0
  let maxNonCoreWordCount = 0

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]
    if (!section) continue
    const wordCount = section.wordCount ?? 0
    totalWordCount += wordCount
    const isCore = coreFlags[i] ?? false
    if (isCore) {
      coreWordCount += wordCount
    } else {
      maxNonCoreWordCount = Math.max(maxNonCoreWordCount, wordCount)
    }
  }

  if (totalWordCount === 0) {
    return {
      valid: true,
      reason: undefined,
      totalWordCount: 0,
      coreWordCount: 0,
      coreRatio: 0,
      maxNonCoreWordCount: 0,
    }
  }

  const coreRatio = coreWordCount / totalWordCount
  const reasons: string[] = []

  if (coreRatio < config.coreEventRatioTarget) {
    reasons.push(
      `核心事件字数占比约 ${Math.round(coreRatio * 100)}%，低于 ${Math.round(config.coreEventRatioTarget * 100)}% 下限`
    )
  }

  if (maxNonCoreWordCount > config.maxNonCoreSectionWordCount) {
    reasons.push(
      `最大非核心段落字数约 ${maxNonCoreWordCount}，超过 ${config.maxNonCoreSectionWordCount} 字上限`
    )
  }

  return {
    valid: reasons.length === 0,
    reason: reasons.length > 0 ? reasons.join('；') : undefined,
    totalWordCount,
    coreWordCount,
    coreRatio,
    maxNonCoreWordCount,
  }
}

export async function validateChapterPlanBudget(
  plan: ChapterPlan,
  config: ChapterPlanningConfig,
  outlineDescription?: string,
  judgeCoreSections?: CoreSectionJudge
): Promise<ChapterPlanBudgetValidation> {
  // 先用 outlineCheck 与 section.events 等结构化规则判定核心段落。
  const { flags: ruleFlags, ambiguousIndices } = computeRuleBasedCoreSectionFlags(plan)
  const ruleValidation = computeBudgetValidation(plan, config, ruleFlags)

  // 规则已经通过时直接返回，避免调用 LLM。
  if (ruleValidation.valid) {
    return ruleValidation
  }

  // 规则未通过且存在模糊边界、并提供了 LLM 兜底时，让模型判断模糊边界。
  if (judgeCoreSections && ambiguousIndices.size > 0) {
    const llmFlags = await judgeCoreSections(outlineDescription, plan.sections)
    const combinedFlags = ruleFlags.map(
      (isCore, i) => isCore || (ambiguousIndices.has(i) && (llmFlags[i] ?? false))
    )
    return computeBudgetValidation(plan, config, combinedFlags)
  }

  return ruleValidation
}
