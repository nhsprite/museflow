const WRAPPER_PAIRS: Array<[string, string]> = [
  ['《', '》'],
  ['〈', '〉'],
  ['「', '」'],
  ['『', '』'],
  ['【', '】'],
  ['（', '）'],
  ['[', ']'],
  ['{', '}'],
]

/**
 * 规范化物品名。
 *
 * 仅去除完整包裹整个名称的装饰性定界符与多余空白。
 * 名称内部的括号限定语会保留，避免把原件、副本、残片等不同对象误合并。
 */
export function canonicalizeItemName(name: string): string {
  let normalized = name.replace(/\s+/g, ' ').trim()
  let changed = true
  while (changed) {
    changed = false
    for (const [open, close] of WRAPPER_PAIRS) {
      if (normalized.startsWith(open) && normalized.endsWith(close) && normalized.length > open.length + close.length) {
        normalized = normalized.slice(open.length, normalized.length - close.length).trim()
        changed = true
        break
      }
    }
  }

  return normalized
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
