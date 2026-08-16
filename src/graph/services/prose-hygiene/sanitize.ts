/**
 * 确定性车道的机械清理：只移除机器可读的协议残留与已知标识符的括号注释。
 * 用于两处：
 * 1. 上下文回喂净化（chapter-window）：上一章结尾片段注入 prompt 前剥离污染；
 * 2. 历史章节修复脚本（scripts/repair-chapter-prose.ts）：机械可移除残留的修复。
 *
 * 不做任何自然语言判断；不能机械移除的残留（裸标识符、章节自指）由
 * checkProseHygiene 报告，交重试/人工通道处理。
 */

import { PROTOCOL_SECTION_MARKER, STORY_EVENT_LINE } from './check.js'
import type { ProseHygieneContext } from './types.js'

const FINAL_STATE_MARKER = /={2,}\s*STORY_FINAL_STATE\s*={2,}/
/** STORY_FINAL_STATE 区块内的 JSON 行（机器格式），允许逐行剥离。 */
const FINAL_STATE_JSON_LINE = /^(?:[[\]{},]|.*"entityId")/

/**
 * 剥离生成协议残留：=== 区块标记、STORY_EVENTS 事件行、STORY_FINAL_STATE 区块
 * （标记行 + 其后的 JSON 行，遇到首个非 JSON 非空行结束）。
 */
export function stripProtocolArtifacts(content: string): string {
  const kept: string[] = []
  let inFinalState = false

  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (inFinalState) {
      if (trimmed.length === 0 || FINAL_STATE_JSON_LINE.test(trimmed)) continue
      inFinalState = false
    }
    if (PROTOCOL_SECTION_MARKER.test(trimmed)) {
      if (FINAL_STATE_MARKER.test(trimmed)) inFinalState = true
      continue
    }
    if (STORY_EVENT_LINE.test(trimmed)) continue
    kept.push(line)
  }

  return kept
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * 剥离已知标识符的括号注释：`名称（c-25）` → `名称`。
 * 仅处理括号包裹形态（机械可移除、不损伤句子结构）；裸 id 不在此处理。
 */
export function stripIdentifierParentheticals(
  content: string,
  identifiers: readonly string[]
): string {
  let result = content
  for (const id of identifiers) {
    if (id.length < 3) continue
    result = result.split(`（${id}）`).join('')
    result = result.split(`(${id})`).join('')
  }
  return result
}

/**
 * 上下文回喂净化入口：协议残留 + 已知标识符括号注释一并剥离，
 * 阻断泄漏章节对后续章节的污染循环。
 */
export function sanitizeProseExcerpt(content: string, ctx: ProseHygieneContext): string {
  const identifiers = [...(ctx.entityIds ?? []), ...(ctx.beatIds ?? [])]
  return stripIdentifierParentheticals(stripProtocolArtifacts(content), identifiers)
}
