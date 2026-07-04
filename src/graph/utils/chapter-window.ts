import type { ReducedGraphState } from '../state.js'
import { readChapterContent } from '../../storage/filesystem/writer.js'

const DEFAULT_SNIPPET_MAX_CHARS = 900

function contentParagraphs(content: string): string[] {
  return content
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
    .filter((paragraph) => !/^#{1,6}\s+/.test(paragraph))
}

export function extractChapterOpeningSnippet(
  content: string,
  maxChars = DEFAULT_SNIPPET_MAX_CHARS
): string {
  const paragraphs = contentParagraphs(content)
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
  const paragraphs = contentParagraphs(content)
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
