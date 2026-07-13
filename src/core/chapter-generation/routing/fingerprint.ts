/**
 * 计算两组指纹字符串的集合相似度（Jaccard-like：交集 / max(集合大小)）。
 */
export function calculateFingerprintSetSimilarity(prev: string[], curr: string[]): number {
  if (prev.length === 0 || curr.length === 0) return 0
  const prevSet = new Set(prev)
  const currSet = new Set(curr)
  let intersection = 0
  for (const fp of currSet) {
    if (prevSet.has(fp)) intersection++
  }
  return intersection / Math.max(prevSet.size, currSet.size)
}
