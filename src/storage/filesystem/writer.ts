import { mkdir, writeFile, readFile, unlink, rename } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '../../utils/logger.js'
import { getChapterFilePath } from '../../utils/paths.js'
import type { StoryArc } from '../../types/outline.js'

async function ensureStoryDir(outputDir: string): Promise<void> {
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
  content: string
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
  chapterNumber: number
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
  outline: {
    number: number
    title: string
    description: string
    introducedCharacters?: string[]
  }[],
  storyArc?: StoryArc | null
): Promise<void> {
  await ensureStoryDir(outputDir)
  const lines: string[] = [`# ${storyTitle || '故事大纲'}`, '']

  if (storyArc) {
    lines.push('## 故事弧线', '')
    lines.push(`目标总章节数：${storyArc.totalChapters}`, '')
    lines.push('| 幕 | 章节范围 | 标题 | 主题 | 叙事功能 |', '')
    lines.push('|---|---|---|---|---|', '')
    for (const act of storyArc.acts) {
      lines.push(
        `| ${act.index} | ${act.startChapter}-${act.endChapter} | ${act.title} | ${act.theme} | ${act.function} |`
      )
    }
    lines.push('', '### Mandatory Beats', '')
    for (const act of storyArc.acts) {
      lines.push(
        `**第 ${act.index} 幕「${act.title}」**：${act.mandatoryBeats.join('、') || '（无）'}`
      )
    }
    if (storyArc.keyBeats.length > 0) {
      lines.push('', '### Key Beats（全局）', '')
      for (const kb of storyArc.keyBeats) {
        lines.push(`- ${kb.beat}（截止第 ${kb.deadlineAct} 幕）`)
      }
    }
    lines.push('', '---', '')
  }

  lines.push('## 章节大纲', '')
  for (const ch of outline) {
    lines.push(`### 第${ch.number}章 ${ch.title || '（待生成）'}`, '')
    if (ch.description) {
      lines.push(ch.description, '')
    } else {
      lines.push('（本章执行大纲将在动笔前即时生成）', '')
    }
    if (ch.introducedCharacters && ch.introducedCharacters.length > 0) {
      lines.push(`首次登场角色：${ch.introducedCharacters.join('、')}`, '')
    }
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
  chapterNumber: number
): Promise<string | null> {
  const filePath = getChapterFilePath(outputDir, chapterNumber)
  if (!existsSync(filePath)) return null
  return readFile(filePath, 'utf-8')
}

export async function listChapterFiles(outputDir: string): Promise<number[]> {
  const { readdirSync } = await import('node:fs')
  const chaptersDir = join(outputDir, 'chapters')
  if (!existsSync(chaptersDir)) return []

  const files = readdirSync(chaptersDir).filter((f) => f.endsWith('.md'))
  const numbers = files
    .map((f) => {
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
  powerSystem?: string
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
  outline: StoryBibleOutline[]
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
    lines.push(`### 第${ch.number}章 ${ch.title}`)
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
