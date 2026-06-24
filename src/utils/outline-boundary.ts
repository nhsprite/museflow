import type { ChapterOutline } from '../graph/state.js'
import type { ReducedGraphState } from '../graph/state.js'

const terminalKeywords = ['伏法', '伏妖', '处死', '消灭', '死亡', '已死', '被灭', '已毁', '已除', '已诛', '已斩']
const containmentKeywords = ['封印', '封入', '收押', '缚住', '捆住', '被困', '囚禁', '制服', '被擒', '落网', '就擒']
const resolutionKeywords = ['辨别', '审判', '查明', '验证', '确认', '分辨', '识别', '识破', '揭露', '查证', '伏妖', '降伏', '收服']

export interface RedundantEvent {
  previousChapter: number
  previousTitle: string
  previousKeyword: string
  currentChapter: number
  currentTitle: string
  currentKeyword: string
  reason: 'terminal_then_resolution' | 'containment_then_resolution'
}

function findFirstKeyword(text: string, keywords: string[]): string | undefined {
  return keywords.find(keyword => text.includes(keyword))
}

function detectRedundantEvent(
  previous: ChapterOutline,
  current: ChapterOutline
): RedundantEvent | null {
  if (!previous.description || !current.description) {
    return null
  }

  const previousTerminal = findFirstKeyword(previous.description, terminalKeywords)
  const currentResolution = findFirstKeyword(current.description, resolutionKeywords)

  if (previousTerminal && currentResolution) {
    return {
      previousChapter: previous.number,
      previousTitle: previous.title,
      previousKeyword: previousTerminal,
      currentChapter: current.number,
      currentTitle: current.title,
      currentKeyword: currentResolution,
      reason: 'terminal_then_resolution',
    }
  }

  const previousContainment = findFirstKeyword(previous.description, containmentKeywords)
  if (previousContainment && currentResolution) {
    return {
      previousChapter: previous.number,
      previousTitle: previous.title,
      previousKeyword: previousContainment,
      currentChapter: current.number,
      currentTitle: current.title,
      currentKeyword: currentResolution,
      reason: 'containment_then_resolution',
    }
  }

  return null
}

export function findRedundantOutlineEvents(
  outline: ChapterOutline[],
  chapterIndex: number
): RedundantEvent[] {
  if (chapterIndex <= 0) return []

  const previous = outline[chapterIndex - 1]
  const current = outline[chapterIndex]
  if (!previous?.description || !current?.description) return []

  const event = detectRedundantEvent(previous, current)
  return event ? [event] : []
}

export function buildOutlineBridgeHint(outline: ChapterOutline[], chapterIndex: number): string {
  const forwardHint = buildForwardBridgeHint(outline, chapterIndex)
  const backwardHint = buildBackwardBridgeHint(outline, chapterIndex)
  return [forwardHint, backwardHint].filter(part => part.length > 0).join('\n')
}

function buildForwardBridgeHint(outline: ChapterOutline[], chapterIndex: number): string {
  const current = outline[chapterIndex]
  const next = outline[chapterIndex + 1]
  if (!current?.description || !next?.description) {
    return ''
  }

  const event = detectRedundantEvent(current, next)
  if (!event) {
    return ''
  }

  return `<outline_bridge>
<important>【跨章节大纲桥接】</important>
本章大纲包含"${event.previousKeyword}"，但第${event.currentChapter}章"${event.currentTitle}"仍需对相关事件进行后续辨别、验证或处理。

<mandatory>【强制解释】请将本章的"${event.previousKeyword}"理解为：相关角色/势力被制服、受控或暂时收押，而不是彻底死亡、彻底消灭或永久退出故事。</mandatory>
<mandatory>【强制要求】不得写成彻底死亡、彻底消灭或永久退出故事；本章结尾必须为后续章节保留继续辨别、审判或最终处置的叙事空间。</mandatory>
</outline_bridge>`
}

function buildBackwardBridgeHint(outline: ChapterOutline[], chapterIndex: number): string {
  if (chapterIndex <= 0) {
    return ''
  }

  const previous = outline[chapterIndex - 1]
  const current = outline[chapterIndex]
  if (!previous?.description || !current?.description) {
    return ''
  }

  const event = detectRedundantEvent(previous, current)
  if (!event) {
    return ''
  }

  return `<outline_bridge>
<important>【跨章节大纲桥接 - 逆向冲突】</important>
第${event.previousChapter}章"${event.previousTitle}"包含"${event.previousKeyword}"，而本章（第${event.currentChapter}章）"${event.currentTitle}"仍需对相关事件进行后续辨别、验证或处理。

<mandatory>【强制解释】如果第${event.previousChapter}章已经彻底解决该事件，本章不得重复处理或重新展开；请将本章内容写成后续发展、余波或新转折，而非对同一事件的再次审判/辨别。</mandatory>
<mandatory>【强制要求】本章必须与第${event.previousChapter}章保持严格连续：若前章已将相关角色/势力制服、收押或消灭，本章不可将其写成再次活跃或未被处理。若前章仅暂时制服，本章可继续后续辨别/审判，但必须明确交代过渡。</mandatory>
</outline_bridge>`
}

export function buildNextChapterBoundaryHint(
  outline: ChapterOutline[],
  chapterIndex: number
): string {
  const next = outline[chapterIndex + 1]
  if (!next?.description) return ''

  const redundant = findRedundantOutlineEvents(outline, chapterIndex + 1)
  const hasConflict = redundant.length > 0

  const nextChapterSummary = `第${next.number}章"${next.title}"大纲：${next.description}`

  if (!hasConflict) {
    return `<next_chapter_boundary>
<important>【后续章节边界提示】</important>
${nextChapterSummary}

<mandatory>【强制要求】本章结尾必须为第${next.number}章的内容保留合理过渡空间，不要把后续章节的核心事件提前解决或收尾。如果本章与第${next.number}章存在事件连续性，本章只负责推进到合适的中转状态，不要代替后续章节完成其核心事件。</mandatory>
</next_chapter_boundary>`
  }

  const conflict = redundant[0]
  if (!conflict) return ''

  return `<next_chapter_boundary>
<important>【严重跨章节边界冲突】</important>
第${conflict.previousChapter}章"${conflict.previousTitle}"已包含"${conflict.previousKeyword}"，但第${conflict.currentChapter}章"${conflict.currentTitle}"又要"${conflict.currentKeyword}"。

<mandatory>【强制解释】这意味着同一核心事件在两章大纲中被重复处理。本章（第${chapterIndex + 1}章）的写作必须做到：
1. 不得把"${conflict.currentKeyword}"涉及的事件彻底解决、收尾或提前完成，要把核心处理留给第${conflict.currentChapter}章
2. 不要把已经被第${conflict.previousChapter}章制服/封印/处置的角色/势力再次写成需要被"${conflict.currentKeyword}"的状态
3. 本章只能写到事件的中转状态、余波或后续发展，把真正的"${conflict.currentKeyword}"留给第${conflict.currentChapter}章处理
4. 如果第${conflict.previousChapter}章已经将相关角色封印/收押，本章应保持该状态，不要让其再次活跃或逃脱</mandatory>

${nextChapterSummary}

<mandatory>【强制要求】本章结尾状态必须明确支持第${conflict.currentChapter}章的"${conflict.currentKeyword}"，而不是替代它完成。不得在本章彻底解决。</mandatory>
</next_chapter_boundary>`
}

export function shouldForceTemporaryReplan(outline: ChapterOutline[], chapterIndex: number): boolean {
  return buildOutlineBridgeHint(outline, chapterIndex).length > 0
}

export function reconcileOutlineWithState(
  state: ReducedGraphState,
  chapterIndex: number
): string {
  const outlineItem = state.outline[chapterIndex]
  if (!outlineItem) return ''

  const pendingTasks = state.storyState?.pendingTasks ?? []
  const dueTasks = pendingTasks.filter(t => t.status === 'pending')
  if (dueTasks.length === 0) return ''

  const nextItem = state.outline[chapterIndex + 1]
  const nextTitle = nextItem ? `第${nextItem.number}章"${nextItem.title}"` : '后续章节'

  return `<pending_tasks>
<important>【前章遗留差事 - 本章规划必须处理或说明】</important>
${dueTasks.map(t => {
    const due = t.dueTime ?? (t.dueChapter ? `第${t.dueChapter}章前` : '未指定')
    return `- ${t.assignee}：${t.description}（截止：${due}）`
  }).join('\n')}

<mandatory>【强制要求】
1. 以上差事来自前章角色领受的任务，本章计划必须对每条差事给出明确处理：
   - executed：在本章某 section 中执行该差事
   - postponed：明确推迟到 ${nextTitle} 或更晚，并说明原因
   - superseded：因后续大纲覆盖而取消，并说明原因
2. 如果本章大纲本身已包含该差事（如"请大掌柜来理账"），直接标记为 executed。
3. 如果本章大纲未包含该差事，不得无故忽略；必须在 timeline 或 taskResolutions 中说明去向。
4. 禁止为了把差事塞进本章而歪曲大纲核心事件；如果确实无法容纳，选择 postponed 并给出合理原因。</mandatory>
</pending_tasks>`
}
