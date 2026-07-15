import { requireStory } from '../utils/story-loader.js'
import { createCheckpointService } from '../../storage/checkpoint-service.js'
import { exportMetaFromCheckpoint } from '../../storage/meta/exporter.js'
import { applyEvents } from '../../story-memory/projector.js'
import { generateId } from '../../utils/id.js'
import type { ReducedGraphState } from '../../graph/state.js'
import type { StoryEvent } from '../../types/story-memory.js'

export async function waiveForeshadow(
  storyId: string,
  options: { foreshadow?: string; reason?: string }
): Promise<void> {
  const foreshadowId = options.foreshadow?.trim()
  if (!storyId || !foreshadowId) {
    console.error('[MuseFlow] 错误: 请提供故事ID和伏笔ID')
    console.log('用法: museflow waive-foreshadow <story-id> --foreshadow <id> [--reason <text>]')
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
    return
  }

  const state = tuple.checkpoint.channel_values as ReducedGraphState
  const memory = state.storyMemory
  if (!memory) {
    console.error('[MuseFlow] 错误: 当前故事未初始化 StoryMemory，无法放弃伏笔')
    process.exit(1)
    return
  }

  const foreshadow = memory.foreshadows[foreshadowId]
  if (!foreshadow) {
    console.error(`[MuseFlow] 错误: 伏笔 ${foreshadowId} 不存在`)
    process.exit(1)
    return
  }
  if (foreshadow.fulfilledIn !== null) {
    console.error(
      `[MuseFlow] 错误: 伏笔 ${foreshadowId} 已在第 ${foreshadow.fulfilledIn + 1} 章回收，无需放弃`
    )
    process.exit(1)
    return
  }
  if (foreshadow.waivedIn !== undefined) {
    console.error(`[MuseFlow] 错误: 伏笔 ${foreshadowId} 已经放弃回收，无需重复操作`)
    process.exit(1)
    return
  }

  // 放弃回收是作者决策而非章节内容，source 沿用调度类机器事件的 'outline'。
  const event: StoryEvent = {
    id: generateId('evt'),
    type: 'foreshadow-waive',
    foreshadowId,
    chapterIndex: state.currentChapterIndex,
    source: 'outline',
    ...(options.reason ? { reason: options.reason } : {}),
  }
  const newMemory = applyEvents(memory, [event])

  // 边界阻断类问题随放弃决策一并解除（与 adjust-act 的 resolvedIssueFilter 同理）。
  const newPendingIssues = state.pendingIssues.filter(
    (issue) => !(issue.type === 'foreshadow_boundary_unresolved' && issue.subject === foreshadowId)
  )
  const newForeshadowStack = (state.foreshadowStack ?? []).filter(
    (item) => item.id !== foreshadowId
  )

  await checkpointService.updateLatestState({
    storyMemory: newMemory,
    foreshadowStack: newForeshadowStack,
    pendingIssues: newPendingIssues,
  })

  await exportMetaFromCheckpoint(story.outputDir)

  console.log(`[MuseFlow] 已放弃回收伏笔：${foreshadowId}`)
  console.log(`  内容：${foreshadow.text}`)
  if (options.reason) {
    console.log(`  原因：${options.reason}`)
  }
  console.log('  该伏笔将保持悬置，不再计入待回收列表，也不再阻断幕/全书边界。')
}
