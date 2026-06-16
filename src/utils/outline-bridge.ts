import type { ChapterOutline } from '../graph/state.js'

const terminalKeywords = ['伏法', '伏妖', '处死', '消灭', '死亡', '已死', '被灭', '已毁', '已除', '已诛', '已斩']
const resolutionKeywords = ['辨别', '审判', '查明', '验证', '确认', '分辨', '识别', '识破', '揭露', '查证']

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

  const terminalKeyword = terminalKeywords.find(keyword => current.description.includes(keyword))
  const hasNextResolution = resolutionKeywords.some(keyword => next.description.includes(keyword))
  if (!terminalKeyword || !hasNextResolution) {
    return ''
  }

  return `<outline_bridge>
<important>【跨章节大纲桥接】</important>
本章大纲包含"${terminalKeyword}"，但第${next.number}章"${next.title}"仍需对相关事件进行后续辨别、验证或处理。

<mandatory>【强制解释】请将本章的"${terminalKeyword}"理解为：相关角色/势力被制服、受控或暂时收押，而不是彻底死亡、彻底消灭或永久退出故事。</mandatory>
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

  const terminalKeyword = terminalKeywords.find(keyword => previous.description.includes(keyword))
  const hasCurrentResolution = resolutionKeywords.some(keyword => current.description.includes(keyword))
  if (!terminalKeyword || !hasCurrentResolution) {
    return ''
  }

  return `<outline_bridge>
<important>【跨章节大纲桥接 - 逆向冲突】</important>
第${previous.number}章"${previous.title}"包含"${terminalKeyword}"，而本章（第${current.number}章）"${current.title}"仍需对相关事件进行后续辨别、验证或处理。

<mandatory>【强制解释】如果第${previous.number}章已经彻底解决该事件，本章不得重复处理或重新展开；请将本章内容写成后续发展、余波或新转折，而非对同一事件的再次审判/辨别。</mandatory>
<mandatory>【强制要求】本章必须与第${previous.number}章保持严格连续：若前章已将相关角色/势力制服、收押或消灭，本章不可将其写成再次活跃或未被处理。若前章仅暂时制服，本章可继续后续辨别/审判，但必须明确交代过渡。</mandatory>
</outline_bridge>`
}

export function shouldForceTemporaryReplan(outline: ChapterOutline[], chapterIndex: number): boolean {
  return buildOutlineBridgeHint(outline, chapterIndex).length > 0
}
