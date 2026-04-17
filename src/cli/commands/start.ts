import { createStory } from '../../storage/database/dao/story.js'
import { runStory } from '../../core/runner.js'
import { initStoryDb } from '../../storage/database/dao/story.js'
import { getGenreRegistry } from '../../genres/registry.js'
import { getStory } from '../../storage/database/dao/story.js'
import { updateStoryStatus } from '../../storage/database/dao/story.js'
import { updateStoryTitle } from '../../storage/database/dao/story.js'
import type { StoryStatus } from '../../types/story.js'

interface StartOptions {
  idea: string
  chapters: number
  genre: string
  title?: string
  provider?: string
}

export async function start(options: StartOptions): Promise<void> {
  const { idea, chapters, genre, title, provider } = options

  console.log('[MuseFlow] 开始创建故事...')
  console.log(`  简介: ${idea}`)
  console.log(`  章节数: ${chapters}`)
  console.log(`  题材: ${genre}`)

  const registry = getGenreRegistry()
  const genreExists = registry.some(e => e.skill.name === genre)
  if (!genreExists) {
    console.error(`[MuseFlow] 错误: 题材 "${genre}" 不存在`)
    console.log('[MuseFlow] 可用题材:', registry.map(e => e.skill.name).join(', '))
    process.exit(1)
  }

  if (chapters < 1 || chapters > 100) {
    console.error('[MuseFlow] 错误: 章节数量必须在 1-100 之间')
    process.exit(1)
  }

  initStoryDb()

  const story = createStory({
    idea,
    genre,
    totalChapters: chapters,
    provider: provider || 'openai',
  })

  if (title) {
    updateStoryTitle(story.id, title)
  }

  console.log(`\n[MuseFlow] 故事已创建，ID: ${story.id}`)
  console.log('[MuseFlow] 开始生成世界观...\n')

  try {
    const updateStatus = (status: StoryStatus) => {
      updateStoryStatus(story.id, status)
    }

    updateStatus('worldbuilding')

    const result = await runStory({
      storyId: story.id,
      idea,
      genre,
      totalChapters: chapters,
      story,
    })

    if (result.world) {
      console.log('[MuseFlow] 世界观构建完成\n')
    }

    if (result.characters.length > 0) {
      console.log(`[MuseFlow] 已创建 ${result.characters.length} 个人物\n`)
    }

    if (result.outline.length > 0) {
      console.log(`[MuseFlow] 大纲已生成，共 ${result.outline.length} 章\n`)
    }

    updateStatus('outlining')

    let currentChapter = result.currentChapterIndex
    const totalChapters = result.totalChapters

    while (currentChapter < totalChapters) {
      console.log(`[MuseFlow] 正在撰写第 ${currentChapter + 1}/${totalChapters} 章...`)

      updateStatus('writing')

      if (result.pendingIssues.length > 0) {
        const errors = result.pendingIssues.filter(i => i.severity === 'error')
        if (errors.length > 0) {
          console.log(`\n[MuseFlow] 发现 ${errors.length} 个严重问题，需要重写:`, errors.map(e => e.description).join(', '))
          console.log('[MuseFlow] 请使用 continue 命令继续处理\n')
          break
        }
      }

      if (result.chapters[currentChapter]) {
        console.log(`[MuseFlow] 第 ${currentChapter + 1} 章完成\n`)
      }

      currentChapter = result.currentChapterIndex
    }

    if (currentChapter >= totalChapters) {
      updateStatus('done')
      console.log('[MuseFlow] 故事撰写完成！\n')
    }

    console.log(`[MuseFlow] 故事ID: ${story.id}`)
    console.log('[MuseFlow] 使用 "museflow status" 查看进度')
    console.log('[MuseFlow] 使用 "museflow info" 查看详情')

  } catch (err) {
    console.error('[MuseFlow] 错误:', err instanceof Error ? err.message : String(err))
    updateStoryStatus(story.id, 'error')
    process.exit(1)
  }
}