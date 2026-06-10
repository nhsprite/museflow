import { mkdir, writeFile, readFile, unlink, rename } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '../../utils/logger.js'
import { getChapterFilePath } from '../../utils/paths.js'

export async function ensureStoryDir(outputDir: string): Promise<void> {
  if (!existsSync(outputDir)) {
    await mkdir(outputDir, { recursive: true })
    logger.debug(`Created story output directory: ${outputDir}`)
  }
  const chaptersDir = join(outputDir, 'chapters')
  if (!existsSync(chaptersDir)) {
    await mkdir(chaptersDir, { recursive: true })
    logger.debug(`Created chapters directory: ${chaptersDir}`)
  }
}

export async function writeChapterContent(
  outputDir: string,
  chapterNumber: number,
  content: string,
): Promise<void> {
  await ensureStoryDir(outputDir)
  const filePath = getChapterFilePath(outputDir, chapterNumber)
  const tmpPath = `${filePath}.tmp`
  await writeFile(tmpPath, content, 'utf-8')
  await rename(tmpPath, filePath)
  logger.debug(`Chapter ${chapterNumber} written to: ${filePath}`)
}

export async function deleteChapterContent(
  outputDir: string,
  chapterNumber: number,
): Promise<void> {
  const filePath = getChapterFilePath(outputDir, chapterNumber)
  try {
    await unlink(filePath)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err
    }
  }
}

export async function writeOutlineContent(
  outputDir: string,
  storyTitle: string,
  outline: { number: number; title: string; description: string }[],
): Promise<void> {
  await ensureStoryDir(outputDir)
  const lines = [`# ${storyTitle || '故事大纲'}`, '', '---', '']
  for (const ch of outline) {
    lines.push(`## 第${ch.number}章　${ch.title}`, '')
    lines.push(ch.description, '')
    lines.push('', '---', '')
  }
  const content = lines.join('\n').trim() + '\n'
  const filePath = join(outputDir, 'outline.md')
  const tmpPath = `${filePath}.tmp`
  await writeFile(tmpPath, content, 'utf-8')
  await rename(tmpPath, filePath)
  logger.debug(`Outline written to: ${filePath}`)
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
  const chaptersDir = join(outputDir, 'chapters')
  if (!existsSync(chaptersDir)) return []

  const files = readdirSync(chaptersDir).filter(f => f.endsWith('.md'))
  const numbers = files
    .map(f => {
      const m = f.match(/^chapter_(\d+)\.md$/)
      return m ? parseInt(m[1]!, 10) : null
    })
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b)

  return numbers
}

interface StoryBibleCharacter {
  id: string
  storyId: string
  name: string
  description: string | null
  dialogueStyle: string | null
  createdAt: number
}

interface StoryBibleOutline {
  number: number
  title: string
  description: string
}

interface StoryBibleWorldDirection {
  cultivationSystem?: string
  coreConflict: string
  worldFeatures: string[]
}

interface StoryBibleStory {
  id: string
  title: string
  idea: string
  genre: string
  worldDirection?: StoryBibleWorldDirection
}

export async function writeStoryBible(
  outputDir: string,
  story: StoryBibleStory,
  worldContent: string,
  characters: StoryBibleCharacter[],
  outline: StoryBibleOutline[],
): Promise<void> {
  await ensureStoryDir(outputDir)

  const lines: string[] = []

  // Header
  lines.push(`# ${story.title || '故事圣经'}`)
  lines.push('')
  lines.push(`> *一句话简介：${story.idea || ''}*`)
  lines.push('')
  lines.push('---')
  lines.push('')

  // 01_世界观
  lines.push('## 01_世界观')
  lines.push('')
  if (story.worldDirection) {
    lines.push('### 核心冲突')
    lines.push(`- *${story.worldDirection.coreConflict}*`)
    lines.push('')
    lines.push('### 世界观特色')
    for (const feature of story.worldDirection.worldFeatures || []) {
      lines.push(`- ${feature}`)
    }
    lines.push('')
  }
  lines.push(worldContent || '')
  lines.push('')
  lines.push('---')
  lines.push('')

  lines.push('## 02_人物')
  lines.push('')
  for (const c of characters) {
    lines.push(`### ${c.name}`)
    lines.push('')
    lines.push(c.description || '')
    lines.push('')
  }
  lines.push('---')
  lines.push('')

  // 04_故事大纲
  lines.push('## 04_故事大纲')
  lines.push('')
  lines.push(`共 **${outline.length}** 章`)
  lines.push('')
  for (const ch of outline) {
    lines.push(`### 第${ch.number}章　${ch.title}`)
    lines.push(ch.description)
    lines.push('')
  }

  lines.push('---')
  lines.push('')

  // 05_核心主题
  lines.push('## 05_核心主题')
  lines.push('')
  lines.push('| 主题 | 体现 |')
  lines.push('|------|------|')
  if (story.worldDirection) {
    for (const feature of story.worldDirection.worldFeatures || []) {
      const theme = feature.split('：')[0] || feature
      lines.push(`| ${theme} | ${feature} |`)
    }
  }
  lines.push('')

  const content = lines.join('\n').trim() + '\n'
  const filePath = join(outputDir, 'story_bible.md')
  const tmpPath = `${filePath}.tmp`
  await writeFile(tmpPath, content, 'utf-8')
  await rename(tmpPath, filePath)
  logger.debug(`Story bible written to: ${filePath}`)
}
