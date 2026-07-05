import { Command } from 'commander'
import { requireStory } from '../utils/story-loader.js'
import { getState } from '../../core/runner.js'
import { createCheckpointService } from '../../storage/checkpoint-service.js'
import { exportMetaFromCheckpoint } from '../../storage/meta/exporter.js'
import { migrateFromStoryState } from '../../story-memory/migrator.js'

export function registerMigrateMemoryCommand(program: Command): void {
  program
    .command('migrate-memory <story-id>')
    .description('将已有故事从 StoryState 迁移到 StoryMemory')
    .action(async (storyId: string) => {
      const story = await requireStory(storyId)
      const state = await getState(storyId)
      if (!state) {
        console.error(`[MuseFlow] 错误: 无法获取故事 ${storyId} 的状态`)
        process.exit(1)
      }

      if (state.storyMemory) {
        console.log(`[MuseFlow] 故事 ${storyId} 已经存在 StoryMemory，无需迁移`)
        return
      }

      const currentChapterIndex = state.currentChapterIndex ?? 0
      const storyMemory = migrateFromStoryState(state.storyState, currentChapterIndex)

      const checkpointService = createCheckpointService(story.outputDir)
      await checkpointService.updateLatestState({ storyMemory })
      await exportMetaFromCheckpoint(story.outputDir)

      console.log(`[MuseFlow] 已将 ${storyId} 迁移到 StoryMemory`)
    })
}
