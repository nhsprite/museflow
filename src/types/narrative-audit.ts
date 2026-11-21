export type NarrativeAuditMode = 'off' | 'report' | 'enforce'

export interface ProseFact {
  kind: 'lifecycle' | 'identity' | 'custody' | 'time' | 'history'
  entityId: string | null
  /** 正文明示的具名实体名称；泛称、职业、代词填 null，不据此编造 ID。 */
  entityName: string | null
  attribute: string
  value: string | boolean | null
  scope: 'current' | 'recollection' | 'uncertain'
  evidenceParagraphs: number[]
}

export interface NarrativeEvidence {
  chapterIndex: number
  /** 与 STORY_EVENTS 相同的零基段落索引。 */
  paragraphIndex: number
}

export interface NarrativeFinding {
  kind: 'omission' | 'unsupported_record' | 'contradiction' | 'prose_artifact'
  factIndexes: number[]
  recordIndexes: number[]
  evidence: NarrativeEvidence[]
  confidence: 'high' | 'medium' | 'low'
  explanation: string
  repairTarget: 'current_prose' | 'current_records' | 'manual_review'
  suggestion: string
  contradictionReview?: ContradictionReview
}

export interface FactCoverage {
  factIndex: number
  verdict: 'recorded' | 'unchanged' | 'missing' | 'not_recordable' | 'uncertain'
  recordIndexes: number[]
  confidence: 'high' | 'medium' | 'low'
  explanation: string
}

export interface NarrativeChapterAssessment {
  chapterIndex: number
  verdict: 'advancing' | 'transition' | 'stalled' | 'uncertain'
  dimensions: Array<'goal' | 'information' | 'decision' | 'relationship' | 'consequence'>
  evidenceParagraphs: number[]
  explanation: string
}

export interface NarrativeAuditRecord {
  kind: 'event' | 'declaration' | 'canonical_fact' | 'entity' | 'story_time'
  /** 本章自报记录与既有事实分开，审计不可要求修改既有事实来迁就草稿。 */
  origin: 'current' | 'established'
  value: unknown
}

/** 模型审计的证据快照，不直接作为 StoryMemory 事件或 canonical facts 写入。 */
export interface NarrativeAuditReport {
  protocolVersion: 3
  mode: Exclude<NarrativeAuditMode, 'off'>
  chapterIndex: number
  contentHash: string
  recordsHash: string
  records: NarrativeAuditRecord[]
  window: Array<{ chapterIndex: number; contentHash: string }>
  facts: ProseFact[]
  coverage: FactCoverage[]
  findings: NarrativeFinding[]
  progress: NarrativeChapterAssessment[]
}

export const CONTRADICTION_CHECKS = [
  'sameSubject',
  'sameAttribute',
  'comparableTime',
  'establishedPremise',
  'incompatibleClaims',
  'resolutionAbsent',
] as const

export interface ContradictionReview {
  initialConfidence: NarrativeFinding['confidence']
  checks: Record<(typeof CONTRADICTION_CHECKS)[number], 'yes' | 'no' | 'uncertain'>
  verdict: 'confirmed' | 'rejected' | 'uncertain'
  evidence: NarrativeEvidence[]
  recordIndexes: number[]
  explanation: string
}
