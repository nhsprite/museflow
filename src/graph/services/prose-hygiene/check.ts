/**
 * 确定性车道的正文体例检测器。
 *
 * 所有检测均为机器格式解析或已知标识符集合成员判定：
 * - 协议块：=== 区块标记 / 事件行 / STORY_FINAL_STATE 标记是生成协议的显式分隔符；
 * - 内部标识符：仅当 token 属于调用方提供的已知 id 集合时才判定（成员判定，
 *   与 checkpoint id、协议标记同类，红线明确允许）；
 * - 章节自指：第N章的 N 必须落在合法章节号集合内，且 Markdown 标题行豁免
 *   （章节自身的 # 第N章 标题是合法格式，不是叙述自指）。
 */

import { CHAPTER_NUMERAL_CLASS, parseChineseNumber } from '../../../utils/chinese-numerals.js'
import type { ProseHygieneContext, ProseHygieneIssue } from './types.js'

// 生成协议残留检测：=== 区块标记与 STORY_EVENTS 事件行是机器可读的输出协议
// 分隔符，不属于正文。此处只做显式分隔符的格式匹配，不涉及正文语义判断。
export const PROTOCOL_SECTION_MARKER = /^={2,}\s*[A-Z][A-Z_\s]*={2,}\s*$/
export const STORY_EVENT_LINE =
  /^-?\s*(?:character-location|character-status|character-revival|entity-register|item-location|item-state|plot-advance|foreshadow-introduce|foreshadow-fulfill|task-resolve|task-create):/

const CHAPTER_ID_TOKEN = /chapter-\d+/
const CHAPTER_REFERENCE = new RegExp(`第\\s*(${CHAPTER_NUMERAL_CLASS})\\s*章`, 'g')
const MARKDOWN_HEADING_LINE = /^#{1,6}\s/

/** id 字符集之外的字符才算边界，避免 c-25 命中 c-251、act-1 命中 act-10。 */
const ID_CHAR = /[A-Za-z0-9._:-]/

interface ContentLine {
  text: string
  start: number
}

function splitLinesWithOffsets(content: string): ContentLine[] {
  const lines: ContentLine[] = []
  let offset = 0
  for (const text of content.split('\n')) {
    lines.push({ text, start: offset })
    offset += text.length + 1
  }
  return lines
}

function makeIssue(
  code: ProseHygieneIssue['code'],
  start: number,
  end: number,
  excerpt: string
): ProseHygieneIssue {
  return { code, severity: 'error', span: { start, end }, excerpt }
}

/** === 区块标记与事件行检测（格式解析）。 */
export function detectProtocolBlocks(content: string): ProseHygieneIssue[] {
  const issues: ProseHygieneIssue[] = []
  for (const line of splitLinesWithOffsets(content)) {
    const trimmed = line.text.trim()
    if (trimmed.length === 0) continue
    if (PROTOCOL_SECTION_MARKER.test(trimmed) || STORY_EVENT_LINE.test(trimmed)) {
      issues.push(
        makeIssue('prose.protocol-block', line.start, line.start + line.text.length, trimmed)
      )
    }
  }
  return issues
}

/** 已知标识符集合的成员判定：id 作为独立 token 出现在正文中即为泄漏。 */
export function detectInternalIdentifiers(
  content: string,
  identifiers: readonly string[]
): ProseHygieneIssue[] {
  const issues: ProseHygieneIssue[] = []
  for (const id of identifiers) {
    if (id.length < 3) continue
    let fromIndex = 0
    for (;;) {
      const index = content.indexOf(id, fromIndex)
      if (index < 0) break
      fromIndex = index + id.length
      const before = index > 0 ? content[index - 1] : undefined
      const after = content[index + id.length]
      if (before !== undefined && ID_CHAR.test(before)) continue
      if (after !== undefined && ID_CHAR.test(after)) continue
      issues.push(makeIssue('prose.internal-identifier', index, index + id.length, id))
    }
  }
  return issues
}

function parseChapterNumeral(raw: string): number | null {
  const arabic = Number.parseInt(raw, 10)
  if (!Number.isNaN(arabic) && String(arabic) === raw.trim()) return arabic
  return parseChineseNumber(raw)
}

/** 叙述性章节自指检测：第N章（N 为合法章节号且不在 Markdown 标题行）或 chapter-N id。 */
export function detectChapterSelfReferences(
  content: string,
  validChapterNumbers: ReadonlySet<number>
): ProseHygieneIssue[] {
  const issues: ProseHygieneIssue[] = []
  for (const line of splitLinesWithOffsets(content)) {
    if (MARKDOWN_HEADING_LINE.test(line.text.trim())) continue

    CHAPTER_REFERENCE.lastIndex = 0
    for (const match of line.text.matchAll(CHAPTER_REFERENCE)) {
      const numeral = match[1]
      const index = match.index
      if (numeral === undefined || index === undefined) continue
      const chapterNumber = parseChapterNumeral(numeral)
      if (chapterNumber === null || !validChapterNumbers.has(chapterNumber)) continue
      issues.push(
        makeIssue(
          'prose.chapter-self-reference',
          line.start + index,
          line.start + index + match[0].length,
          match[0]
        )
      )
    }

    for (const match of line.text.matchAll(new RegExp(CHAPTER_ID_TOKEN.source, 'g'))) {
      if (match.index === undefined) continue
      issues.push(
        makeIssue(
          'prose.chapter-self-reference',
          line.start + match.index,
          line.start + match.index + match[0].length,
          match[0]
        )
      )
    }
  }
  return issues
}

function buildValidChapterNumbers(ctx: ProseHygieneContext): ReadonlySet<number> {
  if (ctx.totalChapters !== undefined && ctx.totalChapters > 0) {
    return new Set(Array.from({ length: ctx.totalChapters }, (_, i) => i + 1))
  }
  if (ctx.chapterNumber !== undefined && ctx.chapterNumber > 0) {
    return new Set([ctx.chapterNumber])
  }
  return new Set()
}

/**
 * 正文体例硬门禁入口。返回的 error 级 issue 视同正文不合格：
 * 调用方必须走重试/阻断通道，不得静默放行。
 */
export function checkProseHygiene(content: string, ctx: ProseHygieneContext): ProseHygieneIssue[] {
  if (!content || content.trim().length === 0) return []

  const issues: ProseHygieneIssue[] = [...detectProtocolBlocks(content)]

  const identifiers = [...(ctx.entityIds ?? []), ...(ctx.beatIds ?? [])]
  if (identifiers.length > 0) {
    issues.push(...detectInternalIdentifiers(content, identifiers))
  }

  const validChapterNumbers = buildValidChapterNumbers(ctx)
  if (validChapterNumbers.size > 0) {
    issues.push(...detectChapterSelfReferences(content, validChapterNumbers))
  }

  return issues.sort((a, b) => a.span.start - b.span.start)
}

/** 将 issue 渲染为可注入重试反馈/报告的单行描述。 */
export function formatProseHygieneIssue(issue: ProseHygieneIssue): string {
  return `${issue.code}（偏移 ${issue.span.start}-${issue.span.end}）：${issue.excerpt}`
}
