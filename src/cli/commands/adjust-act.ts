import { requireStory } from '../utils/story-loader.js'
import { createCheckpointService } from '../../storage/checkpoint-service.js'
import { writeOutlineContent } from '../../storage/filesystem/writer.js'
import { exportMetaFromCheckpoint } from '../../storage/meta/exporter.js'
import {
  validateActBoundaryAdjustment,
  getActForChapter,
  applyActBoundaryShift,
} from '../../utils/story-arc.js'
import type { ReducedGraphState } from '../../graph/state.js'
import type { Issue } from '../../types/agent.js'
import type { StoryArc } from '../../types/outline.js'
import { findMandatoryBeatById } from '../../utils/mandatory-beat-ids.js'

function isResolvedActCoverageIssue(
  issue: Issue,
  actIndex: number,
  storyArc: StoryArc | null | undefined
): boolean {
  if (issue.type !== 'outline_coverage') return false
  if (issue.source !== 'outline_compliance') return false
  if (issue.subject) {
    const keyBeat = storyArc?.keyBeats.find((beat) => beat.id === issue.subject)
    if (
      issue.ruleId === 'outline-coverage.unverified-key-beat' &&
      keyBeat?.deadlineAct === actIndex
    ) {
      return true
    }
    const mandatoryBeat = findMandatoryBeatById(storyArc, issue.subject)
    if (
      issue.ruleId === 'outline-coverage.unverified-mandatory-beat' &&
      mandatoryBeat?.act.index === actIndex
    ) {
      return true
    }
  }
  const actSubject = `act-${actIndex}`
  if (
    issue.subject === actSubject &&
    (issue.ruleId === 'outline-coverage.pending-beats-at-boundary' ||
      issue.ruleId === 'outline-coverage.auto-extension-limit')
  ) {
    return true
  }
  return false
}

function ensureOutlineLength(
  outline: ReducedGraphState['outline'],
  totalChapters: number
): ReducedGraphState['outline'] {
  const next = outline.slice(0, totalChapters)
  for (let i = next.length; i < totalChapters; i++) {
    next.push({ number: i + 1, title: '', description: '' })
  }
  return next
}

function ensureChaptersLength(
  chapters: ReducedGraphState['chapters'],
  totalChapters: number
): ReducedGraphState['chapters'] {
  const next = chapters.slice(0, totalChapters)
  while (next.length < totalChapters) {
    next.push(null)
  }
  return next
}

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

  if (!storyArc.acts.some((a) => a.index === actIndex)) {
    console.error('[MuseFlow] 错误: 幕不存在')
    process.exit(1)
  }

  const newStoryArc = applyActBoundaryShift(storyArc, actIndex, proposedEndChapter)
  const currentActAfter = getActForChapter(newStoryArc, state.currentChapterIndex)
  const newTotalChapters = newStoryArc.totalChapters
  const newOutline = ensureOutlineLength(state.outline, newTotalChapters)
  const newChapters = ensureChaptersLength(state.chapters, newTotalChapters)
  const newStory =
    newTotalChapters === state.story.totalChapters
      ? state.story
      : { ...state.story, totalChapters: newTotalChapters, updatedAt: Date.now() }

  const resolvedIssueFilter = (issue: Issue) =>
    !isResolvedActCoverageIssue(issue, actIndex, storyArc)

  await checkpointService.updateLatestState({
    story: newStory,
    totalChapters: newTotalChapters,
    storyArc: newStoryArc,
    outline: newOutline,
    chapters: newChapters,
    pendingIssues: state.pendingIssues.filter(resolvedIssueFilter),
  })

  // 同步更新章节标记，否则 `rewrite -c N` 会从旧标记加载到未调整的幕边界。
  const markers = await checkpointService.listChapterMarkers()
  for (const marker of markers) {
    const markerTuple = await checkpointService.getTuple({
      configurable: {
        thread_id: storyId,
        outputDir: story.outputDir,
        checkpoint_id: marker.checkpointId,
      },
    })
    if (!markerTuple) continue
    const markerState = markerTuple.checkpoint.channel_values as ReducedGraphState
    const newMarkerId = await checkpointService.createDerivedCheckpoint(
      marker.checkpointId,
      {
        story: newStory,
        totalChapters: newTotalChapters,
        storyArc: newStoryArc,
        outline: ensureOutlineLength(markerState.outline, newTotalChapters),
        chapters: ensureChaptersLength(markerState.chapters, newTotalChapters),
        pendingIssues: markerState.pendingIssues.filter(resolvedIssueFilter),
      },
      'update'
    )
    await checkpointService.saveChapterMarker(marker.chapterNumber, newMarkerId)
  }

  await writeOutlineContent(story.outputDir, state.story.title, newOutline, newStoryArc)
  await exportMetaFromCheckpoint(story.outputDir)

  console.log(`[MuseFlow] 已调整第 ${actIndex} 幕边界：结束于第 ${proposedEndChapter} 章`)
  if (newTotalChapters !== state.totalChapters) {
    console.log(`  目标总章节数：${state.totalChapters} → ${newTotalChapters}`)
  }
  if (currentActAfter) {
    console.log(
      `  当前章（第 ${state.currentChapterIndex + 1} 章）位于第 ${currentActAfter.index} 幕「${currentActAfter.title}」`
    )
  }
}
