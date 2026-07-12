import type { Issue, IssueLocationRef, IssueSeverity, IssueType } from '../types/agent.js'
import type { ChapterMeta } from '../types/chapter.js'
import type { ModelProvider } from '../model/provider.js'
import { generateId } from './id.js'
import { batchJudgeWithdrawnIssues, batchJudgePositiveFeedback } from './context-judge.js'

export interface RawIssue {
  type?: string
  severity?: string
  description?: string
  subject?: string
  location?: string
  locationRef?: unknown
  location_ref?: unknown
  paragraphIndex?: unknown
  sentenceIndex?: unknown
  paragraphNumber?: unknown
  sentenceNumber?: unknown
  suggestion?: string
  aspect?: string
  conflict_with?: string
  [key: string]: unknown
}

export interface NormalizeIssuesOptions {
  filter?: (issue: RawIssue) => boolean
  mapType?: (issue: RawIssue) => IssueType
  defaultSeverity?: IssueSeverity
}

export async function normalizeIssues(
  rawIssues: RawIssue[] | undefined,
  type: IssueType,
  provider: ModelProvider | undefined,
  options: NormalizeIssuesOptions = {}
): Promise<Issue[]> {
  if (!rawIssues) return []

  const afterFilter = options.filter ? rawIssues.filter(options.filter) : rawIssues

  if (afterFilter.length === 0) return []

  let withdrawn: boolean[] = []
  let positive: boolean[] = []

  if (provider) {
    const descriptions = afterFilter.map((i) => i.description || '')
    ;[withdrawn, positive] = await Promise.all([
      batchJudgeWithdrawnIssues(provider, descriptions),
      batchJudgePositiveFeedback(provider, descriptions),
    ])
  }

  return afterFilter
    .filter((_issue, index) => !withdrawn[index] && !positive[index])
    .map((issue) => {
      const mappedType = options.mapType ? options.mapType(issue) : type
      const severity = (issue.severity as IssueSeverity) || options.defaultSeverity || 'warning'
      const result: Issue = {
        id: generateId(),
        type: mappedType,
        severity,
        description: issue.description || '',
      }
      if (issue.subject && typeof issue.subject === 'string' && issue.subject.trim().length > 0) {
        result.subject = issue.subject.trim()
      }
      if (issue.location) {
        result.location = issue.location
      }
      const locationRef = normalizeLocationRef(issue)
      if (locationRef) {
        result.locationRef = locationRef
      }
      if (issue.suggestion) {
        result.suggestion = issue.suggestion
      }
      if (issue.aspect) {
        result.dimension = issue.aspect
      }
      return result
    })
}

function normalizeLocationRef(issue: RawIssue): IssueLocationRef | undefined {
  const source = readLocationSource(issue)
  const paragraphIndex = readIndex(source['paragraphIndex'])
  const sentenceIndex = readIndex(source['sentenceIndex'])
  const paragraphNumber = readNumber(source['paragraphNumber'])
  const sentenceNumber = readNumber(source['sentenceNumber'])

  const result: IssueLocationRef = {}
  if (paragraphIndex !== undefined) {
    result.paragraphIndex = paragraphIndex
  } else if (paragraphNumber !== undefined) {
    result.paragraphIndex = paragraphNumber - 1
  }

  if (sentenceIndex !== undefined) {
    result.sentenceIndex = sentenceIndex
  } else if (sentenceNumber !== undefined) {
    result.sentenceIndex = sentenceNumber - 1
  }

  return Object.keys(result).length > 0 ? result : undefined
}

function readLocationSource(issue: RawIssue): Record<string, unknown> {
  const nested = issue.locationRef ?? issue.location_ref
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return nested as Record<string, unknown>
  }
  return issue
}

function readIndex(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

export function createChapterMeta(
  storyId: string,
  number: number,
  overrides?: Partial<ChapterMeta>
): ChapterMeta {
  const now = Date.now()
  return {
    id: generateId('ch'),
    storyId,
    number,
    title: null,
    outline: null,
    summary: null,
    foreshadows: null,
    status: 'drafting',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}
