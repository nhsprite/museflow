import type { ReducedGraphState } from '../graph/state.js'
import { plan_chapter_with_override } from '../graph/nodes.js'
import {
  buildOutlineBridgeHint,
  buildNextChapterBoundaryHint,
  findRedundantOutlineEvents,
  reconcileOutlineWithState,
} from '../utils/outline-boundary.js'
import { toDisplayChapterNumber } from '../utils/chapter-display.js'
import type { ChapterPlan } from '../agents/chapter-planner.js'
import { readChapterContent } from '../storage/filesystem/writer.js'
import { getChapterPlanningConfig, validateChapterPlanBudget } from '../utils/chapter-planning.js'

export interface ExpandedOutline {
  chapterPlan: ChapterPlan
  boundaryHints: string[]
}

const COMPLETION_MARKERS = /已(?:落地|完成|收束|结束|办妥|解决|处理)/g
const PREVIOUS_TIME_MARKERS = /昨[日天]|上一章|前章|前一日/g

function extractChineseKeywords(text: string): string[] {
  const sequences = text.match(/[\u4e00-\u9fff]{2,}/g) ?? []
  const keywords = new Set<string>()
  for (const sequence of sequences) {
    const maxLen = Math.min(sequence.length, 4)
    for (let len = 2; len <= maxLen; len++) {
      for (let i = 0; i <= sequence.length - len; i++) {
        keywords.add(sequence.slice(i, i + len))
      }
    }
  }
  return Array.from(keywords)
}

export function validateChapterTimeAnchor(
  chapterPlan: ChapterPlan,
  previousChapterContent: string | null
): { valid: boolean; reason?: string } {
  const anchor = chapterPlan.chapterTimeAnchor ?? ''
  if (!anchor || !previousChapterContent || previousChapterContent.trim().length === 0) {
    return { valid: true }
  }

  if (!PREVIOUS_TIME_MARKERS.test(anchor)) {
    return { valid: true }
  }

  const matches = anchor.matchAll(COMPLETION_MARKERS)
  for (const match of matches) {
    const markerIndex = match.index ?? 0
    const prefix = anchor.slice(0, markerIndex)
    const eventPhrase = prefix.match(/[\u4e00-\u9fff]{2,}(?=[，、；：]?$)/)?.[0] ?? ''
    if (eventPhrase.length === 0) continue

    const eventKeywords = extractChineseKeywords(eventPhrase)
    const hasOverlap = eventKeywords.some(kw => previousChapterContent.includes(kw))
    if (!hasOverlap) {
      return {
        valid: false,
        reason: `chapterTimeAnchor 声称上一章已完成"${eventPhrase}"，但上一章正文未提及该事件`,
      }
    }
  }

  return { valid: true }
}

export async function expandOutlineForChapter(
  state: ReducedGraphState,
  chapterIndex: number
): Promise<ExpandedOutline> {
  const outlineItem = state.outline[chapterIndex]
  if (!outlineItem) {
    throw new Error(`第 ${chapterIndex + 1} 章大纲不存在`)
  }

  const nextItem = state.outline[chapterIndex + 1]

  const planningConfig = getChapterPlanningConfig(state.genre)

  const bridgeHint = buildOutlineBridgeHint(state.outline, chapterIndex)
  const nextBoundaryHint = buildNextChapterBoundaryHint(state.outline, chapterIndex)
  const redundant = findRedundantOutlineEvents(state.outline, chapterIndex)
  const pendingTasksHint = reconcileOutlineWithState(state, chapterIndex, planningConfig)
  const boundaryHints = [bridgeHint, nextBoundaryHint].filter(h => h.length > 0)

  const formattedOutline = [
    `第${toDisplayChapterNumber(chapterIndex)}章：${outlineItem.title}`,
    outlineItem.description,
    nextItem ? `\n【后续章节边界】第${nextItem.number}章"${nextItem.title}"大纲：${nextItem.description}` : '',
    bridgeHint,
    nextBoundaryHint,
    pendingTasksHint,
    redundant.length > 0
      ? `\n【修正要求】检测到相邻章节事件重叠：第${redundant[0]!.previousChapter}章已包含"${redundant[0]!.previousKeyword}"，本章不得重复处理该事件，请将其改写为余波、后续发展或新转折。`
      : '',
  ].filter(part => part.length > 0).join('\n')

  let chapterPlan: ChapterPlan | null = state.chapterPlan
  if (!chapterPlan) {
    const planState: ReducedGraphState = {
      ...state,
      currentChapterIndex: chapterIndex,
    }

    const planResult = await plan_chapter_with_override(planState, formattedOutline)
    chapterPlan = planResult.chapterPlan ?? null
  }

  if (!chapterPlan) {
    throw new Error(`第 ${chapterIndex + 1} 章详细计划生成失败`)
  }

  let focusValidation = validateChapterPlanBudget(chapterPlan, planningConfig)
  if (!focusValidation.valid) {
    console.warn(`[MuseFlow] ${focusValidation.reason}`)
    console.warn('[MuseFlow] 章节规划重心偏离大纲核心事件，将使用约束重新规划...')

    const focusConstraint = `【规划重心修正】前次规划 ${focusValidation.reason}。本次规划必须：1) 核心事件字数占比 ≥ ${Math.round(planningConfig.coreEventRatioTarget * 100)}%；2) 与核心事件无关的前章遗留差事必须选择 postponed 或一句话带过，不得展开为独立场景；3) 任何非核心段落字数不得超过 ${planningConfig.maxNonCoreSectionWordCount} 字。`
    const planState: ReducedGraphState = {
      ...state,
      currentChapterIndex: chapterIndex,
      verifiedConstraints: [...(state.verifiedConstraints ?? []), focusConstraint],
    }

    const planResult = await plan_chapter_with_override(planState, formattedOutline)
    const replanned = planResult.chapterPlan ?? null
    if (replanned) {
      const replanValidation = validateChapterPlanBudget(replanned, planningConfig)
      if (replanValidation.valid) {
        console.log('[MuseFlow] 重新规划后重心已修正')
        chapterPlan = replanned
      } else {
        console.warn(`[MuseFlow] 重新规划后仍存在重心问题：${replanValidation.reason}，将使用最新规划继续`)
        chapterPlan = replanned
      }
    }
  }

  if (chapterIndex > 0) {
    const previousContent = await readChapterContent(state.story.outputDir, chapterIndex)
    const validation = validateChapterTimeAnchor(chapterPlan, previousContent)
    if (!validation.valid) {
      console.warn(`[MuseFlow] ${validation.reason}`)
      console.warn('[MuseFlow] 时间锚点与上一章正文不一致，将使用 storyState 时间作为参考')
      const { chapterTimeAnchor: _, ...restPlan } = chapterPlan
      chapterPlan = restPlan
    }
  }

  console.log(`[MuseFlow] 已动态展开第 ${outlineItem.number} 章详细大纲`)

  if (chapterPlan.sections.length > 0) {
    console.log('\n📋 章节规划：')
    for (let i = 0; i < chapterPlan.sections.length; i++) {
      const section = chapterPlan.sections[i]
      if (!section) continue
      console.log(`  ${i + 1}. ${section.title || '未命名'}${section.wordCount ? `（约${section.wordCount}字）` : ''}`)
      if (section.events && section.events.length > 0) {
        console.log(`     事件：${section.events.join('、')}`)
      }
      if (section.characters && section.characters.length > 0) {
        console.log(`     人物：${section.characters.join('、')}`)
      }
      if (section.timeMark) {
        console.log(`     时间：${section.timeMark}`)
      }
    }
    console.log('')
  }

  if (chapterPlan.chapterTimeAnchor) {
    console.log(`[MuseFlow] 本章时间锚点：${chapterPlan.chapterTimeAnchor}`)
  }

  if (chapterPlan.taskResolutions && chapterPlan.taskResolutions.length > 0) {
    console.log('[MuseFlow] 前章差事处理：')
    for (const tr of chapterPlan.taskResolutions) {
      console.log(`  - ${tr.assignee}：${tr.description} → ${tr.resolution}（${tr.reason}）`)
    }
  }

  if (boundaryHints.length > 0) {
    console.log('[MuseFlow] 边界约束：')
    for (const hint of boundaryHints) {
      const summary = hint.replace(/\s+/g, ' ').slice(0, 80)
      console.log(`  ${summary}${hint.length > 80 ? '...' : ''}`)
    }
  }

  return {
    chapterPlan,
    boundaryHints,
  }
}
