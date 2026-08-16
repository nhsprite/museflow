import type { Issue } from '../../../types/agent.js'
import type { BeatClaimPlanningRejection, ZeroProgressRejection } from '../../../agents/types.js'
import type { ChapterOutline, StoryArc } from '../../../types/outline.js'
import type { StoryMemory } from '../../../types/story-memory.js'
import { findMandatoryBeatById } from '../../../utils/mandatory-beat-ids.js'
import { getActForChapter } from '../../../utils/story-arc.js'

/**
 * 幕边界高压下 mandatory beat 连续未被正文证实时的补救：大纲重生成反馈。
 *
 * 高压禁止以撤销认领跳过 mandatory beat（撤销等于本章零消费，幕末必然阻塞），
 * 但正文阶段的 beat_unproven 暴露的可能仍是大纲层的实现缺陷：description 只写了
 * 节拍的外围仪式（宣读、认责、维持原状），正文无论怎么重起草都无法证明。此时
 * 保留强制认领约束，把正文验证器的驳回原因回流到大纲生成层，让大纲 agent 围绕
 * 节拍所述事件重新组织本章，而不是直接中止转人工。
 */

/** 每章允许的大纲重生成次数上限；耗尽后回落到 mandatory_beat_unproven 人工处置。 */
export const MAX_OUTLINE_REGEN_ATTEMPTS = 2

export interface BuildBeatClaimOutlineRejectionInput {
  /** 连续多轮未被正文证实、本轮触发高压拦截的 mandatory beat ID。 */
  beatIds: readonly string[]
  /** 本轮剩余 error（取 beat_unproven issue 的 description 作为驳回原因）。 */
  issues: readonly Issue[]
  storyArc: StoryArc | null | undefined
  outline: readonly ChapterOutline[] | undefined
  chapterIndex: number
  /** 当前幕尚未被正文证实的 mandatory beat ID（高压下必须至少认领其一）。 */
  pendingMandatoryBeatIds: readonly string[]
}

export function buildBeatClaimOutlineRejection(
  input: BuildBeatClaimOutlineRejectionInput
): BeatClaimPlanningRejection {
  const { beatIds, issues, storyArc, outline, chapterIndex, pendingMandatoryBeatIds } = input

  const beatText = (beatId: string): string =>
    findMandatoryBeatById(storyArc, beatId)?.beat ?? beatId

  const rejectedClaims = beatIds.map((beatId) => {
    const issue = issues.find((item) => item.type === 'beat_unproven' && item.subject === beatId)
    return {
      beatId,
      beat: beatText(beatId),
      reason:
        issue?.description ??
        `节拍 ${beatId} 连续多轮未被正文证实：正文证据未呈现该节拍所述事件的可观察完成。`,
    }
  })

  const currentAct = storyArc ? getActForChapter(storyArc, chapterIndex) : null
  const chaptersRemainingInAct = currentAct ? currentAct.endChapter - (chapterIndex + 1) : 0

  const outlineItem = outline?.[chapterIndex]

  return {
    rejectedClaims,
    requiredClaims: {
      pendingMandatoryBeats: pendingMandatoryBeatIds.map((beatId) => ({
        beatId,
        beat: beatText(beatId),
      })),
      chaptersRemainingInAct,
    },
    ...(outlineItem
      ? {
          currentOutline: {
            title: outlineItem.title,
            description: outlineItem.description,
          },
        }
      : {}),
  }
}

export interface BuildZeroProgressOutlineRejectionInput {
  chapterIndex: number
  /** 含本章在内的连续零增量章数。 */
  consecutiveZeroIncrementChapters: number
  /** StoryMemory：统计零增量连击窗口内已定稿章节的事件计数。 */
  storyMemory: StoryMemory | null | undefined
  outline: readonly ChapterOutline[] | undefined
  /** 本章已接受结构化事件数（零增量章通常极少甚至为 0）。 */
  currentAcceptedEventCount: number
}

/**
 * 跨章零增量闸（C.2.2）升级后的大纲重生成反馈：携带零增量连击窗口内
 * 最近 N 章（含本章）的已接受结构化事件计数，让大纲 agent 看到量化证据，
 * 围绕可观察的状态/事件变化重新组织本章。
 */
export function buildZeroProgressOutlineRejection(
  input: BuildZeroProgressOutlineRejectionInput
): ZeroProgressRejection {
  const {
    chapterIndex,
    consecutiveZeroIncrementChapters,
    storyMemory,
    outline,
    currentAcceptedEventCount,
  } = input

  const recentChapterEventCounts: ZeroProgressRejection['recentChapterEventCounts'] = []
  const firstRecentChapter = Math.max(0, chapterIndex - (consecutiveZeroIncrementChapters - 1))
  for (let index = firstRecentChapter; index < chapterIndex; index++) {
    recentChapterEventCounts.push({
      chapterIndex: index,
      acceptedEventCount: (storyMemory?.events ?? []).filter(
        (event) => event.chapterIndex === index
      ).length,
    })
  }
  recentChapterEventCounts.push({ chapterIndex, acceptedEventCount: currentAcceptedEventCount })

  const outlineItem = outline?.[chapterIndex]
  return {
    consecutiveZeroIncrementChapters,
    recentChapterEventCounts,
    ...(outlineItem
      ? {
          currentOutline: {
            title: outlineItem.title,
            description: outlineItem.description,
          },
        }
      : {}),
  }
}
