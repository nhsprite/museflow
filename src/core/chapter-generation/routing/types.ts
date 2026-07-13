import type { Issue } from '../../../types/agent.js'
import type { BlockingReason } from '../../../types/blocking-report.js'
import type { ChapterPlanningConfig } from '../../../types/genre.js'
import type { StructuredValidationResult } from '../../../story-memory/validator.js'

export type ChapterStep =
  | { kind: 'draft_chapter'; discardPlan: boolean; feedbackIssues: Issue[] }
  | { kind: 'fix_chapter'; patchableIssues: Issue[] }
  | { kind: 'finalize_chapter' }
  | { kind: 'repair_state' }
  | { kind: 'request_rewrite'; reason: BlockingReason; blockingIssues: Issue[] }

/** 路由决策与 LangGraph 边名共享同一字面量集合。 */
export type RoutingDecision = ChapterStep['kind']

export interface ChapterSession {
  chapterIndex: number
  rewriteAttempts: number
  errorRewriteAttempts: number
  autoFixAttempts: number
  previousIssues: Issue[]
  previousRawErrorCount: number
  routingDecision: RoutingDecision | undefined
  forceStructuralRewrite: boolean
  rewriteApproved: boolean
  issueFingerprintHistory: string[][]
  /** 本章是否已尝试过自动状态修复（repair_state），每章限 1 次。 */
  stateRepairAttempted?: boolean
}

export interface RoutingContext {
  session: ChapterSession
  pendingIssues: Issue[]
  genre: string
  chapterFileExists: boolean
  structuredValidationResult: StructuredValidationResult | undefined
}

export interface IssuePolicyDeps {
  deduplicateIssues?: (issues: Issue[]) => Promise<Issue[]> | Issue[]
  isInterpretiveIssue: (issue: Issue) => boolean
  planningConfig: ChapterPlanningConfig
  log?: (level: 'info' | 'warn' | 'error', message: string, ...meta: unknown[]) => void
}

export interface RewritePolicyDeps {
  calculateIssueSetSimilarity: (prev: Issue[], curr: Issue[]) => Promise<number>
  isInterpretiveIssue: (issue: Issue) => boolean
  isStateCorruptionIssue: (issue: Issue) => boolean
  planningConfig: ChapterPlanningConfig
  log?: (level: 'info' | 'warn' | 'error', message: string, ...meta: unknown[]) => void
}

export interface FixPolicyDeps {
  log?: (level: 'info' | 'warn' | 'error', message: string, ...meta: unknown[]) => void
}

export interface IssuePolicyResult {
  issues: Issue[]
  downgraded: boolean
  cappedTypes: string[]
}

export interface RewritePolicyResult {
  issues: Issue[]
  forceStructuralRewrite: boolean
  errorCountIncreased: boolean
  issuesHighlySimilar: boolean
  hasStateCorruptionError: boolean
  newConstraints: string[]
}

export interface RoutingResult {
  step: ChapterStep
  sessionUpdate: Partial<ChapterSession>
  processedIssues: Issue[]
  newConstraints: string[]
}
