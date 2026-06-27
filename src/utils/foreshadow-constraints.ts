import type { ForeshadowItem } from '../types/foreshadow.js'

export function generateForeshadowConstraints(
  foreshadowStack: ForeshadowItem[],
  currentChapter: number
): string[] {
  return foreshadowStack
    .filter(
      f =>
        f.createdAtChapter === currentChapter &&
        !f.fulfilledChapter &&
        f.expectedFulfillChapter > currentChapter
    )
    .map(
      f =>
        `【伏笔边界】第${currentChapter}章埋下的伏笔（预期第${f.expectedFulfillChapter}章回收）不得在预期回收章节之前被角色完全推理清楚或向读者完整揭示其悬念内核：${f.text}`
    )
}
