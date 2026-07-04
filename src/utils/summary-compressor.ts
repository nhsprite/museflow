export type CompressionLevel = 'full' | 'medium' | 'minimal'
export type ImportanceLevel = 'critical' | 'major' | 'minor'

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

interface ImportanceItem {
  text: string
  importance: ImportanceLevel
}

interface ChapterSummaryData {
  characters?: string[]
  characterFacts?: Array<{
    character: string
    facts: Array<ImportanceItem | string>
  }>
  keyEvents?: Array<ImportanceItem | string>
  locations?: Array<ImportanceItem | string>
  keyItems?: Array<ImportanceItem | string>
  activePlots?: Array<ImportanceItem | string>
  mood?: string
}

export function getImportanceThreshold(level: CompressionLevel): ImportanceLevel {
  switch (level) {
    case 'full':
      return 'minor'
    case 'medium':
      return 'major'
    case 'minimal':
      return 'critical'
  }
}

function meetsImportanceThreshold(
  itemImportance: ImportanceLevel,
  threshold: ImportanceLevel
): boolean {
  const order = { critical: 3, major: 2, minor: 1 }
  return order[itemImportance] >= order[threshold]
}

function extractImportance(item: ImportanceItem | string): {
  text: string
  importance: ImportanceLevel
} {
  if (typeof item === 'string') {
    return { text: item, importance: 'major' }
  }
  return {
    text: item.text,
    importance: item.importance ?? 'major',
  }
}

function parseSummaryJson(summary: string): ChapterSummaryData | null {
  try {
    return JSON.parse(summary) as ChapterSummaryData
  } catch {
    return null
  }
}

function filterByImportance<T extends ImportanceItem | string>(
  items: T[] | undefined,
  threshold: ImportanceLevel
): string[] {
  if (!items) return []
  return items
    .map(extractImportance)
    .filter((item) => meetsImportanceThreshold(item.importance, threshold))
    .map((item) => item.text)
}

function formatCharacterFacts(
  characterFacts: Array<{ character: string; facts: Array<ImportanceItem | string> }> | undefined,
  threshold: ImportanceLevel
): string[] {
  if (!characterFacts) return []
  const lines: string[] = []
  for (const entry of characterFacts) {
    const filtered = filterByImportance(entry.facts, threshold)
    if (filtered.length > 0) {
      lines.push(`${entry.character}：${filtered.join('；')}`)
    }
  }
  return lines
}

function formatSummarySection(title: string, items: string[] | undefined): string {
  if (!items || items.length === 0) return ''
  return `${title}：${items.join('；')}`
}

function compressSummaryByImportance(summary: string, level: CompressionLevel): string {
  const data = parseSummaryJson(summary)
  if (!data) {
    return compressSummaryLegacy(summary, level)
  }

  const threshold = getImportanceThreshold(level)
  const sections: string[] = []

  const characters = data.characters ?? []
  if (characters.length > 0) {
    sections.push(`角色：${characters.join('；')}`)
  }

  const characterFactLines = formatCharacterFacts(data.characterFacts, threshold)
  if (characterFactLines.length > 0) {
    sections.push(`角色事实：${characterFactLines.join(' | ')}`)
  }

  const keyEvents = filterByImportance(data.keyEvents, threshold)
  if (keyEvents.length > 0) {
    sections.push(formatSummarySection('关键事件', keyEvents))
  }

  const locations = filterByImportance(data.locations, threshold)
  if (locations.length > 0) {
    sections.push(formatSummarySection('地点', locations))
  }

  const keyItems = filterByImportance(data.keyItems, threshold)
  if (keyItems.length > 0) {
    sections.push(formatSummarySection('关键物品', keyItems))
  }

  const activePlots = filterByImportance(data.activePlots, threshold)
  if (activePlots.length > 0) {
    sections.push(formatSummarySection('进行中的情节', activePlots))
  }

  if (data.mood) {
    sections.push(`氛围：${data.mood}`)
  }

  let result = sections.join('。')

  const limits = {
    full: Infinity,
    medium: DEFAULT_CONFIG.mediumLimit,
    minimal: DEFAULT_CONFIG.minimalLimit,
  }
  const limit = limits[level]

  if (result.length > limit) {
    const slice = result.slice(0, limit)
    const lastPunctuation = Math.max(
      slice.lastIndexOf('。'),
      slice.lastIndexOf('！'),
      slice.lastIndexOf('？'),
      slice.lastIndexOf('；'),
      slice.lastIndexOf('.')
    )
    const minThreshold = level === 'medium' ? limit * 0.7 : limit * 0.6
    if (lastPunctuation > minThreshold) {
      result = result.slice(0, lastPunctuation + 1)
    } else {
      result = result.slice(0, limit) + '...'
    }
  }

  return result
}

function compressSummaryLegacy(summary: string, level: CompressionLevel): string {
  const trimmed = summary.trim()
  if (!trimmed) return ''

  switch (level) {
    case 'full':
      return trimmed

    case 'medium':
      if (trimmed.length <= DEFAULT_CONFIG.mediumLimit) {
        return trimmed
      }
      return trimmed.slice(0, DEFAULT_CONFIG.mediumLimit) + '...'

    case 'minimal':
      if (trimmed.length <= DEFAULT_CONFIG.minimalLimit) {
        return trimmed
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

export function buildLayeredSummaries(summaries: string[], currentChapterIndex: number): string {
  if (!summaries.length || currentChapterIndex === 0) {
    return '（这是第一章）'
  }

  const result: string[] = []

  for (let i = 0; i < summaries.length && i < currentChapterIndex; i++) {
    const summary = summaries[i]
    if (!summary || !summary.trim()) continue

    const level = getCompressionLevel(i, currentChapterIndex)
    const compressed = compressSummaryByImportance(summary, level)

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

export function filterCharacterFactsByImportance(
  summaryJson: string,
  threshold: ImportanceLevel
): Array<{ character: string; facts: string[] }> {
  const data = parseSummaryJson(summaryJson)
  if (!data || !data.characterFacts) return []

  const result: Array<{ character: string; facts: string[] }> = []
  for (const entry of data.characterFacts) {
    const filtered = filterByImportance(entry.facts, threshold)
    if (filtered.length > 0) {
      result.push({ character: entry.character, facts: filtered })
    }
  }
  return result
}

export function filterKeyEventsByImportance(
  summaryJson: string,
  threshold: ImportanceLevel
): string[] {
  const data = parseSummaryJson(summaryJson)
  if (!data) return []
  return filterByImportance(data.keyEvents, threshold)
}
