import { afterEach, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { listChapterFiles, readChapterContent, writeChapterContent, writeOutlineContent } from '../../../src/storage/filesystem/writer.ts'

describe('filesystem writer', () => {
  const createdDirs: string[] = []

  afterEach(async () => {
    await Promise.all(createdDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
  })

  it('writes, reads, and lists chapters inside the provided output directory', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'museflow-writer-'))
    const outputDir = join(baseDir, 'legacy-custom-folder')
    createdDirs.push(baseDir)

    await writeChapterContent(outputDir, 2, '# Chapter 2')

    expect(existsSync(join(outputDir, 'chapters', 'chapter_2.md'))).toBe(true)
    expect(await readChapterContent(outputDir, 2)).toBe('# Chapter 2')
    expect(await listChapterFiles(outputDir)).toEqual([2])
  })

  it('writes outline as markdown to outline.md', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'museflow-outline-'))
    const outputDir = join(baseDir, 'my-story')
    createdDirs.push(baseDir)

    await writeOutlineContent(outputDir, '少年修仙录', [
      { number: 1, title: '觉醒', description: '少年在山中偶得奇缘，觉醒灵根。' },
      { number: 2, title: '入门', description: '少年拜入太虚宗，开始修真之路。' },
    ])

    const outlinePath = join(outputDir, 'outline.md')
    expect(existsSync(outlinePath)).toBe(true)
    const { readFile } = await import('node:fs/promises')
    const text = await readFile(outlinePath, 'utf-8')
    expect(text).toContain('# 少年修仙录')
    expect(text).toContain('## 章节大纲')
    expect(text).toContain('### 第1章 觉醒')
    expect(text).toContain('少年在山中偶得奇缘，觉醒灵根。')
    expect(text).toContain('### 第2章 入门')
    expect(text).toContain('少年拜入太虚宗，开始修真之路。')
  })
})
