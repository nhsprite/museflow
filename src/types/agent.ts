export type IssueSeverity = 'error' | 'warning' | 'info'

export type IssueType =
  | 'consistency'
  | 'continuity'
  | 'word_count'
  | 'outline_violation'
  | 'outline_deviation'
  | 'draft_failure'
  | 'outline_density'
  | 'outline_foreshadow'
  | 'state_corruption'
  | 'outline_missing'
  | 'outline_gap'
  | 'outline_invalid'
  | 'outline_coverage'
  | 'outline_empty_beats'
  | 'outline_invalid_deadline'
  | 'state_conflict'
  | 'beat_unproven'
  | 'foreshadow_false_fulfillment'
  | 'foreshadow_invalid_deadline'
  | 'foreshadow_boundary_unresolved'
  | 'foreshadow_final_act_introduce'
  | 'foreshadow_equivalence_failed'
  | 'event_missing'
  | 'event_unexpected'
  | 'event_evidence_missing'
  | 'event_evidence_invalid'
  | 'outline_beat_claim'

export type IssueSource =
  | 'word_count'
  | 'foreshadowing'
  | 'consistency'
  | 'outline_compliance'
  | 'quality'
  | 'outline_density'
  | 'state_reconciliation'

export type RetryStrategy = 'draft' | 'fix' | 'manual'

export interface IssueLocationRef {
  paragraphIndex?: number
  sentenceIndex?: number
}

export interface Issue {
  id: string
  /** 稳定的机器规则标识；跨重试轮次不得由自然语言描述派生 */
  ruleId: string
  type: IssueType
  severity: IssueSeverity
  description: string
  subject?: string
  location?: string
  locationRef?: IssueLocationRef
  suggestion?: string
  dimension?: string
  source?: IssueSource
  retryStrategy?: RetryStrategy
  /** 冲突类 issue 的实际值（来自正文/权威事实） */
  actualValue?: string | null
  /** 冲突类 issue 的期望值（来自大纲/规划） */
  expectedValue?: string | null
  /** 冲突类 issue 的属性维度，用于 reconcile UI 展示 */
  conflictAttribute?: string
  /** 原始 aspect（由 consistency agent 等输出），用于判定 issue 分类 */
  aspect?: string
  /** 权威来源引用（canonical fact id / outline 条目 / 章节号），用于判定 error 是否成立 */
  sourceReference?: string
}
