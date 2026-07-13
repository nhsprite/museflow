import type { ReducedGraphState } from '../state.js'
import { readChapterContent } from '../../storage/filesystem/writer.js'
import { splitContentParagraphs } from '../../utils/text.js'

const DEFAULT_SNIPPET_MAX_CHARS = 900

export function extractChapterOpeningSnippet(
  content: string,
  maxChars = DEFAULT_SNIPPET_MAX_CHARS
): string {
  const paragraphs = splitContentParagraphs(content)
  if (paragraphs.length === 0) return content.trim().slice(0, maxChars)

  const selected: string[] = []
  let length = 0
  for (const paragraph of paragraphs) {
    if (selected.length > 0 && length + paragraph.length > maxChars) break
    selected.push(paragraph)
    length += paragraph.length
    if (length >= maxChars) break
  }

  const snippet = selected.join('\n\n')
  return snippet.length > maxChars ? snippet.slice(0, maxChars) : snippet
}

export function extractChapterEndingSnippet(
  content: string,
  maxChars = DEFAULT_SNIPPET_MAX_CHARS
): string {
  const paragraphs = splitContentParagraphs(content)
  if (paragraphs.length === 0) return content.trim().slice(-maxChars)

  const selected: string[] = []
  let length = 0
  for (let index = paragraphs.length - 1; index >= 0; index--) {
    const paragraph = paragraphs[index]
    if (!paragraph) continue
    if (selected.length > 0 && length + paragraph.length > maxChars) break
    selected.unshift(paragraph)
    length += paragraph.length
    if (length >= maxChars) break
  }

  const snippet = selected.join('\n\n')
  return snippet.length > maxChars ? snippet.slice(-maxChars) : snippet
}

export function extractChapterEndingParagraphs(content: string, count = 2): string[] {
  const paragraphs = splitContentParagraphs(content)
  return paragraphs.slice(-count)
}

export function hasDuplicateEndingParagraphs(
  previousContent: string,
  currentContent: string,
  count = 2
): { duplicate: boolean; paragraph?: string } {
  const previousParagraphs = extractChapterEndingParagraphs(previousContent, count)
  const currentParagraphs = extractChapterEndingParagraphs(currentContent, count)

  for (const current of currentParagraphs) {
    for (const previous of previousParagraphs) {
      if (current === previous && current.length > 0) {
        return { duplicate: true, paragraph: current }
      }
    }
  }

  return { duplicate: false }
}

/**
 * 构建章末重复段落提示文案。无重复时返回 undefined。
 */
export function buildDuplicateEndingParagraphMessage(
  chapterIndex: number,
  previousContent: string,
  currentContent: string
): string | undefined {
  const check = hasDuplicateEndingParagraphs(previousContent, currentContent, 1)
  if (!check.duplicate) return undefined
  const preview = check.paragraph?.slice(0, 80) ?? ''
  return `第 ${chapterIndex + 1} 章结尾与上一章结尾存在重复段落，疑似直接复制：${preview}${preview.length >= 80 ? '……' : ''}`
}

export async function buildPreviousChapterEndingContext(
  state: ReducedGraphState,
  chapterIndex: number
): Promise<string> {
  if (chapterIndex <= 0) return ''

  const previousContent = await readChapterContent(state.story.outputDir, chapterIndex)
  if (!previousContent || previousContent.trim().length === 0) return ''

  const ending = extractChapterEndingSnippet(previousContent)
  if (!ending) return ''

  return `【上一章结尾片段】\n${ending}`
}
