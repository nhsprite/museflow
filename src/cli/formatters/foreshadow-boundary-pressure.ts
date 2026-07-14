import { getBoundaryBlockingForeshadowDetails } from '../../story-memory/foreshadow-policy.js'
import type { ReducedGraphState } from '../../graph/state.js'
import type { ActArc } from '../../types/outline.js'

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
    `${indent}伏笔边界压力: ${entries.length} 个 required 伏笔待回收`,
    `${indent}待回收伏笔:`,
    ...entries.map((entry, index) => {
      const introducedChapter = entry.introducedIn + 1
      const deadline =
        entry.expectedFulfillChapter === null
          ? '未设预计章节'
          : `预计第 ${entry.expectedFulfillChapter} 章回收`
      return `${indent}  ${index + 1}. ${entry.id}（引入第 ${introducedChapter} 章，${deadline}）`
    }),
  ]
}
