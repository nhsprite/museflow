import { listStories } from '../../storage/meta/stores/story.js'
import { getState } from '../../core/runner.js'
import { getCurrentChapterDisplayNumber } from '../../utils/chapter-display.js'

export async function list(): Promise<void> {
  const stories = listStories()

  if (stories.length === 0) {
    console.log('[MuseFlow] 暂无书籍')
    console.log('使用 museflow start 创建一本新书')
    return
  }

  console.log('='.repeat(70))
  console.log(`📚 书籍列表 (${stories.length} 本)`)
  console.log('='.repeat(70))

  for (const story of stories) {
    const state = await getState(story.id)
    const currentChapter = state
      ? getCurrentChapterDisplayNumber(state.currentChapterIndex, state.totalChapters)
      : '0'
    const totalChapters = state?.totalChapters ?? story.totalChapters
    const progress =
      totalChapters > 0 ? Math.round(((state?.currentChapterIndex ?? 0) / totalChapters) * 100) : 0

    console.log('')
    console.log(`  📖 ${story.title || '(未命名)'}`)
    console.log(`     ID:       ${story.id}`)
    console.log(`     简介:     ${story.idea}`)
    console.log(`     题材:     ${story.genre}`)
    console.log(`     进度:     ${currentChapter}/${totalChapters} (${progress}%)`)
    console.log(`     状态:     ${story.status}`)
    console.log(`     更新:     ${new Date(story.updatedAt).toLocaleString('zh-CN')}`)
  }

  console.log('')
  console.log('💡 提示: 使用 museflow info <story-id> 查看详情')
  console.log('        使用 museflow write <story-id> 继续撰写')
}
