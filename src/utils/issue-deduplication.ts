import type { Issue } from '../types/agent.js'
import type { ModelProvider } from '../model/provider.js'
import { batchGenerateIssueFingerprints } from './context-judge.js'

const STOP_WORDS = new Set([
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这', '那', '这些', '那些', '这个', '那个', '这样', '那样', '这里', '那里', '这边', '那边', '这时', '那时', '之后', '之前', '然后', '接着', '后来', '于是', '因此', '所以', '因为', '由于', '虽然', '但是', '然而', '不过', '而且', '并且', '或者', '还是', '要么', '不仅', '不但', '只要', '只有', '无论', '不管', '尽管', '即使', '即便', '除非', '除了', '此外', '另外', '因而', '从而', '总之', '综上所述', '例如', '比如', '譬如', '像是', '好像', '仿佛', '似乎', '大概', '大约', '也许', '可能', '或许', '应该', '应当', '需要', '必须', '一定', '肯定', '当然', '自然', '其实', '实际上', '事实上', '本来', '原来', '原先', '最初', '开始', '最后', '最终', '终于', '结果', '可以', '能够', '得', '地', '过', '把', '被', '让', '给', '向', '往', '从', '自', '由', '将', '跟', '同', '与', '及', '以及', '还有', '既', '又', '还', '再', '才', '便', '即', '则', '却', '可', '但', '而', '因', '为', '以', '于', '对', '关于', '对于', '至于', '鉴于', '根据', '按照', '依照', '遵循', '遵守', '符合', '满足', '达到', '实现', '完成', '结束', '停止', '终止', '中断', '继续', '恢复', '重复', '重新', '再次', '一再', '屡次', '多次', '个', '处', '中', '下', '里', '外', '内', '间', '旁', '边', '前', '后', '左', '右', '东', '西', '南', '北',
])

function normalizeNumberToken(text: string): string {
  return text.replace(/[\d零一二三四五六七八九十百千]+/g, 'N')
}

function extractCanonicalTerms(issue: Issue): string[] {
  const text = `${issue.description ?? ''} ${issue.location ?? ''}`
  const normalized = normalizeNumberToken(text)
  const terms = new Set<string>()

  const quotePatterns = [
    /"([^"]+)"/g,
    /'([^']+)'/g,
    /“([^”]+)”/g,
    /‘([^’]+)’/g,
    /「([^」]+)」/g,
    /『([^』]+)』/g,
  ]

  for (const pattern of quotePatterns) {
    let match
    while ((match = pattern.exec(normalized)) !== null) {
      const cleaned = match[1]?.trim()
      if (cleaned && cleaned.length >= 2) terms.add(cleaned)
    }
  }

  const sequences = normalized.match(/[\u4e00-\u9fff]+/g) ?? []
  for (const seq of sequences) {
    for (let len = Math.min(6, seq.length); len >= 2; len--) {
      for (let i = 0; i <= seq.length - len; i++) {
        const substr = seq.slice(i, i + len)
        if (STOP_WORDS.has(substr)) continue
        const first = substr[0] ?? ''
        const last = substr[substr.length - 1] ?? ''
        if (STOP_WORDS.has(first) || STOP_WORDS.has(last)) continue
        terms.add(substr)
      }
    }
  }

  return Array.from(terms).sort()
}

export function ruleBasedFingerprint(issue: Issue): string {
  const terms = extractCanonicalTerms(issue)
  const typeKeyword = issue.type.slice(0, 3)
  if (terms.length === 0) {
    return `${typeKeyword}:${normalizeNumberToken(issue.description ?? '').slice(0, 40)}`
  }
  return `${typeKeyword}:${terms.join('|')}`
}

export async function issueFingerprint(
  provider: ModelProvider | undefined,
  issue: Issue
): Promise<string> {
  if (!provider) {
    return ruleBasedFingerprint(issue)
  }
  try {
    const results = await batchGenerateIssueFingerprints(provider, [issue])
    const fp = results[0] ?? ruleBasedFingerprint(issue)
    return `${issue.type}:${fp}`
  } catch {
    return ruleBasedFingerprint(issue)
  }
}

export async function deduplicateIssuesSemantically(
  provider: ModelProvider | undefined,
  issues: Issue[]
): Promise<Issue[]> {
  if (issues.length === 0) {
    return []
  }
  if (!provider) {
    return deduplicateByRule(issues)
  }

  try {
    const fingerprints = await batchGenerateIssueFingerprints(provider, issues)
    const seen = new Map<string, Issue>()
    const result: Issue[] = []
    for (let i = 0; i < issues.length; i++) {
      const issue = issues[i]!
      const fp = fingerprints[i] ?? ruleBasedFingerprint(issue)
      const key = `${issue.type}:${fp}`
      if (!seen.has(key)) {
        seen.set(key, issue)
        result.push(issue)
      }
    }
    return result
  } catch {
    return deduplicateByRule(issues)
  }
}

function deduplicateByRule(issues: Issue[]): Issue[] {
  const seen = new Map<string, Issue>()
  const result: Issue[] = []
  for (const issue of issues) {
    const key = ruleBasedFingerprint(issue)
    if (!seen.has(key)) {
      seen.set(key, issue)
      result.push(issue)
    }
  }
  return result
}
