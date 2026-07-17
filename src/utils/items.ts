export interface MergeItemRecordsExactOptions {
  /** Values that should be treated as "no-op" and ignored. */
  ignoreValue?: string
}

/**
 * Merge structured item records by exact EntityId.
 *
 * Item references are machine identities. Display punctuation, whitespace, and
 * wrapper characters must never cause two distinct keys to be grouped.
 */
export function mergeItemRecordsExact(
  base: Record<string, string>,
  delta: Record<string, string>,
  options: MergeItemRecordsExactOptions = {}
): Record<string, string> {
  const result = { ...base }
  for (const [entityId, value] of Object.entries(delta)) {
    if (!value || value === options.ignoreValue) continue
    result[entityId] = value
  }
  return result
}
