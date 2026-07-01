import { requireStory } from '../utils/story-loader.js'
import { createCheckpointService } from '../../storage/checkpoint-service.js'
import { writeOutlineContent } from '../../storage/filesystem/writer.js'
import {
  validateActBoundaryAdjustment,
  getActForChapter,
} from '../../utils/story-arc.js'
import type { ReducedGraphState } from '../../graph/state.js'

export async function adjustAct(
  storyId: string,
  options: { act?: string; endChapter?: string }
): Promise<void> {
  if (!storyId) {
    console.error('[MuseFlow] 错误: 请提供故事ID')
    console.log('用法: museflow adjust-act <story-id> --act <index> --end-chapter <number>')
    process.exit(1)
    return
  }

  const actIndex = options.act ? parseInt(options.act, 10) : NaN
  const proposedEndChapter = options.endChapter ? parseInt(options.endChapter, 10) : NaN

  if (Number.isNaN(actIndex) || Number.isNaN(proposedEndChapter)) {
    console.error('[MuseFlow] 错误: --act 和 --end-chapter 必须是数字')
    process.exit(1)
    return
  }

  const story = await requireStory(storyId)
  const checkpointService = createCheckpointService(story.outputDir)
  const tuple = await checkpointService.getTuple({
    configurable: { thread_id: storyId, outputDir: story.outputDir },
  })
  if (!tuple) {
    console.error('[MuseFlow] 错误: 找不到故事状态')
    process.exit(1)
  }

  const state = tuple.checkpoint.channel_values as ReducedGraphState
  const storyArc = state.storyArc
  if (!storyArc) {
    console.error('[MuseFlow] 错误: 当前故事未使用故事弧线，无法调整幕边界')
    process.exit(1)
  }

  const validation = validateActBoundaryAdjustment(
    storyArc,
    actIndex,
    proposedEndChapter,
    state.currentChapterIndex
  )
  if (!validation.valid) {
    console.error(`[MuseFlow] 错误: ${validation.reason}`)
    process.exit(1)
  }

  const currentAct = storyArc.acts.find(a => a.index === actIndex)
  if (!currentAct) {
    console.error('[MuseFlow] 错误: 幕不存在')
    process.exit(1)
  }

  const newActs = storyArc.acts.map(act => {
    if (act.index === actIndex) {
      return { ...act, endChapter: proposedEndChapter }
    }
    if (act.index === actIndex + 1) {
      return { ...act, startChapter: proposedEndChapter + 1 }
    }
    return act
  })

  const newStoryArc = { ...storyArc, acts: newActs }
  const currentActAfter = getActForChapter(newStoryArc, state.currentChapterIndex)

  await checkpointService.updateLatestState({
    storyArc: newStoryArc,
  })

  await writeOutlineContent(
    story.outputDir,
    state.story.title,
    state.outline,
    newStoryArc
  )

  console.log(`[MuseFlow] 已调整第 ${actIndex} 幕边界：结束于第 ${proposedEndChapter} 章`)
  if (currentActAfter) {
    console.log(`  当前章（第 ${state.currentChapterIndex + 1} 章）位于第 ${currentActAfter.index} 幕「${currentActAfter.title}」`)
  }
}
