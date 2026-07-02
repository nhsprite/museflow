interface ExtractChineseKeywordsOptions {
  /** Minimum keyword length (in characters). Defaults to 2. */
  minLen?: number
  /** Maximum n-gram length. Only used when `ngrams` is true. Defaults to 4. */
  maxLen?: number
  /**
   * When true, generate sliding n-grams from each Chinese sequence.
   * When false, return the full sequences themselves.
   * Defaults to true.
   */
  ngrams?: boolean
  /** Whether to remove duplicate keywords. Defaults to true. */
  deduplicate?: boolean
}

/**
 * Count Chinese characters plus English words.
 * 中文字符覆盖 CJK 基本区（U+4E00–U+9FFF）与扩展 A 区（U+3400–U+4DBF）。
 */
export function countChineseWords(text: string): number {
  const chineseChars = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) ?? []).length
  const englishWords = (text.match(/[a-zA-Z]+/g) ?? []).length
  return chineseChars + englishWords
}

/**
 * Extract Chinese keywords from text.
 *
 * By default it generates 2-4 character n-grams from each contiguous run of
 * Chinese characters (useful for overlap calculations). Pass `ngrams: false`
 * to return the full runs instead.
 */
export function extractChineseKeywords(
  text: string,
  options: ExtractChineseKeywordsOptions = {},
): string[] {
  const {
    minLen = 2,
    maxLen = 4,
    ngrams = true,
    deduplicate = true,
  } = options

  const sequences = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]{2,}/g) ?? []
  const result: string[] = []

  for (const sequence of sequences) {
    if (!ngrams) {
      if (sequence.length >= minLen) {
        result.push(sequence)
      }
      continue
    }

    const limit = Math.min(sequence.length, maxLen)
    for (let len = minLen; len <= limit; len++) {
      for (let i = 0; i <= sequence.length - len; i++) {
        const word = sequence.slice(i, i + len)
        result.push(word)
      }
    }
  }

  return deduplicate ? Array.from(new Set(result)) : result
}

/**
 * Split text into tokens by whitespace and common Chinese/English punctuation.
 * Filters out tokens shorter than `minLen` (defaults to 2).
 */
export function tokenizeWords(text: string, minLen: number = 2): string[] {
  return text
    .split(/\s+|[，。！？、；：""''「」『』“”‘’\n]/u)
    .map(s => s.trim())
    .filter(s => s.length >= minLen)
}
