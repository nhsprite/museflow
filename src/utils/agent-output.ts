import type { Issue, IssueSeverity, IssueType } from '../types/agent.js'
import type { ChapterMeta } from '../types/chapter.js'
import { generateId } from './id.js'

export interface RawIssue {
  type?: string
  severity?: string
  description?: string
  location?: string
  suggestion?: string
  aspect?: string
  conflict_with?: string
  [key: string]: unknown
}

export interface NormalizeIssuesOptions {
  withdrawnPattern?: RegExp
  filter?: (issue: RawIssue) => boolean
  mapType?: (issue: RawIssue) => IssueType
  defaultSeverity?: IssueSeverity
}

const DEFAULT_WITHDRAWN_PATTERN = /撤回|不成立|不构成严重矛盾|此条不成立|重新审视后|不构成.*矛盾|不视为/i

export function normalizeIssues(
  rawIssues: RawIssue[] | undefined,
  type: IssueType,
  options: NormalizeIssuesOptions = {},
): Issue[] {
  if (!rawIssues) return []

  const withdrawnPattern = options.withdrawnPattern ?? DEFAULT_WITHDRAWN_PATTERN

  return rawIssues
    .filter(issue => {
      const desc = `${issue.description ?? ''} ${issue.suggestion ?? ''}`
      if (withdrawnPattern.test(desc)) return false
      if (options.filter && !options.filter(issue)) return false
      return true
    })
    .map(issue => {
      const mappedType = options.mapType ? options.mapType(issue) : type
      const severity = (issue.severity as IssueSeverity) || options.defaultSeverity || 'warning'
      const result: Issue = {
        id: generateId(),
        type: mappedType,
        severity,
        description: issue.description || '',
      }
      const location = issue.location || issue.aspect || issue.conflict_with
      if (location) {
        result.location = location
      }
      if (issue.suggestion) {
        result.suggestion = issue.suggestion
      }
      return result
    })
}

export function createChapterMeta(
  storyId: string,
  number: number,
  overrides?: Partial<ChapterMeta>,
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

const POSITIVE_FEEDBACK_PATTERNS = [
  /未检测到/i,
  /未发现/i,
  /没有.*问题/i,
  /没有.*痕迹/i,
  /无明显/i,
  /\bno\s+(?:issues?|problems?)\s*(?:found|detected)?\b/i,
]

export function isPositiveFeedback(description: string): boolean {
  return POSITIVE_FEEDBACK_PATTERNS.some(pattern => pattern.test(description))
}
