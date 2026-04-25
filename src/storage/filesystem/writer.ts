import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises'
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
  await writeFile(filePath, content, 'utf-8')
  logger.debug(`Chapter ${chapterNumber} written to: ${filePath}`)
}

export async function deleteChapterContent(
  outputDir: string,
  chapterNumber: number,
): Promise<void> {
  const filePath = getChapterFilePath(outputDir, chapterNumber)
  try {
    await unlink(filePath)
    logger.debug(`Chapter ${chapterNumber} deleted: ${filePath}`)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err
    }
    logger.debug(`Chapter ${chapterNumber} not found, skip delete: ${filePath}`)
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
  await writeFile(filePath, content, 'utf-8')
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

  // 02_主角
  lines.push('## 02_主角')
  lines.push('')
  const protagonist = characters.find(c =>
    c.name && (
      c.description?.includes('主角') ||
      c.description?.includes('出生于凡间') ||
      c.description?.includes('十岁')
    )
  )
  if (protagonist) {
    lines.push('### 身份设定')
    lines.push(`**${protagonist.name}**`)
    lines.push('')
    lines.push(protagonist.description || '')
    lines.push('')
    lines.push('### 性格关键词')
    lines.push('- 外冷内热、实用主义、执念深重、创伤驱动')
    lines.push('')
    lines.push('### 行为边界')
    lines.push('- **绝不**：为私利杀人、主动伤害无辜者、完全信任任何\'好意的\'灵体')
    lines.push('- **可以**：利用规则对付恶人、与鬼魂做交易（但不轻易许诺）')
    lines.push('')
  }
  lines.push('---')
  lines.push('')

  // 03_势力与人物
  lines.push('## 03_势力与人物')
  lines.push('')

  const protagonistNames = new Set(['叶尘', '林青山', '冷月瑶', '周天行', '苏寒渊'])
  const antagonistNames = new Set(['姜云澜', '赵无极'])

  const allies = characters.filter(c => c.name && protagonistNames.has(c.name) && c.name !== '叶尘')
  const antagonists = characters.filter(c => c.name && antagonistNames.has(c.name))

  if (allies.length > 0) {
    lines.push('### 正道阵营')
    lines.push('')
    for (const c of allies) {
      lines.push(`#### ${c.name}`)
      lines.push(`- ${c.description || ''}`)
      lines.push('')
    }
  }

  if (antagonists.length > 0) {
    lines.push('### 敌对势力')
    lines.push('')
    for (const c of antagonists) {
      lines.push(`#### ${c.name}`)
      lines.push(`- ${c.description || ''}`)
      lines.push('')
    }
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
  await writeFile(filePath, content, 'utf-8')
  logger.debug(`Story bible written to: ${filePath}`)
}
