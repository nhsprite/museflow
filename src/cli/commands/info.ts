import { requireStory } from '../utils/story-loader.js'
import { getState } from '../../core/runner.js'
import { getGenreSkill } from '../../genres/registry.js'
import { loadConfig } from '../../config/store.js'
import { getCurrentChapterDisplayNumber } from '../../utils/chapter-display.js'

interface InfoOptions {}

export async function info(storyId?: string, _options?: InfoOptions): Promise<void> {
  if (!storyId) {
    console.error('[MuseFlow] 错误: 请提供故事ID')
    console.log('用法: museflow info <story-id>')
    process.exit(1)
  }

  const story = await requireStory(storyId)

  const state = await getState(storyId)
  const genre = getGenreSkill(story.genre)
  const config = loadConfig()

  console.log('='.repeat(50))
  console.log('故事详情')
  console.log('='.repeat(50))
  console.log(`ID: ${story.id}`)
  console.log(`标题: ${story.title || '(未设置)'}`)
  console.log(`简介: ${story.synopsis || story.idea}`)
  if (story.synopsis) {
    console.log(`原始想法: ${story.idea}`)
  }
  console.log('')
  console.log('元数据:')
  console.log(`  题材: ${story.genre} ${genre ? `(${genre.displayName})` : ''}`)
  console.log(`  章节数: ${story.totalChapters}`)
  console.log(`  状态: ${story.status}`)
  console.log(`  提供商: ${story.provider}`)
  console.log(`  创建时间: ${new Date(story.createdAt).toLocaleString('zh-CN')}`)
  console.log(`  更新时间: ${new Date(story.updatedAt).toLocaleString('zh-CN')}`)
  console.log('')

  if (genre) {
    console.log('题材信息:')
    console.log(`  名称: ${genre.displayName}`)
    console.log(`  版本: ${genre.version}`)
    if (genre.tropes.length > 0) {
      console.log(`  元素: ${genre.tropes.join(', ')}`)
    }
    console.log('')
  }

  if (state) {
    const currentChapter = getCurrentChapterDisplayNumber(
      state.currentChapterIndex,
      state.totalChapters
    )

    console.log('生成状态:')
    console.log(`  当前章节: ${currentChapter}/${state.totalChapters}`)
    console.log(`  世界观: ${state.world ? '✓ 已构建' : '✗ 未构建'}`)
    console.log(
      `  人物: ${state.characters.length > 0 ? `✓ ${state.characters.length} 个` : '✗ 未创建'}`
    )
    console.log(`  大纲: ${state.outline.length > 0 ? `✓ ${state.outline.length} 章` : '✗ 未生成'}`)
    console.log('')

    if (state.characters.length > 0) {
      console.log('人物列表:')
      for (const char of state.characters.slice(0, 5)) {
        console.log(`  - ${char.name}`)
      }
      if (state.characters.length > 5) {
        console.log(`  ... 还有 ${state.characters.length - 5} 个`)
      }
      console.log('')
    }

    if (state.outline.length > 0) {
      console.log('大纲预览:')
      for (const chapter of state.outline.slice(0, 3)) {
        console.log(`  第${chapter.number}章: ${chapter.title}`)
      }
      if (state.outline.length > 3) {
        console.log(`  ... 还有 ${state.outline.length - 3} 章`)
      }
      console.log('')
    }

    if (state.foreshadowStack.length > 0) {
      const unfulfilled = state.foreshadowStack.filter((f) => !f.fulfilledChapter)
      const fulfilled = state.foreshadowStack.filter((f) => f.fulfilledChapter)
      console.log(`伏笔: ${unfulfilled.length} 个待回收, ${fulfilled.length} 个已回收`)
      console.log('')

      if (unfulfilled.length > 0) {
        console.log('待回收伏笔:')
        for (const fs of unfulfilled.slice(0, 3)) {
          const createdCh = fs.createdAtChapter || '?'
          console.log(
            `  - 第${fs.expectedFulfillChapter}章回收 | 第${createdCh}章埋下: "${fs.text.substring(0, 30)}..."`
          )
        }
        if (unfulfilled.length > 3) {
          console.log(`  ... 还有 ${unfulfilled.length - 3} 个`)
        }
        console.log('')
      }

      if (fulfilled.length > 0) {
        console.log('已回收伏笔:')
        for (const fs of fulfilled.slice(0, 3)) {
          const createdCh = fs.createdAtChapter || '?'
          console.log(
            `  ✓ 第${fs.fulfilledChapter}章回收 | 第${createdCh}章埋下: "${fs.text.substring(0, 30)}..."`
          )
        }
        if (fulfilled.length > 3) {
          console.log(`  ... 还有 ${fulfilled.length - 3} 个`)
        }
        console.log('')
      }
    }

    if (state.pendingIssues.length > 0) {
      console.log(`待处理问题: ${state.pendingIssues.length} 个`)
      for (const issue of state.pendingIssues.slice(0, 3)) {
        console.log(`  - [${issue.type}] ${issue.description.substring(0, 40)}...`)
      }
      console.log('')
    }
  }

  console.log('存储路径:')
  console.log(`  输出目录: ${story.outputDir}`)
  console.log('')

  console.log('模型配置:')
  console.log(`  提供商: ${config.model.provider}`)
  console.log(`  模型: ${config.model.model || '(默认)'}`)
  if (config.model.baseUrl) {
    console.log(`  API URL: ${config.model.baseUrl}`)
  }
  console.log('='.repeat(50))
}
