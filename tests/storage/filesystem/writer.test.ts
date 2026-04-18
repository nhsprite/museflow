import { afterEach, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { listChapterFiles, readChapterContent, writeChapterContent } from '../../../src/storage/filesystem/writer.ts'

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

    expect(existsSync(join(outputDir, 'chapter_2.md'))).toBe(true)
    expect(await readChapterContent(outputDir, 2)).toBe('# Chapter 2')
    expect(await listChapterFiles(outputDir)).toEqual([2])
  })
})
