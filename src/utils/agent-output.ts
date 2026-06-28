import type { Issue, IssueSeverity, IssueType } from '../types/agent.js'
import type { ChapterMeta } from '../types/chapter.js'
import type { ModelProvider } from '../model/provider.js'
import type { CanonicalFact } from '../types/story-state.js'
import { generateId } from './id.js'
import { logger } from './logger.js'
import {
  batchJudgeWithdrawnIssues,
  batchJudgePositiveFeedback,
} from './context-judge.js'

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
  filter?: (issue: RawIssue) => boolean
  mapType?: (issue: RawIssue) => IssueType
  defaultSeverity?: IssueSeverity
  canonicalFacts?: CanonicalFact[] | undefined
}

export async function normalizeIssues(
  rawIssues: RawIssue[] | undefined,
  type: IssueType,
  provider: ModelProvider | undefined,
  options: NormalizeIssuesOptions = {},
): Promise<Issue[]> {
  if (!rawIssues) return []

  const afterFilter = options.filter
    ? rawIssues.filter(options.filter)
    : rawIssues

  if (afterFilter.length === 0) return []

  let withdrawn: boolean[] = []
  let positive: boolean[] = []

  if (provider) {
    const descriptions = afterFilter.map(i => i.description || '')
    ;[withdrawn, positive] = await Promise.all([
      batchJudgeWithdrawnIssues(provider, descriptions),
      batchJudgePositiveFeedback(provider, descriptions),
    ])
  }

  const issues = afterFilter
    .filter((_issue, index) => !withdrawn[index] && !positive[index])
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

  if (options.canonicalFacts && options.canonicalFacts.length > 0) {
    return filterIssuesAgainstCanonicalFacts(issues, options.canonicalFacts)
  }

  return issues
}

/**
 * 保守过滤：如果某个 consistency issue 的描述直接否定了 canonicalFact 中记录的事实，
 * 则视为校验器自身违背 canonical_facts_authority 规则，予以丢弃。
 * 该函数只处理明显矛盾，避免误伤合理的质疑。
 */
export function filterIssuesAgainstCanonicalFacts(issues: Issue[], canonicalFacts: CanonicalFact[]): Issue[] {
  if (canonicalFacts.length === 0) return issues

  const negationMarkers = /不应|不应该|不可能|并非|不是|不在|没有|错误|矛盾|冲突/g

  return issues.filter(issue => {
    if (issue.type !== 'consistency') return true
    const text = `${issue.description ?? ''} ${issue.suggestion ?? ''}`
    if (!negationMarkers.test(text)) return true

    for (const fact of canonicalFacts) {
      const subject = fact.subject?.trim() ?? ''
      const value = fact.value?.trim() ?? ''
      if (subject.length < 2 || value.length < 5) continue

      if (!text.includes(subject)) continue

      const coreAssertion = value.replaceAll(subject, '').trim()
      if (coreAssertion.length >= 2 && text.includes(coreAssertion)) {
        logger.warn(
          `[MuseFlow] consistency issue 与 canonicalFact 直接矛盾，已过滤: ${issue.description?.slice(0, 80)}... (fact: ${fact.subject}/${fact.attribute})`
        )
        return false
      }

      if (text.includes(value)) {
        logger.warn(
          `[MuseFlow] consistency issue 与 canonicalFact 直接矛盾，已过滤: ${issue.description?.slice(0, 80)}... (fact: ${fact.subject}/${fact.attribute})`
        )
        return false
      }
    }
    return true
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
