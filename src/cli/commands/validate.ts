import { getStory, initStoryDb } from '../../storage/database/dao/story.js'
import { getState } from '../../core/runner.js'
import { readChapterContent } from '../../storage/filesystem/writer.js'
import { getChapterFilePath } from '../../utils/paths.js'
import { existsSync } from 'node:fs'

export async function validate(storyId: string): Promise<void> {
  await initStoryDb()
  const story = getStory(storyId)
  if (!story) {
    console.error(`[MuseFlow] 错误: 故事 "${storyId}" 不存在`)
    process.exit(1)
  }

  console.log(`[MuseFlow] 校验故事: ${story.title}\n`)

  const state = await getState(storyId)
  if (!state) {
    console.error('[MuseFlow] 错误: 无法获取故事状态')
    process.exit(1)
  }

  let errorCount = 0
  let warningCount = 0

  const addIssue = (severity: 'error' | 'warning', message: string) => {
    const icon = severity === 'error' ? '❌' : '⚠️'
    console.log(`  ${icon} ${message}`)
    if (severity === 'error') errorCount++
    else warningCount++
  }

  console.log('📋 大纲校验')
  for (const item of state.outline) {
    if (!item) continue
    const eventCount = item.description.split(/[。；]/).filter(s => s.trim().length > 5).length
    if (eventCount > 5) {
      addIssue('warning', `第${item.number}章 "${item.title}" 包含 ${eventCount} 个情节点，信息密度过高`)
    }
  }

  console.log('\n📁 文件状态校验')
    for (let i = 0; i < state.totalChapters; i++) {
    const chapterPath = getChapterFilePath(story.outputDir, i + 1)
    if (existsSync(chapterPath)) {
      const content = await readChapterContent(story.outputDir, i + 1)
      if (!content || content.trim().length === 0) {
        addIssue('error', `第 ${i + 1} 章文件存在但内容为空`)
      }
    } else if (i < state.currentChapterIndex) {
      addIssue('error', `第 ${i + 1} 章 checkpoint 标记完成，但文件不存在`)
    }
  }

  console.log('\n🔍 伏笔状态校验')
  for (const item of state.foreshadowStack) {
    if (!item.fulfilledChapter && state.currentChapterIndex > item.expectedFulfillChapter + 1) {
      addIssue('warning', `伏笔 "${item.text.substring(0, 40)}..." 逾期 ${state.currentChapterIndex - item.expectedFulfillChapter} 章未回收`)
    }
    if (item.status === 'shown' && !item.fulfilledChapter && item.createdAtChapter === state.currentChapterIndex) {
      addIssue('error', `伏笔 "${item.text.substring(0, 40)}..." 在第${item.createdAtChapter}章被明确展示但未留待后续回收`)
    }
  }

  console.log('\n' + '═'.repeat(60))
  if (errorCount === 0 && warningCount === 0) {
    console.log('✅ 所有检查通过')
  } else {
    console.log(`⚠️ 发现 ${errorCount} 个错误，${warningCount} 个警告`)
    if (errorCount > 0) {
      console.log('\n建议运行以下命令修复：')
      console.log(`   museflow rewrite ${storyId}  # 重写有问题的章节`)
    }
  }
  console.log('═'.repeat(60) + '\n')
}
