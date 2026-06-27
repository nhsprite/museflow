export const DEFAULT_UNIT_WORDS = [
  '一个', '一件', '一本', '一张', '一封', '一份', '一把',
  '这个', '那个', '这件', '那件', '这张', '那张', '这封', '那封', '这份', '那份',
  '这块', '那块',
]

const DESCRIPTIVE_SUFFIXES = /[（(][^）)]*[）)]/g

export function canonicalizeItemName(name: string, customUnitWords?: string[]): string {
  let normalized = name
    .replace(DESCRIPTIVE_SUFFIXES, '')
    .replace(/^[《〈「『【（\u005b\u007b\s]+|[》〉」』】）\u005d\u007d\s]+$/g, '')
    .trim()

  const unitWords = customUnitWords ?? DEFAULT_UNIT_WORDS
  for (const unit of unitWords) {
    if (normalized.startsWith(unit)) {
      normalized = normalized.slice(unit.length).trim()
    }
  }

  return normalized.replace(/\s+/g, ' ').trim()
}

export interface CanonicalEntry<T = string> {
  item: string
  value: T
}

export interface MergeCanonicalRecordsOptions {
  /** Values that should be treated as "no-op" and ignored. */
  ignoreValue?: string
}

/**
 * Merge two string records while deduplicating by canonical item name.
 * Later entries win. Empty values and the configured `ignoreValue` are skipped.
 */
export function mergeCanonicalRecords(
  base: Record<string, string>,
  delta: Record<string, string>,
  options: MergeCanonicalRecordsOptions = {},
): Record<string, string> {
  const merged: Record<string, string> = { ...base }
  for (const [item, value] of Object.entries(delta)) {
    if (!value || value === options.ignoreValue) continue
    merged[item] = value
  }

  const result: Record<string, string> = {}
  const seenCanonical = new Set<string>()
  const entries = Object.entries(merged)

  for (let i = entries.length - 1; i >= 0; i--) {
    const [item, value] = entries[i]!
    if (!value || value === options.ignoreValue) continue
    const canonical = canonicalizeItemName(item)
    if (canonical.length === 0) continue
    if (seenCanonical.has(canonical)) continue
    seenCanonical.add(canonical)
    result[item] = value
  }

  return result
}

/**
 * Pick the authoritative entry from a group of entries sharing the same
 * canonical item name. Assumes `entries` are in insertion order; the last
 * entry is treated as the winner.
 */
export function resolveCanonicalItemGroup<T>(
  entries: Array<CanonicalEntry<T>>,
): { winner: CanonicalEntry<T>; superseded: Array<CanonicalEntry<T>> } {
  const reversed = [...entries].reverse()
  const [winner, ...superseded] = reversed
  return { winner: winner!, superseded }
}
