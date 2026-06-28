import type { ChapterOutline } from '../types/outline.js'
import type { ReducedGraphState } from '../graph/state.js'
import { filterRelevantPendingTasks } from './pending-tasks.js'
import type { ChapterPlanningConfig } from '../types/genre.js'
import type { ModelProvider } from '../model/provider.js'

export function buildNextChapterBoundaryHint(
  outline: ChapterOutline[],
  chapterIndex: number
): string {
  const next = outline[chapterIndex + 1]
  if (!next?.title) return ''

  return `<next_chapter_boundary>
<important>【后续章节边界提示】</important>
下一章为第${next.number}章"${next.title}"。本章结尾必须为其保留合理过渡空间，不要把后续章节的核心事件提前解决或收尾。如果本章与第${next.number}章存在事件连续性，本章只负责推进到合适的中转状态，不要代替后续章节完成其核心事件。

<mandatory>【强制要求】严禁在本章写出下一章标题所暗示的具体情节、角色行动或秘密揭示；本章只能铺垫、留白或制造悬念。</mandatory>
</next_chapter_boundary>`
}

export function shouldForceTemporaryReplan(
  _outline: ChapterOutline[],
  _chapterIndex: number
): boolean {
  // 不再基于关键词列表强制重新规划；规划阶段的 absolute_constraints 与预算校验负责控制章节边界。
  return false
}

export async function reconcileOutlineWithState(
  state: ReducedGraphState,
  chapterIndex: number,
  config: ChapterPlanningConfig,
  provider?: ModelProvider,
): Promise<string> {
  const outlineItem = state.outline[chapterIndex]
  if (!outlineItem) return ''

  const pendingTasks = state.storyState?.pendingTasks ?? []
  const relevantTasks = await filterRelevantPendingTasks(
    pendingTasks,
    chapterIndex,
    outlineItem.description,
    provider,
  )
  if (relevantTasks.length === 0) return ''

  const nextItem = state.outline[chapterIndex + 1]
  const nextTitle = nextItem ? `第${nextItem.number}章"${nextItem.title}"` : '后续章节'

  return `<pending_tasks>
<important>【前章遗留差事 - 本章规划必须处理或说明】</important>
${relevantTasks.map(t => {
    const due = t.dueTime ?? (t.dueChapter ? `第${t.dueChapter}章前` : '未指定')
    return `- ${t.assignee}：${t.description}（截止：${due}）`
  }).join('\n')}

<mandatory>【强制要求】
1. 以上差事来自前章角色领受的任务，本章计划必须对每条差事给出明确处理：
   - executed：在本章某 section 中执行该差事（仅当该差事与第 ${outlineItem.number} 章大纲核心事件直接相关，且该差事描述与大纲描述有明确关键词重叠时）
   - postponed：明确推迟到 ${nextTitle} 或更晚，并说明原因（当差事与第 ${outlineItem.number} 章核心事件无关、或会挤占核心事件篇幅时，优先选择此项）
   - background：一句话带过，总字数不得超过 ${config.maxBackgroundTaskWordCount} 字，不得写成独立场景
   - superseded：因后续大纲覆盖而取消，并说明原因
2. 只有本章大纲描述中明确出现该差事的核心动作或关键角色时，才允许标记为 executed 并分配独立场景。
3. 如果本章大纲未包含该差事，即使差事 deadline 落在本章，也必须在 timeline 或 taskResolutions 中说明去向。优先选择 background 或 postponed，不得以"差事今日到期"为由把无关差事扩展为独立大场景或分配超过 ${Math.round(config.maxExecutedTaskRatio * 100)}% 的总字数。
4. 禁止为了把差事塞进本章而歪曲大纲核心事件；如果确实无法容纳，选择 postponed 并给出合理原因。
5. 【硬性规则】任何标记为 postponed 或 background 的差事，不得在 sections 中分配独立场景。</mandatory>
</pending_tasks>`
}
