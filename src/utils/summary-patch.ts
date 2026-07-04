import type { CanonicalFact } from '../types/story-state.js'

/**
 * 保留旧入口，但不再通过自然语言片段匹配改写摘要。
 *
 * 权威事实覆盖应通过 canonical facts 时间线呈现；在没有结构化句子定位的情况下，
 * 运行时代码不能按 oldValue 片段搜索并改写自然语言摘要。
 */
export function patchChapterSummaryWithFacts(
  summary: string,
  facts: CanonicalFact[],
  chapterIndex: number
): string {
  void facts
  void chapterIndex
  return summary
}
