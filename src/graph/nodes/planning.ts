import type { ReducedGraphState } from '../state.js'
import type { ChapterPlannerAgentInput } from '../../agents/types.js'
import { getChapterPlannerAgent } from '../agent-factory.js'
import { buildNextChapterBoundaryHint } from '../../utils/outline-boundary.js'
import { toDisplayChapterNumber } from '../../utils/chapter-display.js'
import { buildChapterAgentContext, mergeAgentState } from '../utils/chapter-context.js'
import type { ModelProvider } from '../../model/provider.js'
import { renderVerifiedConstraints } from '../../utils/verified-constraints.js'

async function runPlanChapter(
  provider: ModelProvider,
  state: ReducedGraphState,
  outlineOverride?: string
): Promise<Partial<ReducedGraphState>> {
  const agent = getChapterPlannerAgent(provider)
  const chapterIndex = state.currentChapterIndex

  const baseContext = await buildChapterAgentContext(state, chapterIndex, provider)
  const verifiedConstraints = renderVerifiedConstraints(state.verifiedConstraints)

  const agentState: ChapterPlannerAgentInput = mergeAgentState(baseContext, {
    outline: outlineOverride ?? formatChapterOutlineForAgent(state, chapterIndex),
    chapterSummaries: state.chapterSummaries,
    ...(state.pendingIssues && state.pendingIssues.length > 0
      ? { issues: state.pendingIssues }
      : {}),
    ...(verifiedConstraints.length > 0 ? { verifiedConstraints } : {}),
  }) as ChapterPlannerAgentInput

  const output = await agent.run(agentState)

  if (!output.success || !output.data) {
    throw new Error(
      `第 ${chapterIndex + 1} 章规划失败：${output.error || '无法生成章节规划。请检查模型输出或重试。'}`
    )
  }

  const chapterPlan: import('../../agents/chapter-planner.js').ChapterPlan = {
    expectedEvents: [],
    claimedBeatIds: [],
    fulfilledForeshadowIds: [],
    introducedForeshadowIds: [],
    resolvedTaskIds: [],
    createdTaskIds: [],
    sections: [],
    timeline: [],
    outlineCheck: [],
    ...output.data,
    chapterIndex: chapterIndex,
  }

  return { chapterPlan }
}

export async function plan_chapter_with_override(
  provider: ModelProvider,
  state: ReducedGraphState,
  outlineOverride: string
): Promise<Partial<ReducedGraphState>> {
  return runPlanChapter(provider, state, outlineOverride)
}

export function formatChapterOutlineForAgent(
  state: ReducedGraphState,
  chapterIndex: number,
  extraHints: string[] = []
): string {
  const outlineItem = state.outline[chapterIndex]
  if (!outlineItem) {
    return state.outline.map((o, i) => `第${toDisplayChapterNumber(i)}章：${o.title}`).join('\n')
  }
  const nextChapterBoundaryHint = buildNextChapterBoundaryHint(state.outline, chapterIndex)
  return [
    `第${toDisplayChapterNumber(chapterIndex)}章：${outlineItem.title}`,
    outlineItem.description,
    nextChapterBoundaryHint,
    ...extraHints,
  ]
    .filter((part) => part.trim().length > 0)
    .join('\n')
}

/**
 * 为一致性检查 agent 构造大纲上下文。
 * 一致性检查只能看到当前章节及之前章节的完整内容，以及下一章标题作为边界提示。
 * 绝不能暴露后续章节的具体剧情，否则 agent 会把当前章节的正常推进误判为"提前剧透"。
 */
export function buildConsistencyOutlineContext(
  state: ReducedGraphState,
  chapterIndex: number
): string {
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
