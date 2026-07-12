import type { ChapterMeta } from '../types/chapter.js'

/**
 * 从权威源 `chapters` 现算已定稿章节的摘要列表。
 *
 * 历史上 `chapterSummaries` 作为独立状态字段维护，append 时按内容去重，
 * 与既有摘要雷同的新摘要会被漏掉，导致数组下标与章号错位（下游按下标
 * 取摘要时串章）。改为读取方按需现算后，摘要永远与 `chapters` 下标对齐，
 * 相邻章节摘要雷同也不再丢失。
 *
 * 返回 `chapters[0, upToChapterIndex)` 范围内、已生成摘要的章节摘要（按章序，
 * 空摘要跳过——与历史字段从不写入空摘要的行为一致）。
 */
export function selectChapterSummaries(
  chapters: ReadonlyArray<ChapterMeta | null> | undefined,
  upToChapterIndex: number
): string[] {
  if (!chapters) return []
  return chapters
    .slice(0, upToChapterIndex)
    .map((chapter) => chapter?.summary ?? '')
    .filter((summary) => summary.length > 0)
}
