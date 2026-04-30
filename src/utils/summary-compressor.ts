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
  minimalLimit: 50,
}

export function compressSummary(
  summary: string,
  level: CompressionLevel
): string {
  const trimmed = summary.trim()
  if (!trimmed) return ''

  switch (level) {
    case 'full':
      return trimmed

    case 'medium':
      if (trimmed.length <= DEFAULT_CONFIG.mediumLimit) {
        return trimmed
      }
      const mediumSlice = trimmed.slice(0, DEFAULT_CONFIG.mediumLimit)
      const lastPunctuation = Math.max(
        mediumSlice.lastIndexOf('。'),
        mediumSlice.lastIndexOf('！'),
        mediumSlice.lastIndexOf('？'),
        mediumSlice.lastIndexOf('.')
      )
      if (lastPunctuation > DEFAULT_CONFIG.mediumLimit * 0.7) {
        return trimmed.slice(0, lastPunctuation + 1)
      }
      return trimmed.slice(0, DEFAULT_CONFIG.mediumLimit) + '...'

    case 'minimal':
      if (trimmed.length <= DEFAULT_CONFIG.minimalLimit) {
        return trimmed
      }
      const minimalSlice = trimmed.slice(0, DEFAULT_CONFIG.minimalLimit)
      const lastPunct = Math.max(
        minimalSlice.lastIndexOf('。'),
        minimalSlice.lastIndexOf('！'),
        minimalSlice.lastIndexOf('？'),
        minimalSlice.lastIndexOf('.')
      )
      if (lastPunct > DEFAULT_CONFIG.minimalLimit * 0.6) {
        return trimmed.slice(0, lastPunct + 1)
      }
      return trimmed.slice(0, DEFAULT_CONFIG.minimalLimit) + '...'
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

export function buildLayeredSummaries(
  summaries: string[],
  currentChapterIndex: number
): string {
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

export function estimateCompressedLength(
  summaries: string[],
  currentChapterIndex: number
): number {
  let total = 0
  for (let i = 0; i < summaries.length && i < currentChapterIndex; i++) {
    const level = getCompressionLevel(i, currentChapterIndex)
    const summary = summaries[i] || ''
    switch (level) {
      case 'full':
        total += summary.length
        break
      case 'medium':
        total += Math.min(summary.length, DEFAULT_CONFIG.mediumLimit)
        break
      case 'minimal':
        total += Math.min(summary.length, DEFAULT_CONFIG.minimalLimit)
        break
    }
  }
  return total
}
