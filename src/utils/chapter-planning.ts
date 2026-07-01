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
  criticalFactAttributes: ['来源', '制造者', '赠予者', '持有者', '身份', '状态', '位置'],
  outlineDescriptionLengthMin: 30,
  outlineDescriptionLengthMax: 60,
  outlineDescriptionSentenceCountMin: 1,
  outlineDescriptionSentenceCountMax: 2,
  foreshadowMinLength: 40,
  foreshadowMinFulfillDistance: 2,
  foreshadowMaxFulfillDistance: 8,
  foreshadowMaxStackSize: 20,
  closingPhaseRatio: 0.15,
  maxErrorRewriteAttempts: 3,
  issueSetSimilarityThreshold: 0.5,
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

export async function validateChapterPlanBudget(
  plan: ChapterPlan,
  config: ChapterPlanningConfig,
  outlineDescription?: string,
  judgeCoreSections?: CoreSectionJudge,
): Promise<ChapterPlanBudgetValidation> {
  const sections = plan.sections
  if (!sections || sections.length === 0) {
    return { valid: true, reason: undefined, totalWordCount: 0, coreWordCount: 0, coreRatio: 0, maxNonCoreWordCount: 0 }
  }

  // 优先使用注入的语义判断函数（如模型调用）。
  // 若未提供，则回退到 outlineCheck 中标注的 fulfilled section 标题匹配。
  let coreFlags: boolean[]
  if (judgeCoreSections) {
    coreFlags = await judgeCoreSections(outlineDescription, sections)
  } else {
    const coreSectionTitles = new Set(
      (plan.outlineCheck ?? [])
        .filter(c => c.fulfilled && c.section)
        .map(c => c.section!.trim())
    )
    coreFlags = sections.map(s => coreSectionTitles.has(s.title?.trim() ?? ''))
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
    return { valid: true, reason: undefined, totalWordCount: 0, coreWordCount: 0, coreRatio: 0, maxNonCoreWordCount: 0 }
  }

  const coreRatio = coreWordCount / totalWordCount
  const reasons: string[] = []

  if (coreRatio < config.coreEventRatioTarget) {
    reasons.push(`核心事件字数占比约 ${Math.round(coreRatio * 100)}%，低于 ${Math.round(config.coreEventRatioTarget * 100)}% 下限`)
  }

  if (maxNonCoreWordCount > config.maxNonCoreSectionWordCount) {
    reasons.push(`最大非核心段落字数约 ${maxNonCoreWordCount}，超过 ${config.maxNonCoreSectionWordCount} 字上限`)
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
