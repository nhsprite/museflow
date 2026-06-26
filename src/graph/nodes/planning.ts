import { logger } from '../../utils/logger.js'
import type { ReducedGraphState } from '../state.js'
import type { AgentState } from '../../agents/base.js'
import { getChapterPlannerAgent } from '../agent-factory.js'
import { buildLayeredSummaries } from '../../utils/summary-compressor.js'
import { buildCharacterFactTimeline, formatStoryState, reconcileStoryState } from '../utils/story-state.js'
import { buildEffectiveCharactersList, charactersToString } from '../utils/characters.js'
import { buildOutlineBridgeHint, buildNextChapterBoundaryHint } from '../../utils/outline-boundary.js'
import { toDisplayChapterNumber } from '../../utils/chapter-display.js'
import { sanitizeStoryState } from '../../utils/story-state-validation.js'

async function runPlanChapter(
  state: ReducedGraphState,
  outlineOverride?: string
): Promise<Partial<ReducedGraphState>> {
  const agent = getChapterPlannerAgent()
  const chapterIndex = state.currentChapterIndex
  const worldContent = state.world?.content

  const previousChapters = buildLayeredSummaries(state.chapterSummaries, chapterIndex)
  const timelineSnapshot = buildCharacterFactTimeline(state, chapterIndex)

  const outlineItem = state.outline[chapterIndex]
  let reconciledState = state.storyState && outlineItem?.description
    ? reconcileStoryState(state.storyState, outlineItem.description, state.characters)
    : state.storyState

  if (reconciledState) {
    const report = sanitizeStoryState(reconciledState, state.characters, { preserveExisting: true, existingStoryState: state.storyState })
    if (report.itemLocationConflicts.length > 0) {
      logger.warn('[MuseFlow] 规划前检测到物品位置冲突：')
      for (const conflict of report.itemLocationConflicts) {
        logger.warn(`  - ${conflict.item}: ${conflict.locations.join(' / ')}`)
      }
    }
    reconciledState = report.state
  }

  const storyStateStr = reconciledState ? formatStoryState(reconciledState) : ''

  const { merged: effectiveCharacters, outline: outlineCharacters, established: establishedCharacters } = buildEffectiveCharactersList(state, chapterIndex)

  const agentState: AgentState = {
    idea: state.idea,
    genre: state.genre,
    totalChapters: state.totalChapters,
    ...(worldContent ? { world: worldContent } : {}),
    characters: charactersToString(state.characters),
    charactersList: effectiveCharacters,
    outlineCharacters,
    establishedCharacters,
    outline: outlineOverride ?? formatChapterOutlineForAgent(state, chapterIndex),
    previousChapters,
    chapterIndex,
    chapterSummaries: state.chapterSummaries,
    timelineSnapshot,
    foreshadowStack: state.foreshadowStack,
    ...(storyStateStr ? { storyState: storyStateStr } : {}),
    ...(state.pendingIssues && state.pendingIssues.length > 0 ? { issues: state.pendingIssues } : {}),
    ...(state.verifiedConstraints && state.verifiedConstraints.length > 0 ? { verifiedConstraints: state.verifiedConstraints } : {}),
  }

  const output = await agent.run(agentState)

  if (!output.success || !output.data) {
    throw new Error(
      `第 ${chapterIndex + 1} 章规划失败：${output.error || '无法生成章节规划。请检查模型输出或重试。'}`
    )
  }

  const chapterPlan = output.data as import('../../agents/chapter-planner.js').ChapterPlan

  return { chapterPlan }
}

export async function plan_chapter(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  return runPlanChapter(state)
}

export async function plan_chapter_with_override(
  state: ReducedGraphState,
  outlineOverride: string
): Promise<Partial<ReducedGraphState>> {
  return runPlanChapter(state, outlineOverride)
}

export function formatChapterOutlineForAgent(state: ReducedGraphState, chapterIndex: number, extraHints: string[] = []): string {
  const outlineItem = state.outline[chapterIndex]
  if (!outlineItem) {
    return state.outline.map((o, i) => `第${toDisplayChapterNumber(i)}章：${o.title}`).join('\n')
  }
  const bridgeHint = buildOutlineBridgeHint(state.outline, chapterIndex)
  const nextChapterBoundaryHint = buildNextChapterBoundaryHint(state.outline, chapterIndex)
  return [`第${toDisplayChapterNumber(chapterIndex)}章：${outlineItem.title}`, outlineItem.description, bridgeHint, nextChapterBoundaryHint, ...extraHints]
    .filter(part => part.trim().length > 0)
    .join('\n')
}

/**
 * 为一致性检查 agent 构造大纲上下文。
 * 一致性检查只能看到当前章节及之前章节的完整内容，以及下一章标题作为边界提示。
 * 绝不能暴露后续章节的具体剧情，否则 agent 会把当前章节的正常推进误判为"提前剧透"。
 */
export function buildConsistencyOutlineContext(state: ReducedGraphState, chapterIndex: number): string {
  const lines: string[] = []

  for (let i = 0; i < state.outline.length; i++) {
    const item = state.outline[i]
    if (!item) continue
    const display = toDisplayChapterNumber(i)
    if (i <= chapterIndex) {
      lines.push(`第${display}章：${item.title}`)
      if (item.description) {
        lines.push(item.description)
      }
    } else if (i === chapterIndex + 1) {
      lines.push(`第${display}章：${item.title}（下一章标题，仅作边界提示）`)
    } else {
      lines.push(`第${display}章：[后续章节内容已隐藏]`)
    }
  }

  return lines.join('\n')
}
