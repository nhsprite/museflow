import {
  getBoundaryBlockingForeshadowDetails,
  groupActiveForeshadowsByPolicy,
} from '../../story-memory/foreshadow-policy.js'
import type { ReducedGraphState } from '../../graph/state.js'
import type { ActArc } from '../../types/outline.js'
import type { StoryMemory } from '../../types/story-memory.js'

const MAX_FORESHADOW_TEXT_LENGTH = 60

function formatForeshadowText(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  const characters = Array.from(normalized)

  if (characters.length <= MAX_FORESHADOW_TEXT_LENGTH) return normalized

  return `${characters.slice(0, MAX_FORESHADOW_TEXT_LENGTH).join('')}…`
}

export function formatActiveForeshadowStatus(memory: StoryMemory | null, indent = ''): string {
  if (!memory) return `${indent}伏笔状态: 未知（StoryMemory 不可用）`

  const groups = groupActiveForeshadowsByPolicy(memory)
  const activeTotal =
    groups.mustResolve.length + groups.shouldResolve.length + groups.mayRemainOpen.length

  if (activeTotal === 0) return `${indent}伏笔状态: 0 个未结`

  return `${indent}伏笔状态: ${activeTotal} 个未结（必须回收 ${groups.mustResolve.length} / 建议自然回收 ${groups.shouldResolve.length} / 可保持开放 ${groups.mayRemainOpen.length}）`
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
