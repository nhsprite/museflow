import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { logger } from '../../utils/logger.js'
import { getChapterFilePath, getStoryOutputDir } from '../../utils/paths.js'

export async function ensureStoryDir(storyId: string): Promise<void> {
  const dir = getStoryOutputDir(storyId)
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true })
    logger.debug(`Created story output directory: ${dir}`)
  }
}

export async function writeChapterContent(
  storyId: string,
  chapterNumber: number,
  content: string,
): Promise<void> {
  await ensureStoryDir(storyId)
  const filePath = getChapterFilePath(storyId, chapterNumber)
  await writeFile(filePath, content, 'utf-8')
  logger.debug(`Chapter ${chapterNumber} written to: ${filePath}`)
}

export async function readChapterContent(
  storyId: string,
  chapterNumber: number,
): Promise<string | null> {
  const filePath = getChapterFilePath(storyId, chapterNumber)
  if (!existsSync(filePath)) return null
  return readFile(filePath, 'utf-8')
}

export async function listChapterFiles(storyId: string): Promise<number[]> {
  const { readdirSync } = await import('node:fs')
  const dir = getStoryOutputDir(storyId)
  if (!existsSync(dir)) return []

  const files = readdirSync(dir).filter(f => f.endsWith('.md'))
  const numbers = files
    .map(f => {
      const m = f.match(/^chapter_(\d+)\.md$/)
      return m ? parseInt(m[1]!, 10) : null
    })
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b)

  return numbers
}
