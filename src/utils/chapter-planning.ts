import type { ChapterPlanningConfig, GenreSkill } from '../types/genre.js'
import type { ChapterPlan } from '../agents/chapter-planner.js'
import { getGenreSkill } from '../genres/registry.js'

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
}

export function getChapterPlanningConfig(genreName: string): Required<ChapterPlanningConfig> {
  const skill = getGenreSkill(genreName)
  return mergeChapterPlanningConfig(skill)
}

export function mergeChapterPlanningConfig(skill: GenreSkill | null): Required<ChapterPlanningConfig> {
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

export function validateChapterPlanBudget(
  plan: ChapterPlan,
  config: ChapterPlanningConfig,
): ChapterPlanBudgetValidation {
  const sections = plan.sections
  if (!sections || sections.length === 0) {
    return { valid: true, reason: undefined, totalWordCount: 0, coreWordCount: 0, coreRatio: 0, maxNonCoreWordCount: 0 }
  }

  const coreSectionTitles = new Set(
    (plan.outlineCheck ?? [])
      .filter(c => c.fulfilled && c.section)
      .map(c => c.section!.trim())
  )

  let totalWordCount = 0
  let coreWordCount = 0
  let maxNonCoreWordCount = 0

  for (const section of sections) {
    const wordCount = section.wordCount ?? 0
    totalWordCount += wordCount
    const isCore = coreSectionTitles.has(section.title?.trim() ?? '')
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
