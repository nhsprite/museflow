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

export interface ExpandedOutline {
  chapterPlan: ChapterPlan
  boundaryHints: string[]
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

  const bridgeHint = buildOutlineBridgeHint(state.outline, chapterIndex)
  const nextBoundaryHint = buildNextChapterBoundaryHint(state.outline, chapterIndex)
  const redundant = findRedundantOutlineEvents(state.outline, chapterIndex)
  const pendingTasksHint = reconcileOutlineWithState(state, chapterIndex)
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

  let chapterPlan = state.chapterPlan
  if (!chapterPlan) {
    const planState: ReducedGraphState = {
      ...state,
      currentChapterIndex: chapterIndex,
    }

    const planResult = await plan_chapter_with_override(planState, formattedOutline)
    if (!planResult.chapterPlan) {
      throw new Error(`第 ${chapterIndex + 1} 章详细计划生成失败`)
    }
    chapterPlan = planResult.chapterPlan
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
