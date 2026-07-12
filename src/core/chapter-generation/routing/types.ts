import type { Issue } from '../../../types/agent.js'
import type { BlockingReason } from '../../../types/blocking-report.js'
import type { ChapterPlanningConfig } from '../../../types/genre.js'
import type { StructuredValidationResult } from '../../../story-memory/validator.js'

export type RoutingDecision =
  | 'draft_chapter'
  | 'fix_chapter'
  | 'finalize_chapter'
  | 'request_rewrite'
  | 'decide_strategy'
  | 'repair_state'

export type ChapterStep =
  | { kind: 'draft'; discardPlan: boolean; feedbackIssues: Issue[] }
  | { kind: 'fix'; patchableIssues: Issue[] }
  | { kind: 'finalize' }
  | { kind: 'repair_state' }
  | { kind: 'request_rewrite'; reason: BlockingReason; blockingIssues: Issue[] }

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
  isInterpretiveIssue: (issue: Issue) => Promise<boolean> | boolean
  planningConfig: ChapterPlanningConfig
  log?: (level: 'info' | 'warn' | 'error', message: string, ...meta: unknown[]) => void
}

export interface RewritePolicyDeps {
  calculateIssueSetSimilarity: (prev: Issue[], curr: Issue[]) => Promise<number>
  isInterpretiveIssue: (issue: Issue) => Promise<boolean> | boolean
  isStateCorruptionIssue: (issue: Issue) => Promise<boolean> | boolean
  planningConfig: ChapterPlanningConfig
  log?: (level: 'info' | 'warn' | 'error', message: string, ...meta: unknown[]) => void
}

export interface FixPolicyDeps {
  splitIntoParagraphs: (content: string) => string[]
  findAffectedParagraphs: (paragraphs: string[], issues: Issue[]) => number[]
  planningConfig: ChapterPlanningConfig
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
