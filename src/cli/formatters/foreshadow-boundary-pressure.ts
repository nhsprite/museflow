import { getBoundaryBlockingForeshadowDetails } from '../../story-memory/foreshadow-policy.js'
import type { ReducedGraphState } from '../../graph/state.js'
import type { ActArc } from '../../types/outline.js'

const MAX_FORESHADOW_TEXT_LENGTH = 60

function formatForeshadowText(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  const characters = Array.from(normalized)

  if (characters.length <= MAX_FORESHADOW_TEXT_LENGTH) return normalized

  return `${characters.slice(0, MAX_FORESHADOW_TEXT_LENGTH).join('')}…`
}

export function formatActForeshadowBoundaryPressure(
  state: ReducedGraphState,
  act: ActArc,
  indent = ''
): string[] {
  const memory = state.storyMemory
  if (!memory) return [`${indent}伏笔边界压力: 未知（StoryMemory 不可用）`]

  const finalActIndex = state.storyArc?.acts.at(-1)?.index
  const entries = getBoundaryBlockingForeshadowDetails(
    memory,
    act.endChapter,
    act.index === finalActIndex
  )

  if (entries.length === 0) return [`${indent}伏笔边界压力: 0`]

  return [
    `${indent}伏笔边界压力: ${entries.length} 个 must_resolve 硬义务待回收`,
    `${indent}必须回收伏笔:`,
    ...entries.map((entry, index) => {
      const introducedChapter = entry.introducedIn + 1
      const deadline =
        entry.expectedFulfillChapter === null
          ? '未设预计章节'
          : `预计第 ${entry.expectedFulfillChapter} 章回收`
      return `${indent}  ${index + 1}. [${entry.id}] "${formatForeshadowText(entry.text)}"（引入第 ${introducedChapter} 章，${deadline}）`
    }),
  ]
}
