import type { StoryState, Conflict } from '../../types/story-state.js'
import { canonicalizeItemName } from '../../utils/items.js'
import { tokenizeWords } from '../../utils/text.js'

const STOP_CHARS = '。！？；'

const QUOTE_PAIRS: Array<[string, string]> = [
  ['「', '」'],
  ['『', '』'],
  ['“', '”'],
  ['‘', '’'],
  ['"', '"'],
  ["'", "'"],
  ['【', '】'],
  ['《', '》'],
  ['〈', '〉'],
]

const LOCATION_SUFFIXES = /^(?:在|于|往|向|至|到)|(?:里|内|中|上|下|边|旁|侧|头|面|外|前|后|左|右|东|西|南|北)$/g

const MEMORY_MARKERS = /(?:回忆|回想|想起|梦见|梦到过|忆及|追忆|忆起|昔日在|曾经在|过去在|当年在|往昔|昔日|从前|当年|过去)/
const CONDITIONAL_MARKERS = /(?:如果|假如|倘若|要是|万一|假设|设想|若|似乎|好像|仿佛|宛如|如同|恰似|犹如|像是|假若)/
const NEGATION_MARKERS = /(?:并非|不是|没有|不曾|未|无|不|没|勿|别|毋|弗|否|莫|休)/

function generateConflictId(subject: string, attribute: string, index: number): string {
  return `${subject}:${attribute}:${index}`
}

function escapeRegExp(subject: string): string {
  return subject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？；])/u)
    .map(s => s.trim())
    .filter(Boolean)
}

function removeQuotedContent(sentence: string): string {
  let result = sentence
  for (const [open, close] of QUOTE_PAIRS) {
    const pattern = new RegExp(
      `${escapeRegExp(open)}[^${escapeRegExp(close)}]*${escapeRegExp(close)}`,
      'gu'
    )
    result = result.replace(pattern, '')
  }
  return result
}

function isMemoryContext(sentence: string): boolean {
  return MEMORY_MARKERS.test(sentence)
}

function isConditionalContext(sentence: string): boolean {
  return CONDITIONAL_MARKERS.test(sentence)
}

function isNegatedContext(sentence: string, matchStart: number): boolean {
  const clauseStart = Math.max(0, sentence.lastIndexOf('，', matchStart - 1) + 1)
  const clause = sentence.slice(clauseStart, matchStart)
  return NEGATION_MARKERS.test(clause)
}

function cleanLocation(rawValue: string): string {
  const cleaned = rawValue.replace(LOCATION_SUFFIXES, '').trim()
  return cleaned.length > 0 ? cleaned : rawValue.trim()
}

function buildLocationPatterns(subject: string): RegExp[] {
  const escaped = escapeRegExp(subject)
  return [
    // 被动位移：主体 … 被/遭/受 … 到/至/往/向/于/在/进/入 + 地点
    new RegExp(
      `${escaped}[^${STOP_CHARS}]{0,25}?(?:被|遭|受)[^${STOP_CHARS}]{0,15}?(?:到|至|往|向|于|在|进|入)([^${STOP_CHARS}]{2,20})`,
      'u'
    ),
    // 主动位移：主体 … 到/至/往/向/去/进/入 + 地点
    new RegExp(
      `${escaped}[^${STOP_CHARS}]{0,25}?(?:到|至|往|向|去|进|入)([^${STOP_CHARS}]{2,20})`,
      'u'
    ),
    // 静态位置：主体 … 在/于 + 地点
    new RegExp(
      `${escaped}[^${STOP_CHARS}]{0,15}?(?:在|于)([^${STOP_CHARS}]{2,20})`,
      'u'
    ),
  ]
}

function extractLocationForSubject(sentence: string, subject: string): { value: string; index: number } | null {
  for (const pattern of buildLocationPatterns(subject)) {
    const match = sentence.match(pattern)
    if (match?.[1]) {
      const rawValue = match[1].trim()
      const valueStartIndex = (match.index ?? 0) + match[0].indexOf(rawValue)
      return {
        value: cleanLocation(rawValue),
        index: valueStartIndex,
      }
    }
  }
  return null
}

function buildStatePatterns(subject: string): RegExp[] {
  const escaped = escapeRegExp(subject)
  return [
    // 被动/结果状态：主体 … 被/遭/受 + 状态
    new RegExp(
      `${escaped}[^${STOP_CHARS}]{0,20}?(?:被|遭|受)([^${STOP_CHARS}]{1,12})`,
      'u'
    ),
    // 已然变化：主体 … 已/已经/变得/成为/成了/不再 + 状态
    new RegExp(
      `${escaped}[^${STOP_CHARS}]{0,15}?(?:已|已经|变得|成为|成了|不再)([^${STOP_CHARS}]{1,12})`,
      'u'
    ),
    // 持续状态：主体 … 仍/仍然/依然/依旧/还是/保持 + 状态
    new RegExp(
      `${escaped}[^${STOP_CHARS}]{0,15}?(?:仍|仍然|依然|依旧|还是|保持)([^${STOP_CHARS}]{1,12})`,
      'u'
    ),
  ]
}

function normalizeState(rawValue: string): string {
  return rawValue
    .replace(/^(?:是|为|处于|处在|陷入|身负|身受|变得|成为|成了|保持|已经|已|不再)/u, '')
    .replace(/(?:了|着|过|掉|尽|光|完)$/u, '')
    .trim()
}

const DESTINATION_PARTICLES_CLASS = '[到至往向去进出入]'

function looksLikeMovement(rawValue: string, suffix: string): boolean {
  // 如果状态值本身或紧随其后的字符包含位移助词，说明是地点转移而非状态改变
  return (
    new RegExp(DESTINATION_PARTICLES_CLASS, 'u').test(rawValue) ||
    /^(?:到|至|往|向|去|进|入)/u.test(suffix)
  )
}

function extractStateForSubject(sentence: string, subject: string): { value: string; index: number } | null {
  // 若同一句已描述地点变化，优先按地点处理，避免把移动动作误判为状态
  if (extractLocationForSubject(sentence, subject) !== null) return null

  for (const pattern of buildStatePatterns(subject)) {
    const match = sentence.match(pattern)
    if (match?.[1]) {
      const rawValue = match[1].trim()
      const valueStartIndex = (match.index ?? 0) + match[0].indexOf(rawValue)
      const valueEndIndex = valueStartIndex + rawValue.length
      const suffix = sentence.slice(valueEndIndex, valueEndIndex + 2)

      // 状态值本身或紧随其后的字符包含位移助词，说明是地点转移而非状态改变
      if (looksLikeMovement(rawValue, suffix)) continue

      const normalized = normalizeState(rawValue)
      return {
        value: normalized.length > 0 ? normalized : rawValue,
        index: valueStartIndex,
      }
    }
  }
  return null
}

function isMentionedInSentence(sentence: string, subject: string): boolean {
  return sentence.includes(subject) || sentence.includes(canonicalizeItemName(subject))
}

function createConflict(
  subject: string,
  attribute: string,
  oldValue: string,
  newValue: string,
  outlineReference: string,
  index: number,
  severity: 'auto' | 'warning' | 'blocking' = 'auto'
): Conflict {
  return {
    id: generateConflictId(subject, attribute, index),
    type: 'retcon',
    subject,
    attribute,
    oldValue,
    newValue,
    outlineReference,
    severity,
    description:
      attribute === '所在位置'
        ? `大纲将「${subject}」的位置从「${oldValue}」更新为「${newValue}」`
        : `大纲将「${subject}」的状态从「${oldValue}」更新为「${newValue}」`,
  }
}

function detectEntityConflicts<T extends Record<string, string>>(
  entities: T,
  outline: string,
  attribute: string,
  severity: 'auto' | 'warning',
  extractor: (sentence: string, subject: string) => { value: string; index: number } | null,
  mentionFilter?: (sentence: string, subject: string) => boolean
): Conflict[] {
  const conflicts: Conflict[] = []
  let index = 0
  const sentences = splitSentences(outline)

  for (const [subject, currentValue] of Object.entries(entities)) {
    for (const sentence of sentences) {
      const isMentioned = mentionFilter
        ? mentionFilter(sentence, subject)
        : sentence.includes(subject)
      if (!isMentioned) continue
      if (isMemoryContext(sentence) || isConditionalContext(sentence)) continue

      const cleanSentence = removeQuotedContent(sentence)
      const result = extractor(cleanSentence, subject)
      if (!result || result.value === currentValue) continue
      if (isNegatedContext(cleanSentence, result.index)) continue

      conflicts.push(
        createConflict(subject, attribute, currentValue, result.value, sentence, index++, severity)
      )
    }
  }

  return conflicts
}

export function detectItemLocationConflicts(state: StoryState, outline: string): Conflict[] {
  return detectEntityConflicts(
    state.keyItemsLocation,
    outline,
    '所在位置',
    'auto',
    extractLocationForSubject,
    isMentionedInSentence
  )
}

export function detectItemStateConflicts(state: StoryState, outline: string): Conflict[] {
  return detectEntityConflicts(
    state.keyItemsState,
    outline,
    '状态',
    'auto',
    extractStateForSubject,
    isMentionedInSentence
  )
}

export function detectCharacterLocationConflicts(state: StoryState, outline: string): Conflict[] {
  return detectEntityConflicts(
    state.characterLocations,
    outline,
    '所在位置',
    'auto',
    extractLocationForSubject
  )
}

export function detectCharacterStatusConflicts(state: StoryState, outline: string): Conflict[] {
  return detectEntityConflicts(
    state.characterStatus,
    outline,
    '状态',
    'warning',
    extractStateForSubject
  )
}

export function detectSecretRevealConflicts(state: StoryState, outline: string): Conflict[] {
  const conflicts: Conflict[] = []
  const outlineTokens = tokenizeWords(outline)
  let index = 0

  for (const secret of state.revealedSecrets) {
    const secretSentences = splitSentences(secret)
    let maxOverlapRatio = 0
    for (const secretSentence of secretSentences) {
      const secretTokens = tokenizeWords(secretSentence)
      const overlap = secretTokens.filter(t => outlineTokens.includes(t))
      const overlapRatio = secretTokens.length > 0 ? overlap.length / secretTokens.length : 0
      maxOverlapRatio = Math.max(maxOverlapRatio, overlapRatio)
    }
    if (maxOverlapRatio < 0.3) continue

    const hintIndex = outline.indexOf(secret.slice(0, 20))
    const outlineReference =
      hintIndex >= 0
        ? outline.slice(Math.max(0, hintIndex - 30), hintIndex + secret.length + 30)
        : outline.slice(0, 100)

    conflicts.push({
      id: generateConflictId('secret', '已揭示', index++),
      type: 'contradiction',
      subject: '已揭示秘密',
      attribute: '重复揭示',
      oldValue: secret.slice(0, 80),
      newValue: outlineReference.slice(0, 80),
      outlineReference,
      severity: 'blocking',
      description: `大纲试图再次揭示此前已暴露的秘密：「${secret.slice(0, 50)}...」`,
    })
  }
  return conflicts
}

export function detectTimeAnchorConflicts(
  state: StoryState,
  outline: string,
  chapterIndex: number
): Conflict[] {
  const conflicts: Conflict[] = []
  if (!state.storyTime || chapterIndex <= 0) {
    return conflicts
  }

  // 通用相对时间推进：数量/数字 + 时间单位 + 后；或常用相对时间副词
  const timeJumpPattern =
    /(?:[一二两三四五六七八九十百千万\d]+|[数几若干半]+)(?:日|天|月|年|时辰|刻|更|周|礼拜|小时|分钟)(?:后|之后|过后|以后)|(?:次日|翌日|明天|后天|隔日|翌年|明年|后年)/u

  if (timeJumpPattern.test(outline)) {
    conflicts.push({
      id: `time-jump:${chapterIndex}`,
      type: 'time_jump',
      subject: '叙事时间',
      attribute: '推进',
      oldValue: state.storyTime,
      newValue: '大纲明确时间推进',
      outlineReference: outline.slice(0, 200),
      severity: 'auto',
      description: `大纲明确出现时间推进词，本章时间锚点应相应调整`,
    })
  }
  return conflicts
}

export function detectAllConflicts(
  state: StoryState,
  outline: string,
  chapterIndex: number
): Conflict[] {
  return [
    ...detectItemLocationConflicts(state, outline),
    ...detectItemStateConflicts(state, outline),
    ...detectCharacterLocationConflicts(state, outline),
    ...detectCharacterStatusConflicts(state, outline),
    ...detectSecretRevealConflicts(state, outline),
    ...detectTimeAnchorConflicts(state, outline, chapterIndex),
  ]
}
