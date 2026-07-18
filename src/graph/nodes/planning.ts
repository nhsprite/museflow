import type { ReducedGraphState } from '../state.js'
import type {
  ChapterPlan,
  ChapterPlannerAgentInput,
  ForeshadowPlanningObligation,
  ForeshadowPlanningRejection,
} from '../../agents/types.js'
import { getChapterPlannerAgent } from '../agent-factory.js'
import { buildNextChapterBoundaryHint } from '../../utils/outline-boundary.js'
import { toDisplayChapterNumber } from '../../utils/chapter-display.js'
import { buildChapterAgentContext, mergeAgentState } from '../utils/chapter-context.js'
import { selectChapterSummaries } from '../../utils/chapter-summaries.js'
import type { ModelProvider } from '../../model/provider.js'
import { renderVerifiedConstraints } from '../../utils/verified-constraints.js'
import { findForeshadowFulfillmentConflictIds } from '../../story-memory/foreshadow-alias.js'
import {
  validatePlannedStoryEventAuthority,
  type PlannedStoryEventAuthorityIssue,
} from '../../story-memory/event-authority.js'

function formatAuthorityIssue(issue: PlannedStoryEventAuthorityIssue): string {
  return `expectedEvents[${issue.index}].${issue.field} 引用了未授权 ID ${issue.id}（事件类型：${issue.eventType}）`
}

async function runPlanChapter(
  provider: ModelProvider,
  state: ReducedGraphState,
  outlineOverride?: string,
  foreshadowPlanning?: {
    foreshadowObligations?: ForeshadowPlanningObligation[]
    foreshadowPlanningRejection?: ForeshadowPlanningRejection
  }
): Promise<Partial<ReducedGraphState>> {
  const agent = getChapterPlannerAgent(provider)
  const chapterIndex = state.currentChapterIndex

  const baseContext = await buildChapterAgentContext(state, chapterIndex, provider)
  const verifiedConstraints = renderVerifiedConstraints(state.verifiedConstraints)

  const agentState: ChapterPlannerAgentInput = mergeAgentState(baseContext, {
    outline: outlineOverride ?? formatChapterOutlineForAgent(state, chapterIndex),
    chapterSummaries: selectChapterSummaries(state.chapters, chapterIndex),
    ...(state.pendingIssues && state.pendingIssues.length > 0
      ? { issues: state.pendingIssues }
      : {}),
    ...(verifiedConstraints.length > 0 ? { verifiedConstraints } : {}),
    ...(foreshadowPlanning?.foreshadowObligations
      ? { foreshadowObligations: foreshadowPlanning.foreshadowObligations }
      : {}),
    ...(foreshadowPlanning?.foreshadowPlanningRejection
      ? { foreshadowPlanningRejection: foreshadowPlanning.foreshadowPlanningRejection }
      : {}),
  }) as ChapterPlannerAgentInput

  let output: Awaited<ReturnType<typeof agent.run>> | undefined
  let lastError = '无法生成章节规划。请检查模型输出或重试。'
  let lastErrorRuleId = 'planning.event-contract'

  for (let attempt = 0; attempt < 2; attempt++) {
    const retryState: ChapterPlannerAgentInput =
      attempt === 0
        ? agentState
        : {
            ...agentState,
            issues: [
              ...(agentState.issues ?? []),
              {
                id: `planner-event-contract-${chapterIndex}`,
                ruleId: lastErrorRuleId,
                type: 'outline_invalid',
                severity: 'error',
                description: `${lastError}（修复提示：expectedEvents 中所有 ID 字段必须使用上下文已提供的权威机器可读 ID；没有权威 ID 的无名临时角色禁止出现在 expectedEvents 中，禁止用中文名或自造 ID 充当 ID 字段，其动作只写入 sections/timeline 文本。）`,
              },
            ],
          }
    output = await agent.run(retryState)
    if (!output.success || !output.data) {
      lastError = output.error ?? lastError
      lastErrorRuleId = 'planning.event-contract'
      continue
    }

    const candidate = output.data as Partial<ChapterPlan>
    const authorityIssues = validatePlannedStoryEventAuthority(
      state,
      Array.isArray(candidate.expectedEvents) ? candidate.expectedEvents : []
    )
    if (authorityIssues.length > 0) {
      lastError = formatAuthorityIssue(authorityIssues[0]!)
      lastErrorRuleId = 'planning.event-authority'
      output = { success: false, error: lastError }
      continue
    }
    break
  }

  if (!output?.success || !output.data) {
    throw new Error(`第 ${chapterIndex + 1} 章规划失败：${lastError}`)
  }

  const parsedPlan: ChapterPlan = {
    expectedEvents: [],
    claimedMandatoryBeatIds: [],
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
  const conflictIds = findForeshadowFulfillmentConflictIds(
    state.storyMemory,
    parsedPlan.expectedEvents
  )
  const { foreshadowFulfillmentConflictIds: _modelSuppliedConflictIds, ...plan } = parsedPlan
  const chapterPlan: ChapterPlan = {
    ...plan,
    ...(conflictIds.length > 0 ? { foreshadowFulfillmentConflictIds: conflictIds } : {}),
    expectedEvents: parsedPlan.expectedEvents.map((event) => ({
      ...event,
      chapterIndex,
    })),
  }

  return { chapterPlan }
}

export async function plan_chapter_with_override(
  provider: ModelProvider,
  state: ReducedGraphState,
  outlineOverride: string,
  foreshadowPlanning?: {
    foreshadowObligations?: ForeshadowPlanningObligation[]
    foreshadowPlanningRejection?: ForeshadowPlanningRejection
  }
): Promise<Partial<ReducedGraphState>> {
  return runPlanChapter(provider, state, outlineOverride, foreshadowPlanning)
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
