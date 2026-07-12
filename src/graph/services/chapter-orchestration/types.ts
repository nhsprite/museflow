export type RoutingDecision =
  | 'draft_chapter'
  | 'fix_chapter'
  | 'finalize_chapter'
  | 'request_rewrite'
  | 'decide_strategy'
  | 'repair_state'

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
