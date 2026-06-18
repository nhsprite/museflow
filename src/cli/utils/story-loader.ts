import { getStory, initStoryDb } from '../../storage/database/dao/story.js'
import { getState } from '../../core/runner.js'
import type { Story } from '../../types/story.js'
import type { ReducedGraphState } from '../../graph/state.js'

export async function requireStory(storyId: string): Promise<Story> {
  await initStoryDb()
  const story = getStory(storyId)
  if (!story) {
    console.error(`[MuseFlow] 错误: 故事 "${storyId}" 不存在`)
    process.exit(1)
  }
  return story
}

export async function requireStoryState(
  storyId: string
): Promise<{ story: Story; state: ReducedGraphState }> {
  const story = await requireStory(storyId)
  const state = await getState(storyId)
  if (!state) {
    console.error('[MuseFlow] 错误: 无法获取故事状态，请先运行 start')
    process.exit(1)
  }
  return { story, state }
}
