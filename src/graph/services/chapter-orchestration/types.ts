import type { VerifiedConstraint } from '../../../types/verified-constraint.js'

export type RoutingDecision =
  | 'draft_chapter'
  | 'fix_chapter'
  | 'finalize_chapter'
  | 'request_rewrite'
  | 'decide_strategy'

export interface RewriteRoutingConfig {
  maxErrorRewriteAttempts: number
  maxNonErrorIssuesPerType: number
  maxVerifiedConstraints: number
  issueSetSimilarityThreshold: number
  downgradeInterpretiveErrors: boolean
  useLLMForIssueClassification: boolean
}

export const DEFAULT_REWRITE_ROUTING_CONFIG: Required<RewriteRoutingConfig> = {
  maxErrorRewriteAttempts: 3,
  maxNonErrorIssuesPerType: 3,
  maxVerifiedConstraints: 20,
  issueSetSimilarityThreshold: 0.5,
  downgradeInterpretiveErrors: true,
  useLLMForIssueClassification: false,
}

export interface RewriteConvergenceResult {
  decision: RoutingDecision
  rewriteApproved: boolean
  pendingIssues: import('../../../types/agent.js').Issue[]
  verifiedConstraints: VerifiedConstraint[]
  forceStructuralRewrite: boolean
  autoFixAttempts: number
}

export interface InterpretiveDowngradeResult {
  issues: import('../../../types/agent.js').Issue[]
  downgraded: boolean
}
