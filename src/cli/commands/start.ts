import { createStory } from '../../storage/meta/stores/story.js'
import {
  runStory,
  updateStoryRuntimeStatus,
  updateStoryStatusInCheckpoint,
} from '../../core/runner.js'
import { initStoryDb } from '../../storage/meta/stores/story.js'
import { getGenreRegistry } from '../../genres/registry.js'
import { updateStoryStatus } from '../../storage/meta/stores/story.js'
import { exportMetaFromCheckpoint } from '../../storage/meta/exporter.js'
import { generateTitleOptions, selectTitleOption, type TitleOption } from './title-selector.js'
import { withSpinner } from '../utils/spinner.js'
import type { ModelConfig } from '../../types/config.js'
import { createRuntimeContext, type RuntimeContext } from '../../core/context.js'
import type { Story } from '../../types/story.js'

interface StartOptions {
  idea: string
  chapters: number
  genre: string
  title?: string
  provider?: string
  yes?: boolean
}

const MAX_REGENERATE_ATTEMPTS = 3

export async function start(options: StartOptions, context?: RuntimeContext): Promise<void> {
  const { idea, chapters, genre, provider, yes } = options

  const runtimeContext = context ?? createRuntimeContext()

  console.log('[MuseFlow] 开始创建故事...')
  console.log(`  简介: ${idea}`)
  console.log(`  章节数: ${chapters}`)
  console.log(`  题材: ${genre}`)

  const registry = getGenreRegistry()
  const genreExists = registry.some((e) => e.skill.name === genre)
  if (!genreExists) {
    console.error(`[MuseFlow] 错误: 题材 "${genre}" 不存在`)
    console.log('[MuseFlow] 可用题材:', registry.map((e) => e.skill.name).join(', '))
    process.exit(1)
  }

  if (chapters < 1 || chapters > 100) {
    console.error('[MuseFlow] 错误: 章节数量必须在 1-100 之间')
    process.exit(1)
  }

  await initStoryDb()

  let selectedOption: TitleOption | null = null
  let regenerateAttempts = 0

  while (!selectedOption && regenerateAttempts < MAX_REGENERATE_ATTEMPTS) {
    console.log('\n[MuseFlow] 正在生成书名和世界观方向选项...\n')

    try {
      const titleOptions = await withSpinner('正在生成书名和世界观方向选项...', () =>
        generateTitleOptions(runtimeContext.provider, idea, genre, chapters)
      )

      if (yes) {
        console.log('[MuseFlow] 非交互模式 - 自动选择第一个选项\n')
        selectedOption = titleOptions[0]!
      } else {
        selectedOption = await selectTitleOption(titleOptions, genre)
      }
    } catch (err) {
      if (err instanceof Error && err.message === 'REGENERATE') {
        regenerateAttempts++
        console.log(
          `\n[MuseFlow] 重新生成选项... (${regenerateAttempts}/${MAX_REGENERATE_ATTEMPTS})\n`
        )
        continue
      }
      throw err
    }
  }

  if (!selectedOption) {
    console.warn('[MuseFlow] 警告: 达到最大重试次数，使用默认选项')
    const titleOptions = await generateTitleOptions(runtimeContext.provider, idea, genre, chapters)
    selectedOption = titleOptions[0]!
  }

  console.log(`\n[MuseFlow] 已选择：${selectedOption.title}\n`)
  if (selectedOption.synopsis) {
    console.log(`[MuseFlow] 新书简介：${selectedOption.synopsis}\n`)
  }

  const resolvedProvider: ModelConfig['provider'] =
    provider === 'minimax' || provider === 'local'
      ? 'openai'
      : ((provider as ModelConfig['provider'] | undefined) ?? 'openai')

  const story = createStory({
    idea,
    genre,
    totalChapters: chapters,
    provider: resolvedProvider,
    title: selectedOption.title,
    ...(selectedOption.synopsis ? { synopsis: selectedOption.synopsis } : {}),
    worldDirection: selectedOption.worldDirection,
  })

  console.log(`[MuseFlow] 故事已创建，ID: ${story.id}`)
  console.log('[MuseFlow] 开始生成世界观...\n')

  try {
    const updateStatus = (status: Parameters<typeof updateStoryStatus>[1]) => {
      updateStoryStatus(story.id, status)
    }

    updateStatus('worldbuilding')
    const storyForRun: Story = { ...story, status: 'worldbuilding', updatedAt: Date.now() }

    const result = await withSpinner('正在构建世界观和角色设定...', () =>
      runStory(
        {
          storyId: story.id,
          idea,
          genre,
          totalChapters: chapters,
          story: storyForRun,
        },
        runtimeContext
      )
    )

    if (result.world) {
      console.log('[MuseFlow] 世界观构建完成\n')
    }

    if (result.story.title) {
      console.log(`[MuseFlow] 书名: ${result.story.title}\n`)
    }

    if (result.story.synopsis) {
      console.log(`[MuseFlow] 简介: ${result.story.synopsis}\n`)
    }

    if (result.characters.length > 0) {
      console.log(`[MuseFlow] 已创建 ${result.characters.length} 个人物\n`)
    }

    if (result.storyArc) {
      const actCount = result.storyArc.acts.length
      console.log(
        `[MuseFlow] 故事弧线已生成，共 ${actCount} 幕，${result.storyArc.totalChapters} 章\n`
      )
    }

    await exportMetaFromCheckpoint(result.story.outputDir)
    await updateStoryStatusInCheckpoint(story.id, result.story.outputDir, 'outlining')

    console.log('[MuseFlow] 规划阶段完成！\n')
    console.log(`[MuseFlow] 故事ID: ${story.id}`)
    console.log('[MuseFlow] 使用 "museflow write" 开始撰写正文')
  } catch (err) {
    console.error('[MuseFlow] 错误:', err instanceof Error ? err.message : String(err))
    await updateStoryRuntimeStatus(story.id, 'error').catch(() =>
      updateStoryStatus(story.id, 'error')
    )
    process.exit(1)
  }
}
