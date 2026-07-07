import type { ReducedGraphState } from '../../graph/state.js'
import type { Story } from '../../types/story.js'

export function shouldFreezeLockStory(story: Story, state: ReducedGraphState): boolean {
  return story.status === 'freeze' || state.currentChapterIndex >= state.totalChapters
}

export function printFrozenStoryMessage(
  story: Story,
  state: ReducedGraphState,
  storyId: string,
  completedChapterIndex = state.currentChapterIndex
): void {
  const completed = Math.min(Math.max(completedChapterIndex, 0), state.totalChapters)
  const percent = state.totalChapters > 0 ? Math.round((completed / state.totalChapters) * 100) : 0

  console.log(`[MuseFlow] 故事已冻结: ${story.title}`)
  console.log(`  总章节: ${completed}/${state.totalChapters} (${percent}%)`)
  console.log('\n当前故事处于 freeze 状态，不允许继续 write/rewrite。')
  console.log('使用以下命令查看或导出故事:')
  console.log(`   museflow status ${storyId}  # 查看进度`)
  console.log(`   museflow info ${storyId}     # 查看详情`)
  console.log(`   museflow export ${storyId}   # 导出为 txt 文件\n`)
}
