function extractKeywords(text: string): string[] {
  const matches = text.match(/[\u4e00-\u9fff]{2,}/g)
  return matches ? matches.filter(kw => kw.length >= 2) : []
}

export function calculateKeywordOverlap(text1: string, text2: string): number {
  const keywords1 = new Set(extractKeywords(text1))
  const keywords2 = new Set(extractKeywords(text2))

  if (keywords1.size === 0 || keywords2.size === 0) {
    return text1 === text2 ? 1 : 0
  }

  let common = 0
  for (const kw of keywords1) {
    if (keywords2.has(kw)) {
      common++
    }
  }

  return common / Math.max(keywords1.size, keywords2.size)
}

export function isSemanticallyRelated(
  text1: string,
  text2: string,
  overlapThreshold: number = 0.4
): boolean {
  if (text1 === text2) return true

  if (text1.includes(text2) || text2.includes(text1)) return true

  const overlap = calculateKeywordOverlap(text1, text2)
  return overlap >= overlapThreshold
}
