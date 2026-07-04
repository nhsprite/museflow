import type { Issue, IssueType } from './agent.js'

export type DraftStrategy = 'draft' | 'fix' | 'replan' | 'finalize-only'

export type ConvergenceResult =
  | 'success'
  | 'max-attempts-reached'
  | 'state-corruption-escape'
  | 'manual-rewrite-requested'

export type StateCorrectionReason =
  | 'canonical_fact'
  | 'superseded_fact'
  | 'alias_merge'
  | 'override'

export interface StateCorrection {
  subject: string
  attribute: string
  oldValue: string
  newValue: string
  reason: StateCorrectionReason
}

export interface ChapterIssueSummary {
  total: number
  errors: number
  warnings: number
  infos: number
  byType: Record<IssueType, number>
}

export interface ChapterReport {
  storyId: string
  chapterIndex: number
  chapterTitle: string
  generatedAt: number

  draftStrategy: DraftStrategy
  rewriteAttempts: number
  errorRewriteAttempts: number
  autoFixAttempts: number

  issues: Issue[]
  issuesSummary: ChapterIssueSummary
  issuesAutoResolved: Issue[]
  issuesDowngraded: Issue[]

  stateCorrections: StateCorrection[]

  foreshadowsPlanted: number
  foreshadowsFulfilled: number
  foreshadowsOverdue: number

  wordCount: number
  summary: string | null

  actProgress?: {
    actIndex: number
    chaptersRemaining: number
    beatsTotal: number
    beatsConsumed: number
    beatsPending: string[]
  }

  actBoundaryProposals?: Array<{
    actIndex: number
    proposedEndChapter: number
    reason: string
  }>

  convergence: ConvergenceResult
}

export function createEmptyChapterReport(storyId: string, chapterIndex: number): ChapterReport {
  return {
    storyId,
    chapterIndex,
    chapterTitle: '',
    generatedAt: Date.now(),
    draftStrategy: 'draft',
    rewriteAttempts: 0,
    errorRewriteAttempts: 0,
    autoFixAttempts: 0,
    issues: [],
    issuesSummary: createEmptyIssueSummary(),
    issuesAutoResolved: [],
    issuesDowngraded: [],
    stateCorrections: [],
    foreshadowsPlanted: 0,
    foreshadowsFulfilled: 0,
    foreshadowsOverdue: 0,
    wordCount: 0,
    summary: null,
    convergence: 'success',
  }
}

export function createEmptyIssueSummary(): ChapterIssueSummary {
  return {
    total: 0,
    errors: 0,
    warnings: 0,
    infos: 0,
    byType: {
      consistency: 0,
      continuity: 0,
      word_count: 0,
      outline_violation: 0,
      outline_deviation: 0,
      draft_failure: 0,
      outline_density: 0,
      outline_foreshadow: 0,
      state_corruption: 0,
      outline_missing: 0,
      outline_gap: 0,
      outline_invalid: 0,
      outline_coverage: 0,
      outline_empty_beats: 0,
      outline_invalid_deadline: 0,
    },
  }
}

export function summarizeIssues(issues: Issue[]): ChapterIssueSummary {
  const summary = createEmptyIssueSummary()
  for (const issue of issues) {
    summary.total++
    if (issue.severity === 'error') {
      summary.errors++
    } else if (issue.severity === 'warning') {
      summary.warnings++
    } else {
      summary.infos++
    }
    summary.byType[issue.type] = (summary.byType[issue.type] ?? 0) + 1
  }
  return summary
}
