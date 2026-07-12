import { describe, expect, it } from 'vitest'
import { selectChapterSummaries } from '../../src/utils/chapter-summaries.js'
import type { ChapterMeta } from '../../src/types/chapter.js'

function makeChapter(number: number, summary: string | null): ChapterMeta {
  return {
    id: `ch_${number}`,
    storyId: 'story-1',
    number,
    title: null,
    outline: null,
    summary,
    foreshadows: null,
    status: 'done',
    createdAt: 0,
    updatedAt: 0,
  }
}

describe('selectChapterSummaries', () => {
  it('returns summaries of finalized chapters before the given index, in chapter order', () => {
    const chapters = [
      makeChapter(1, '第一章摘要'),
      makeChapter(2, '第二章摘要'),
      makeChapter(3, '第三章摘要'),
      null,
    ]

    expect(selectChapterSummaries(chapters, 3)).toEqual(['第一章摘要', '第二章摘要', '第三章摘要'])
    expect(selectChapterSummaries(chapters, 2)).toEqual(['第一章摘要', '第二章摘要'])
    expect(selectChapterSummaries(chapters, 0)).toEqual([])
  })

  it('keeps identical adjacent summaries instead of deduplicating by content (index stays aligned)', () => {
    // 回归：历史 chapterSummaries 字段 append 时按内容去重，相邻两章摘要雷同
    // 会漏追加，导致数组下标与章号错位。现算口径下两章摘要都必须保留。
    const chapters = [
      makeChapter(1, '主角在客栈休息，整理行囊。'),
      makeChapter(2, '主角在客栈休息，整理行囊。'),
      makeChapter(3, '主角启程离开小镇。'),
    ]

    const summaries = selectChapterSummaries(chapters, 3)

    expect(summaries).toEqual([
      '主角在客栈休息，整理行囊。',
      '主角在客栈休息，整理行囊。',
      '主角启程离开小镇。',
    ])
    expect(summaries).toHaveLength(3)
  })

  it('skips chapters without a summary and tolerates null slots or missing arrays', () => {
    const chapters = [makeChapter(1, '第一章摘要'), null, makeChapter(3, null)]

    expect(selectChapterSummaries(chapters, 3)).toEqual(['第一章摘要'])
    expect(selectChapterSummaries(undefined, 3)).toEqual([])
    expect(selectChapterSummaries([], 3)).toEqual([])
  })
})
