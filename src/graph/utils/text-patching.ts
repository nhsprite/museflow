export interface LocationInfo {
  paragraphIndex?: number
  sentenceIndex?: number
}

export function splitIntoParagraphs(text: string): string[] {
  return text.split(/\n\n+/).filter(p => p.trim().length > 0)
}

export function extractLocationInfo(issue: { description: string; location?: string }): LocationInfo[] {
  const locations: LocationInfo[] = []
  const text = issue.description + ' ' + (issue.location || '')

  const paragraphPatterns = [
    /第\s*(\d+)\s*段/g,
    /第\s*([一二三四五六七八九十百]+)\s*段/g,
    /段落?\s*(\d+)/g,
  ]

  for (const pattern of paragraphPatterns) {
    let match
    while ((match = pattern.exec(text)) !== null) {
      const group = match[1]
      if (!group) continue
      const num = parseLocationNumber(group)
      if (num !== null) {
        locations.push({ paragraphIndex: num - 1 })
      }
    }
  }

  const sentencePatterns = [
    /第\s*(\d+)\s*句/g,
    /第\s*([一二三四五六七八九十百]+)\s*句/g,
  ]

  for (const pattern of sentencePatterns) {
    let match
    while ((match = pattern.exec(text)) !== null) {
      const group = match[1]
      if (!group) continue
      const num = parseLocationNumber(group)
      if (num !== null) {
        locations.push({ sentenceIndex: num - 1 })
      }
    }
  }

  return locations
}

function parseLocationNumber(str: string): number | null {
  const num = parseInt(str, 10)
  if (!isNaN(num)) return num

  const chineseMap: Record<string, number> = {
    '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
    '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
  }

  let result = 0
  for (const char of str) {
    const val = chineseMap[char]
    if (val === undefined) return null
    result = result * 10 + val
  }
  return result > 0 ? result : null
}

const STOP_WORDS = new Set([
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这', '那', '这些', '那些', '这个', '那个', '这样', '那样', '这里', '那里', '这边', '那边', '这时', '那时', '之后', '之前', '然后', '接着', '后来', '于是', '因此', '所以', '因为', '由于', '虽然', '但是', '然而', '不过', '而且', '并且', '或者', '还是', '要么', '不仅', '不但', '只要', '只有', '无论', '不管', '尽管', '即使', '即便', '除非', '除了', '此外', '另外', '而且', '并且', '然后', '接着', '后来', '于是', '因此', '因而', '从而', '总之', '综上所述', '例如', '比如', '譬如', '像是', '好像', '仿佛', '似乎', '大概', '大约', '也许', '可能', '或许', '应该', '应当', '需要', '必须', '一定', '肯定', '当然', '自然', '其实', '实际上', '事实上', '本来', '原来', '原先', '最初', '开始', '最后', '最终', '终于', '结果', '可以', '能够', '可能', '应该', '得', '地', '着', '过', '把', '被', '让', '给', '向', '往', '从', '自', '由', '把', '将', '把', '被', '让', '给', '跟', '同', '与', '及', '以及', '还有', '或者', '还是', '既', '又', '也', '还', '再', '才', '就', '便', '即', '则', '却', '可', '但', '而', '因', '为', '以', '于', '对', '关于', '对于', '至于', '鉴于', '根据', '按照', '依照', '遵循', '遵守', '符合', '满足', '达到', '实现', '完成', '结束', '停止', '终止', '中断', '继续', '恢复', '重复', '重新', '再次', '一再', '屡次', '多次',
])

export function extractIssueKeywords(issue: { description: string; location?: string }): string[] {
  const keywords: string[] = []

  const text = issue.description + ' ' + (issue.location || '')

  const quotes = text.match(/"([^"]+)"/g)
  if (quotes) {
    keywords.push(...quotes.map(q => q.slice(1, -1)))
  }

  const chineseSequences = text.match(/[\u4e00-\u9fff]+/g)
  if (chineseSequences) {
    for (const sequence of chineseSequences) {
      const maxLen = Math.min(6, sequence.length)
      for (let len = 2; len <= maxLen; len++) {
        for (let i = 0; i <= sequence.length - len; i++) {
          const substr = sequence.slice(i, i + len)
          if (substr.length >= 2 && !STOP_WORDS.has(substr)) {
            keywords.push(substr)
          }
        }
      }
    }
  }

  const unique = [...new Set(keywords)]
  return unique.slice(0, 35)
}

export function findAffectedParagraphs(paragraphs: string[], issues: Array<{ description: string; location?: string }>): number[] {
  const affected = new Set<number>()

  for (const issue of issues) {
    const locations = extractLocationInfo(issue)
    const hasExplicitLocation = locations.some(l => l.paragraphIndex !== undefined)

    if (hasExplicitLocation) {
      for (const loc of locations) {
        if (loc.paragraphIndex !== undefined && loc.paragraphIndex >= 0 && loc.paragraphIndex < paragraphs.length) {
          affected.add(loc.paragraphIndex)
        }
      }
      continue
    }

    const keywords = extractIssueKeywords(issue)
    if (keywords.length === 0) continue

    for (let i = 0; i < paragraphs.length; i++) {
      const paragraph = paragraphs[i]
      if (paragraph && keywords.some(kw => paragraph.includes(kw))) {
        affected.add(i)
      }
    }
  }

  return Array.from(affected).sort((a, b) => a - b)
}

export function splitParagraphIntoSentences(paragraph: string): string[] {
  const matches = [...paragraph.matchAll(/[^。！？\n]+[。！？\n]?/g)]
  if (matches.length === 0) return [paragraph]
  return matches.map(m => m[0]).filter(s => s.trim().length > 0)
}

export function findAffectedSentences(paragraph: string, issue: { description: string; location?: string }): number[] {
  const sentences = splitParagraphIntoSentences(paragraph)
  const affected = new Set<number>()

  const locations = extractLocationInfo(issue)
  const hasSentenceLocation = locations.some(l => l.sentenceIndex !== undefined)

  if (hasSentenceLocation) {
    for (const loc of locations) {
      if (loc.sentenceIndex !== undefined && loc.sentenceIndex >= 0 && loc.sentenceIndex < sentences.length) {
        affected.add(loc.sentenceIndex)
      }
    }
    return Array.from(affected).sort((a, b) => a - b)
  }

  const keywords = extractIssueKeywords(issue)
  if (keywords.length === 0) return []

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i]
    if (sentence && keywords.some(kw => sentence.includes(kw))) {
      affected.add(i)
    }
  }

  return Array.from(affected).sort((a, b) => a - b)
}

export function mergeSentenceFixes(
  originalParagraph: string,
  modifiedSentences: Array<{ index: number; content: string }>
): string {
  const sentences = splitParagraphIntoSentences(originalParagraph)
  const modifiedMap = new Map(modifiedSentences.map(s => [s.index, s.content]))

  const result = sentences.map((s, i) => modifiedMap.has(i) ? modifiedMap.get(i)! : s)
  return result.join('')
}

export function mergeParagraphFixes(
  originalParagraphs: string[],
  modifiedParagraphs: Array<{ index: number; content: string }>,
  affectedIndices: number[]
): string {
  const result = [...originalParagraphs]
  const modifiedMap = new Map(modifiedParagraphs.map(p => [p.index, p.content]))

  for (const idx of affectedIndices) {
    if (modifiedMap.has(idx)) {
      result[idx] = modifiedMap.get(idx)!
    }
  }

  return result.join('\n\n')
}

export function applyParagraphDiffProtection(
  original: string,
  fixed: string,
  allowedIndices: number[]
): string {
  const originalParagraphs = splitIntoParagraphs(original)
  const fixedParagraphs = splitIntoParagraphs(fixed)

  if (originalParagraphs.length !== fixedParagraphs.length) {
    console.warn('[MuseFlow] 修复后段落数量变化，跳过段落保护')
    return fixed
  }

  const allowedSet = new Set(allowedIndices)
  let revertedCount = 0
  const result: string[] = []

  for (let i = 0; i < originalParagraphs.length; i++) {
    const originalParagraph = originalParagraphs[i]
    const fixedParagraph = fixedParagraphs[i]
    if (!originalParagraph || !fixedParagraph) {
      continue
    }
    if (!allowedSet.has(i) && originalParagraph !== fixedParagraph) {
      console.log(`[MuseFlow] 检测到无关段落 ${i} 被修改，已自动回退`)
      result.push(originalParagraph)
      revertedCount++
    } else {
      result.push(fixedParagraph)
    }
  }

  if (revertedCount > 0) {
    console.log(`[MuseFlow] 共回退 ${revertedCount} 个无关段落的修改`)
  }

  return result.join('\n\n')
}

export function deduplicateSentences(text: string): string {
  const MIN_SENTENCE_LENGTH = 10
  const SENTENCE_PATTERN = /[^。？！\n]+[。？！\n]/g

  const matches = [...text.matchAll(SENTENCE_PATTERN)]
  if (matches.length === 0) return text

  const seen = new Set<string>()
  let removedCount = 0
  const rebuilt: string[] = []
  let pos = 0

  for (const match of matches) {
    rebuilt.push(text.slice(pos, match.index))
    const sentence = match[0]
    const trimmed = sentence.trim()

    const isDuplicate = trimmed.length >= MIN_SENTENCE_LENGTH && seen.has(trimmed)
    if (isDuplicate) {
      removedCount++
    } else {
      seen.add(trimmed)
      rebuilt.push(sentence)
    }

    pos = (match.index ?? 0) + sentence.length
  }
  rebuilt.push(text.slice(pos))

  const finalText = rebuilt.join('')
  if (removedCount > 0) {
    console.log(`[MuseFlow] 自动清理 ${removedCount} 个重复句子`)
  }
  return finalText
}

export function deduplicateParagraphBlocks(text: string): string {
  const paragraphs = splitIntoParagraphs(text)
  if (paragraphs.length < 2) return text

  const BLOCK_MIN_CHARS = 30
  const seenBlocks = new Set<string>()
  const result: string[] = []
  let removedCount = 0

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim()
    if (trimmed.length < BLOCK_MIN_CHARS) {
      result.push(paragraph)
      continue
    }

    const normalized = trimmed.replace(/\s+/g, '')
    if (seenBlocks.has(normalized)) {
      removedCount++
      continue
    }
    seenBlocks.add(normalized)
    result.push(paragraph)
  }

  if (removedCount > 0) {
    console.log(`[MuseFlow] 自动清理 ${removedCount} 个重复段落`)
  }
  return result.join('\n\n')
}

export function countChineseWords(text: string): number {
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) ?? []).length
  const englishWords = (text.match(/[a-zA-Z]+/g) ?? []).length
  return chineseChars + englishWords
}
