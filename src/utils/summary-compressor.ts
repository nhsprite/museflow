export type CompressionLevel = 'full' | 'medium' | 'minimal'

interface CompressionConfig {
  fullRange: number
  mediumRange: number
  mediumLimit: number
  minimalLimit: number
}

const DEFAULT_CONFIG: CompressionConfig = {
  fullRange: 3,
  mediumRange: 4,
  mediumLimit: 100,
  minimalLimit: 80,
}

/**
 * 按句号/段落边界截断到限额，避免在句子中间硬截断产生残缺前缀。
 * 找不到合适边界时退回硬截断并追加省略号。
 */
function truncateAtSentenceBoundary(text: string, limit: number, level: CompressionLevel): string {
  if (text.length <= limit) return text
  const slice = text.slice(0, limit)
  const lastBoundary = Math.max(
    slice.lastIndexOf('。'),
    slice.lastIndexOf('！'),
    slice.lastIndexOf('？'),
    slice.lastIndexOf('；'),
    slice.lastIndexOf('.'),
    slice.lastIndexOf('\n')
  )
  const minThreshold = level === 'medium' ? limit * 0.7 : limit * 0.6
  if (lastBoundary > minThreshold) {
    return text.slice(0, lastBoundary + 1)
  }
  return slice + '...'
}

/**
 * 压缩散文格式章节摘要：full 保留全文，medium/minimal 按句界截断到限额。
 */
function compressSummary(summary: string, level: CompressionLevel): string {
  const trimmed = summary.trim()
  if (!trimmed) return ''

  switch (level) {
    case 'full':
      return trimmed
    case 'medium':
      return truncateAtSentenceBoundary(trimmed, DEFAULT_CONFIG.mediumLimit, level)
    case 'minimal':
      return truncateAtSentenceBoundary(trimmed, DEFAULT_CONFIG.minimalLimit, level)
  }
}

export function getCompressionLevel(
  chapterIndex: number,
  currentChapterIndex: number
): CompressionLevel {
  const distance = currentChapterIndex - chapterIndex

  if (distance <= DEFAULT_CONFIG.fullRange) {
    return 'full'
  } else if (distance <= DEFAULT_CONFIG.fullRange + DEFAULT_CONFIG.mediumRange) {
    return 'medium'
  } else {
    return 'minimal'
  }
}

export function buildLayeredSummaries(summaries: string[], currentChapterIndex: number): string {
  if (!summaries.length || currentChapterIndex === 0) {
    return '（这是第一章）'
  }

  const result: string[] = []

  for (let i = 0; i < summaries.length && i < currentChapterIndex; i++) {
    const summary = summaries[i]
    if (!summary || !summary.trim()) continue

    const level = getCompressionLevel(i, currentChapterIndex)
    const compressed = compressSummary(summary, level)

    if (compressed) {
      const displayChapter = i + 1
      if (level === 'full') {
        result.push(`第${displayChapter}章：${compressed}`)
      } else {
        result.push(`第${displayChapter}章[${level === 'medium' ? '略' : '概'}]：${compressed}`)
      }
    }
  }

  return result.join('\n\n')
}
