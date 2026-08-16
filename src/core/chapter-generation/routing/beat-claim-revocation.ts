import type { Issue } from '../../../types/agent.js'
import type { ChapterOutline, StoryArc } from '../../../types/outline.js'
import { findMandatoryBeatById } from '../../../utils/mandatory-beat-ids.js'

/**
 * 重写循环内的节拍认领撤销机制。
 *
 * 正文阶段的语义验证（structured.beat-unproven）暴露的可能是大纲层的虚假认领：
 * 大纲 description 根本没有该节拍的可呈现事件，正文无论怎么重起草都无法证明它，
 * 而认领由持久化大纲在每轮强制重放，循环内没有其他摘除机制，最终必然停滞。
 * 同一节拍连续两轮未通过验证即判定为认领错误：从大纲摘除该认领并弃置 plan 重建，
 * 而不是无限重起草正文。节拍保持未消费状态，由后续章节与幕边界门禁接管。
 */

/**
 * 找出连续两轮未通过正文验证的节拍 ID。
 * previousIssues 是上一轮路由回写的问题快照；currentErrors 是本轮剩余 error。
 *
 * D.2.1：上一轮为 proven 但未佐证的 mandatory beat（beat_uncorroborated error）
 * 已享受过一次携带 beatCorroboration 反馈的起草重试，本轮仍未佐证的会被路由层
 * 转换为 beat_unproven——上一轮的 beat_uncorroborated 计入「持续未证明」的前任，
 * 使撤销/大纲重生成路径在重试耗尽后立即生效，而不是再空转两轮。
 */
export function findPersistentBeatUnprovenBeatIds(
  previousIssues: readonly Issue[],
  currentErrors: readonly Issue[]
): string[] {
  const previouslyUnproven = new Set(
    previousIssues
      .filter(
        (issue) =>
          issue.type === 'beat_unproven' ||
          (issue.type === 'beat_uncorroborated' && issue.severity === 'error')
      )
      .map((issue) => issue.subject)
      .filter((subject): subject is string => typeof subject === 'string' && subject.length > 0)
  )
  if (previouslyUnproven.size === 0) return []

  const persistent: string[] = []
  for (const issue of currentErrors) {
    if (issue.type !== 'beat_unproven' || !issue.subject) continue
    if (previouslyUnproven.has(issue.subject) && !persistent.includes(issue.subject)) {
      persistent.push(issue.subject)
    }
  }
  return persistent
}

/**
 * 从目标章节的大纲条目中摘除指定节拍认领（mandatory beats 与 key beats）。
 * claimedBeats 文本按剩余 ID 从注册表重建；无 storyArc 时仅过滤 ID 数组、保留原文案。
 */
export function dropBeatClaimsFromOutline(
  outline: readonly ChapterOutline[],
  chapterIndex: number,
  beatIds: readonly string[],
  storyArc: StoryArc | null | undefined
): ChapterOutline[] {
  const item = outline[chapterIndex]
  if (!item || beatIds.length === 0) return [...outline]

  const dropped = new Set(beatIds)
  const claimedMandatoryBeatIds = (item.claimedMandatoryBeatIds ?? []).filter(
    (id) => !dropped.has(id)
  )
  const claimedBeatIds = (item.claimedBeatIds ?? []).filter((id) => !dropped.has(id))
  const claimedBeats = storyArc
    ? claimedMandatoryBeatIds.flatMap((id) => {
        const beat = findMandatoryBeatById(storyArc, id)?.beat
        return beat ? [beat] : []
      })
    : (item.claimedBeats ?? [])

  const next = [...outline]
  next[chapterIndex] = {
    ...item,
    claimedMandatoryBeatIds,
    claimedBeatIds,
    claimedBeats,
  }
  return next
}
