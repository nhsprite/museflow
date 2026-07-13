import type { ReducedGraphState } from '../../graph/state.js'
import type { Story } from '../../types/story.js'
import { updateStoryRuntimeStatus } from '../../core/runner.js'
import { printFrozenStoryMessage, shouldFreezeLockStory } from './story-freeze.js'

/**
 * 检查故事是否已冻结或全部完成。如果是，则更新状态并打印提示，返回 true。
 * 调用方应在返回 true 时直接结束命令。
 */
export async function guardStoryWritable(
  storyId: string,
  story: Story,
  state: ReducedGraphState,
  completedChapterIndex = state.currentChapterIndex
): Promise<boolean> {
  if (shouldFreezeLockStory(story, state) || completedChapterIndex >= state.totalChapters) {
    if (completedChapterIndex >= state.totalChapters && story.status !== 'freeze') {
      await updateStoryRuntimeStatus(storyId, 'freeze')
    }
    printFrozenStoryMessage(story, state, storyId, completedChapterIndex)
    return true
  }
  return false
}
