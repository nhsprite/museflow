import { requireStory } from '../utils/story-loader.js'
import { getState } from '../../core/runner.js'
import { existsSync } from 'node:fs'
import {
  getChapterIssues,
  printChapterProgress,
  printForeshadowStatus,
  printNextStep,
  printNotStarted,
  printPendingIssues,
  printStatusFooter,
  printStatusHeader,
  printStoryInfo,
  printWorldBuildingStatus,
} from '../formatters/status-formatter.js'

export async function status(storyId?: string): Promise<void> {
  if (!storyId) {
    console.error('[MuseFlow] 错误: 请提供故事ID')
    console.log('用法: museflow status <story-id>')
    process.exit(1)
  }

  const story = await requireStory(storyId)
  const state = await getState(storyId)

  printStatusHeader()
  printStoryInfo(story)

  if (state) {
    printChapterProgress(state)

    const storyDir = state.story?.outputDir
    const chapterIssues = storyDir && existsSync(storyDir)
      ? await getChapterIssues(storyDir, state.totalChapters)
      : []
    printPendingIssues(state, chapterIssues)

    printWorldBuildingStatus(state)
    printForeshadowStatus(state)
    printNextStep(state)
  } else {
    printNotStarted()
  }

  printStatusFooter()
}
