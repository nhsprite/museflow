import type { ForeshadowItem } from '../types/foreshadow.js'

export function formatExpectedFulfillChapter(expectedFulfillChapter: number): string {
  return expectedFulfillChapter >= Number.MAX_SAFE_INTEGER
    ? '全书结尾'
    : `第${expectedFulfillChapter}章`
}

/**
 * 生成伏笔边界约束（不得提前揭示悬念内核）。
 *
 * 约束从伏笔埋下章节开始生效，一直存活到预期回收章节（不含），而不是只在
 * 埋下的当章存在。返回带稳定结构化 id 的记录，finalize 按 id 去重重建。
 */
export function generateForeshadowConstraints(
  foreshadowStack: ForeshadowItem[],
  currentChapter: number
): Array<{ id: string; text: string }> {
  return foreshadowStack
    .filter(
      (f) =>
        f.createdAtChapter <= currentChapter &&
        f.fulfilledChapter === undefined &&
        f.expectedFulfillChapter > currentChapter
    )
    .map((f) => ({
      id: `foreshadow-boundary:${f.id}`,
      text: `【伏笔边界】第${f.createdAtChapter}章埋下的伏笔（预期${formatExpectedFulfillChapter(f.expectedFulfillChapter)}回收）不得在预期回收章节之前被角色完全推理清楚或向读者完整揭示其悬念内核：${f.text}`,
    }))
}
