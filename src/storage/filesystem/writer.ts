import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { logger } from '../../utils/logger.js'
import { getChapterFilePath } from '../../utils/paths.js'

export async function ensureStoryDir(outputDir: string): Promise<void> {
  if (!existsSync(outputDir)) {
    await mkdir(outputDir, { recursive: true })
    logger.debug(`Created story output directory: ${outputDir}`)
  }
}

export async function writeChapterContent(
  outputDir: string,
  chapterNumber: number,
  content: string,
): Promise<void> {
  await ensureStoryDir(outputDir)
  const filePath = getChapterFilePath(outputDir, chapterNumber)
  await writeFile(filePath, content, 'utf-8')
  logger.debug(`Chapter ${chapterNumber} written to: ${filePath}`)
}

export async function readChapterContent(
  outputDir: string,
  chapterNumber: number,
): Promise<string | null> {
  const filePath = getChapterFilePath(outputDir, chapterNumber)
  if (!existsSync(filePath)) return null
  return readFile(filePath, 'utf-8')
}

export async function listChapterFiles(outputDir: string): Promise<number[]> {
  const { readdirSync } = await import('node:fs')
  if (!existsSync(outputDir)) return []

  const files = readdirSync(outputDir).filter(f => f.endsWith('.md'))
  const numbers = files
    .map(f => {
      const m = f.match(/^chapter_(\d+)\.md$/)
      return m ? parseInt(m[1]!, 10) : null
    })
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b)

  return numbers
}
