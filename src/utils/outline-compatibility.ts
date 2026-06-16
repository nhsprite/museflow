import type { ChapterOutline } from '../graph/state.js'

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

export function findRedundantOutlineEvents(outline: ChapterOutline[], chapterIndex: number): RedundantEvent[] {
  if (chapterIndex <= 0) return []

  const previous = outline[chapterIndex - 1]
  const current = outline[chapterIndex]
  if (!previous?.description || !current?.description) return []

  const redundant: RedundantEvent[] = []

  const previousTerminal = terminalKeywords.find(keyword => previous.description.includes(keyword))
  const currentResolution = resolutionKeywords.find(keyword => current.description.includes(keyword))
  if (previousTerminal && currentResolution) {
    redundant.push({
      previousChapter: previous.number,
      previousTitle: previous.title,
      previousKeyword: previousTerminal,
      currentChapter: current.number,
      currentTitle: current.title,
      currentKeyword: currentResolution,
      reason: 'terminal_then_resolution',
    })
  }

  const previousContainment = containmentKeywords.find(keyword => previous.description.includes(keyword))
  if (previousContainment && currentResolution) {
    const alreadyPushed = redundant.some(
      r => r.previousChapter === previous.number && r.currentChapter === current.number
    )
    if (!alreadyPushed) {
      redundant.push({
        previousChapter: previous.number,
        previousTitle: previous.title,
        previousKeyword: previousContainment,
        currentChapter: current.number,
        currentTitle: current.title,
        currentKeyword: currentResolution,
        reason: 'containment_then_resolution',
      })
    }
  }

  return redundant
}

export function buildNextChapterBoundaryHint(outline: ChapterOutline[], chapterIndex: number): string {
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
