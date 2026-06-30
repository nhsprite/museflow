import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as contextJudge from '../../src/utils/context-judge.js'
import { validateFixedChapterContent, tryCorrectOffByOneChapterHeading } from '../../src/utils/chapter-content-validation.js'
import type { ModelProvider } from '../../src/model/provider.js'

vi.mock('../../src/utils/context-judge.js', () => ({
  batchValidateFixedContent: vi.fn().mockResolvedValue([
    { looksLikeRevisionPlan: false, containsChecklistArtifacts: false },
  ]),
}))

function createProvider(): ModelProvider {
  return { chat: vi.fn() }
}

describe('validateFixedChapterContent', () => {
  beforeEach(() => {
    vi.mocked(contextJudge.batchValidateFixedContent).mockReset()
    vi.mocked(contextJudge.batchValidateFixedContent).mockResolvedValue([
      { looksLikeRevisionPlan: false, containsChecklistArtifacts: false },
    ])
  })

  it('accepts valid chapter content', async () => {
    const content = '# 第四章 王府递帖\n\n卯时刚过，灵堂里已经站满了人。\n\n苏半城垂手立在棺前。'
    const result = await validateFixedChapterContent(content, { chapterIndex: 3, minWordCount: 10 }, createProvider())
    expect(result.valid).toBe(true)
    expect(result.content).toBe(content)
  })

  it('rejects empty content', async () => {
    const result = await validateFixedChapterContent('   ', { chapterIndex: 3, minWordCount: 10 }, createProvider())
    expect(result.valid).toBe(false)
    expect(result.error).toContain('为空')
  })

  it('rejects content without chapter heading', async () => {
    const result = await validateFixedChapterContent('王府递帖。苏半城站在灵堂。', { chapterIndex: 3, minWordCount: 10 }, createProvider())
    expect(result.valid).toBe(false)
    expect(result.error).toContain('标题')
  })

  it('rejects content with wrong chapter number', async () => {
    const result = await validateFixedChapterContent('# 第五章 王府递帖\n\n正文内容。', { chapterIndex: 3, minWordCount: 10 }, createProvider())
    expect(result.valid).toBe(false)
    expect(result.error).toContain('章节号')
  })

  it('rejects content below minimum word count', async () => {
    const result = await validateFixedChapterContent('# 第四章 王府递帖\n\n正文。', { chapterIndex: 3, minWordCount: 100 }, createProvider())
    expect(result.valid).toBe(false)
    expect(result.error).toContain('字数')
  })

  it('rejects revision-plan shaped content', async () => {
    const plan = '# 第四章 王府递帖\n\n问题分析：这段情感层次单一。修复建议：应该增加苏半城的哭泣描写。可以加入陆福的安慰。'
    vi.mocked(contextJudge.batchValidateFixedContent).mockResolvedValueOnce([
      { looksLikeRevisionPlan: true, containsChecklistArtifacts: false },
    ])
    const result = await validateFixedChapterContent(plan, { chapterIndex: 3, minWordCount: 10 }, createProvider())
    expect(result.valid).toBe(false)
    expect(result.error).toContain('修改计划')
  })

  it('rejects pre-write checklist artifacts', async () => {
    const checklist = '# 第四章 王府递帖\n\n| 检查项 | 来源 | 具体要求 |\n| 大纲情节点1 | 大纲 | ... |\n正文开始。'
    vi.mocked(contextJudge.batchValidateFixedContent).mockResolvedValueOnce([
      { looksLikeRevisionPlan: false, containsChecklistArtifacts: true },
    ])
    const result = await validateFixedChapterContent(checklist, { chapterIndex: 3, minWordCount: 10 }, createProvider())
    expect(result.valid).toBe(false)
    expect(result.error).toContain('检查表')
  })
})

describe('tryCorrectOffByOneChapterHeading', () => {
  it('corrects heading when content matches current outline better than next', () => {
    const content = '# 第五章 南城周旋\n\n主角藏身于南城会馆，盘算两日期限。'
    const currentDesc = '主角以南城会馆为藏身点，两日内决定去留。'
    const nextDesc = '主角冒险接回幼子，告知家仇真相。'
    const result = tryCorrectOffByOneChapterHeading(content, 3, currentDesc, nextDesc)
    expect(result).not.toBeNull()
    expect(result!.originalFoundNumber).toBe(5)
    expect(result!.corrected).toContain('# 第4章 南城周旋')
  })

  it('does not correct when content matches next outline better', () => {
    const content = '# 第五章 母子重逢\n\n主角冒险接回幼子，在破庙中讲述家仇。'
    const currentDesc = '主角以南城会馆为藏身点，两日内决定去留。'
    const nextDesc = '主角冒险接回幼子，告知家仇真相。'
    const result = tryCorrectOffByOneChapterHeading(content, 3, currentDesc, nextDesc)
    expect(result).toBeNull()
  })

  it('does not correct when heading is not off by one', () => {
    const content = '# 第六章 王府递帖\n\n主角藏身于南城会馆，盘算两日期限。'
    const currentDesc = '主角以南城会馆为藏身点，两日内决定去留。'
    const nextDesc = '主角冒险接回幼子，告知家仇真相。'
    const result = tryCorrectOffByOneChapterHeading(content, 3, currentDesc, nextDesc)
    expect(result).toBeNull()
  })

  it('does not correct when there is no next chapter outline', () => {
    const content = '# 第五章 南城周旋\n\n主角藏身于南城会馆。'
    const currentDesc = '主角以南城会馆为藏身点。'
    const result = tryCorrectOffByOneChapterHeading(content, 3, currentDesc, undefined)
    expect(result).toBeNull()
  })
})
