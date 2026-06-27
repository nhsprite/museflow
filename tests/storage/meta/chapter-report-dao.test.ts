import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  saveChapterReport,
  readChapterReport,
  listChapterReports,
} from '../../../src/storage/meta/stores/chapter-report.js'
import { createEmptyChapterReport } from '../../../src/types/chapter-report.js'
import { countChineseWords } from '../../../src/utils/text.js'

describe('chapter-report DAO', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'museflow-report-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('saves and reads a chapter report', () => {
    const report = createEmptyChapterReport('story_abc', 2)
    report.chapterTitle = '测试章节'
    report.wordCount = 1234
    report.convergence = 'success'

    saveChapterReport(tempDir, report)

    const reportsDir = join(tempDir, 'reports')
    expect(existsSync(reportsDir)).toBe(true)

    const read = readChapterReport(tempDir, 2)
    expect(read).not.toBeNull()
    expect(read!.storyId).toBe('story_abc')
    expect(read!.chapterIndex).toBe(2)
    expect(read!.chapterTitle).toBe('测试章节')
    expect(read!.wordCount).toBe(1234)
    expect(read!.convergence).toBe('success')
  })

  it('returns null when report does not exist', () => {
    const read = readChapterReport(tempDir, 0)
    expect(read).toBeNull()
  })

  it('lists reports in chapter order', () => {
    const report1 = createEmptyChapterReport('story_abc', 0)
    report1.chapterTitle = '第一章'
    const report3 = createEmptyChapterReport('story_abc', 2)
    report3.chapterTitle = '第三章'
    const report2 = createEmptyChapterReport('story_abc', 1)
    report2.chapterTitle = '第二章'

    saveChapterReport(tempDir, report1)
    saveChapterReport(tempDir, report3)
    saveChapterReport(tempDir, report2)

    const list = listChapterReports(tempDir)
    expect(list.map(r => r.chapterTitle)).toEqual(['第一章', '第二章', '第三章'])
  })

  it('ignores malformed report files when listing', () => {
    const reportsDir = join(tempDir, 'reports')
    mkdirSync(reportsDir, { recursive: true })
    writeFileSync(join(reportsDir, 'chapter_1.report.json'), 'not json', 'utf-8')

    const list = listChapterReports(tempDir)
    expect(list).toHaveLength(0)
  })
})

describe('countChineseWords', () => {
  it('counts Chinese characters and English words', () => {
    expect(countChineseWords('hello world 你好')).toBe(2 + 2)
  })
})
