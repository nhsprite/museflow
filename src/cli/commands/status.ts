import { getStory } from '../../storage/database/dao/story.js'
import { getState } from '../../core/runner.js'
import { getCurrentChapterDisplayNumber } from '../../utils/chapter-display.js'
import { getForeshadowAlerts, formatForeshadowAlerts } from '../../graph/state.js'

interface StatusOptions {
  storyId?: string
}

export async function status(options?: StatusOptions): Promise<void> {
  const storyId = options?.storyId

  if (!storyId) {
    console.error('[MuseFlow] 错误: 请提供故事ID')
    console.log('用法: museflow status <story-id>')
    process.exit(1)
  }

  const story = getStory(storyId)
  if (!story) {
    console.error(`[MuseFlow] 错误: 故事 "${storyId}" 不存在`)
    process.exit(1)
  }

  const state = await getState(storyId)

  console.log('='.repeat(50))
  console.log('故事进度')
  console.log('='.repeat(50))
  console.log(`ID: ${story.id}`)
  console.log(`简介: ${story.idea}`)
  console.log(`状态: ${story.status}`)
  console.log('')

  if (state) {
    const current = state.currentChapterIndex
    const total = state.totalChapters
    const currentChapter = getCurrentChapterDisplayNumber(current, total)
    const progress = total > 0 ? Math.round((current / total) * 100) : 0

    console.log(`章节进度: ${currentChapter}/${total} (${progress}%)`)

    const doneChapters = state.chapters.filter(c => c !== null).length
    console.log(`已完成章节: ${doneChapters}`)

    if (state.pendingIssues.length > 0) {
      console.log(`待处理问题: ${state.pendingIssues.length}`)
      const errors = state.pendingIssues.filter(i => i.severity === 'error').length
      const warnings = state.pendingIssues.filter(i => i.severity === 'warning').length
      if (errors > 0) console.log(`  - 严重问题: ${errors}`)
      if (warnings > 0) console.log(`  - 警告: ${warnings}`)
    }

    if (state.world) {
      console.log('世界观: ✓ 已构建')
    } else {
      console.log('世界观: 待构建')
    }

    if (state.characters.length > 0) {
      console.log(`人物: ✓ ${state.characters.length} 个`)
    } else {
      console.log('人物: 待创建')
    }

    if (state.outline.length > 0) {
      console.log(`大纲: ✓ ${state.outline.length} 章`)
    } else {
      console.log('大纲: 待生成')
    }

    if (state.foreshadowStack.length > 0) {
      const unfulfilled = state.foreshadowStack.filter(f => !f.fulfilledChapter)
      const fulfilled = state.foreshadowStack.filter(f => f.fulfilledChapter)
      console.log(`伏笔: ${fulfilled.length} 个已回收, ${unfulfilled.length} 个待回收`)

      if (unfulfilled.length > 0) {
        const alerts = getForeshadowAlerts(state.foreshadowStack, state.currentChapterIndex + 1)
        console.log('')
        console.log(formatForeshadowAlerts(alerts))
      }
    }

    console.log('')

    if (state.rewriteRequested) {
      console.log('⚠️  等待重写确认')
      console.log('  使用 museflow continue 命令处理')
    } else if (current < total) {
      console.log(`下一步: 撰写第 ${current + 1} 章`)
      console.log('  使用 museflow continue 命令继续')
    } else {
      console.log('✓ 故事已完成')
      console.log('  使用 museflow export 命令导出')
    }
  } else {
    console.log('状态: 未开始或状态不可用')
    console.log('  使用 museflow start 开始此故事')
  }

  console.log('='.repeat(50))
}
