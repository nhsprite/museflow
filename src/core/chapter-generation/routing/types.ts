import type { Issue } from '../../../types/agent.js'
import type { BlockingReason } from '../../../types/blocking-report.js'
import type { ChapterPlanningConfig } from '../../../types/genre.js'
import type { StructuredValidationResult } from '../../../story-memory/validator.js'

export type ChapterStep =
  | {
      kind: 'draft_chapter'
      discardPlan: boolean
      feedbackIssues: Issue[]
      /** 连续多轮未被正文证实、本轮应从大纲撤销的节拍认领 ID。 */
      revokedBeatClaimIds?: string[]
    }
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
  /** 本章已尝试自动状态修复（repair_state）的次数，上限由题材配置决定。 */
  stateRepairAttempts?: number
  /** 上轮状态修复被结构化校验拒绝的提案反馈，供下一次 LLM 提案参考。 */
  stateRepairRejections?: string[]
}

export interface RoutingContext {
  session: ChapterSession
  pendingIssues: Issue[]
  genre: string
  chapterFileExists: boolean
  structuredValidationResult: StructuredValidationResult | undefined
  /** 幕边界高压（未消费 mandatory beats 多于幕内剩余章节）。高压下不允许以撤销认领方式跳过节拍。 */
  mandatoryBeatHighPressure?: boolean
  /** 当前幕尚未被正文证实的 mandatory beat ID；撤销名单与之相交即触发高压阻塞。 */
  unprovenMandatoryBeatIds?: readonly string[]
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
