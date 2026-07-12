export interface SupersededFact {
  subject: string
  oldFact: string
  reason: string
  chapterIndex: number
}

export type CanonicalFactSource =
  'chapter_text' | 'outline_inference' | 'author_override' | 'reconciliation' | 'state_repair'

/**
 * 权威事实的属性类型枚举。
 * 不再使用中文自然语言字符串（如 "所在位置"、"状态"）作为语义标识，
 * 以避免代码中对自然语言文本做语义匹配。
 */
export type FactAttribute =
  | 'location'
  | 'status'
  | 'origin'
  | 'maker'
  | 'giver'
  | 'holder'
  | 'identity'
  | 'known_info'
  | 'promise'
  | 'attitude'
  | 'dialogue'
  | 'decision'
  | 'plan'
  | 'key_event'
  | 'event'
  | 'occurrence'
  | 'result'
  | 'twist'

const FACT_ATTRIBUTE_LABELS: Record<FactAttribute, string> = {
  location: '所在位置',
  status: '状态',
  origin: '来源',
  maker: '制造者',
  giver: '赠予者',
  holder: '持有者',
  identity: '身份',
  known_info: '已知信息',
  promise: '承诺',
  attitude: '态度',
  dialogue: '对话',
  decision: '决定',
  plan: '计划',
  key_event: '关键事件',
  event: '事件',
  occurrence: '发生',
  result: '结果',
  twist: '转折',
}

const LABEL_TO_FACT_ATTRIBUTE: Record<string, FactAttribute> = Object.fromEntries(
  Object.entries(FACT_ATTRIBUTE_LABELS).map(([attr, label]) => [label, attr as FactAttribute])
)

export function labelFromFactAttribute(attr: FactAttribute): string {
  return FACT_ATTRIBUTE_LABELS[attr] ?? attr
}

export function factAttributeFromLabel(label: string): FactAttribute | null {
  const normalized = label.trim()
  if ((FACT_ATTRIBUTE_LABELS as Record<string, string>)[normalized] !== undefined) {
    return normalized as FactAttribute
  }
  return (LABEL_TO_FACT_ATTRIBUTE[normalized] as FactAttribute | undefined) ?? null
}

export interface CanonicalFact {
  id: string
  subject: string
  attribute: FactAttribute
  value: string
  establishedIn: number
  retiredIn?: number | undefined
  confidence: 'high' | 'medium' | 'low'
  source: CanonicalFactSource
  evidence?:
    | {
        chapterIndex: number
        quote: string
      }
    | undefined
  supersedes?:
    | Array<{
        chapter: number
        oldValue: string
      }>
    | undefined
}

export interface PendingTask {
  id: string
  assignee: string
  description: string
  createdChapter: number
  dueChapter?: number | undefined
  dueTime?: string | undefined
  status: 'pending' | 'done' | 'postponed' | 'superseded' | 'expired'
}

export interface ChapterHandoff {
  chapterNumber: number
  endScene: string
  endTime: string
  charactersPresent: string[]
  lastAction: string
  openQuestions: string[]
  requiredNextOpening?: string
}

export interface StoryState {
  characterLocations: Record<string, string>
  characterStatus: Record<string, string>
  keyItemsLocation: Record<string, string>
  keyItemsState: Record<string, string>
  activePlots: string[]
  revealedSecrets: string[]
  pendingTasks: PendingTask[]
  currentScene: string
  storyTime: string
  chapterHandoff?: ChapterHandoff
  supersededFacts?: SupersededFact[]
  canonicalFacts?: CanonicalFact[]
  overrides?: StateOverride[]
}

export interface SanitizationReport {
  state: StoryState
  removedCharacters: string[]
  itemLocationConflicts: Array<{ item: string; locations: string[] }>
  ambiguousItems: Array<{ location: string; items: string[] }>
}

export interface StateOverride {
  id: string
  subject: string
  attribute: FactAttribute
  oldValue: string
  newValue: string
  reason: string
  source: 'outline' | 'author' | 'inferred'
  chapterIndex: number
  createdAt: number
}

export type ConflictType =
  'retcon' | 'extension' | 'time_jump' | 'alias' | 'contradiction' | 'incomplete'

export type ConflictSeverity = 'auto' | 'warning' | 'blocking'

export interface Conflict {
  id: string
  type: ConflictType
  subject: string
  attribute: FactAttribute
  oldValue: string
  newValue: string
  outlineReference: string
  severity: ConflictSeverity
  description: string
}

export interface ReconciliationReport {
  state: StoryState
  conflicts: Conflict[]
  autoResolved: Conflict[]
  requiresAuthorDecision: Conflict[]
  suggestedOverrides: StateOverride[]
}
