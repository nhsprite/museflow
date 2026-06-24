import type { Issue } from '../types/agent.js'

const STOP_WORDS = new Set([
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这', '那', '这些', '那些', '这个', '那个', '这样', '那样', '这里', '那里', '这边', '那边', '这时', '那时', '之后', '之前', '然后', '接着', '后来', '于是', '因此', '所以', '因为', '由于', '虽然', '但是', '然而', '不过', '而且', '并且', '或者', '还是', '要么', '不仅', '不但', '只要', '只有', '无论', '不管', '尽管', '即使', '即便', '除非', '除了', '此外', '另外', '因而', '从而', '总之', '综上所述', '例如', '比如', '譬如', '像是', '好像', '仿佛', '似乎', '大概', '大约', '也许', '可能', '或许', '应该', '应当', '需要', '必须', '一定', '肯定', '当然', '自然', '其实', '实际上', '事实上', '本来', '原来', '原先', '最初', '开始', '最后', '最终', '终于', '结果', '可以', '能够', '得', '地', '过', '把', '被', '让', '给', '向', '往', '从', '自', '由', '将', '跟', '同', '与', '及', '以及', '还有', '既', '又', '也', '还', '再', '才', '便', '即', '则', '却', '可', '但', '而', '因', '为', '以', '于', '对', '关于', '对于', '至于', '鉴于', '根据', '按照', '依照', '遵循', '遵守', '符合', '满足', '达到', '实现', '完成', '结束', '停止', '终止', '中断', '继续', '恢复', '重复', '重新', '再次', '一再', '屡次', '多次',
])

const REPORTING_WORDS = new Set(['称', '出现', '提到', '指出', '写道', '写到', '表明', '表示'])
const RELATIONSHIP_WORDS = new Set(['兄', '弟', '姐', '妹', '父', '母', '子', '女', '夫', '妻', '友', '师', '徒', '生', '仆', '主', '君', '臣', '亲', '戚', '族'])

function stripContextPrefix(text: string): string {
  let cutIndex = -1
  for (const word of REPORTING_WORDS) {
    const idx = text.indexOf(word)
    if (idx !== -1 && (cutIndex === -1 || idx < cutIndex)) {
      cutIndex = idx
    }
  }
  if (cutIndex === -1) return text
  const remainder = text.slice(cutIndex + 1)
  const hasRelationship = [...RELATIONSHIP_WORDS].some(w => remainder.includes(w))
  const hasQuote = /["'"'""']/.test(remainder)
  if (hasRelationship || hasQuote) return remainder
  return text
}

function extractCanonicalTerms(issue: Issue): string[] {
  let text = `${issue.description ?? ''} ${issue.location ?? ''}`
  text = stripContextPrefix(text)
  const terms = new Set<string>()

  const quoted = text.match(/["'"'""']([^"'"'""']+)["'"'""']/g)
  if (quoted) {
    for (const q of quoted) {
      const cleaned = q.slice(1, -1).trim()
      if (cleaned.length >= 2) terms.add(cleaned)
    }
  }

  const sortedStopWords = [...STOP_WORDS].sort((a, b) => b.length - a.length)
  let normalized = text
  for (const word of sortedStopWords) {
    normalized = normalized.replaceAll(word, '')
  }

  const sequences = normalized.match(/[\u4e00-\u9fff]+/g) ?? []
  for (const seq of sequences) {
    for (let len = Math.min(6, seq.length); len >= 2; len--) {
      for (let i = 0; i <= seq.length - len; i++) {
        const substr = seq.slice(i, i + len)
        terms.add(substr)
      }
    }
  }

  return [...terms].sort()
}

export function issueFingerprint(issue: Issue): string {
  const terms = extractCanonicalTerms(issue)
  return `${issue.type}:${terms.join('|')}`
}

export function deduplicateIssuesSemantically(issues: Issue[]): Issue[] {
  const seen = new Map<string, Issue>()
  const result: Issue[] = []
  for (const issue of issues) {
    const fp = issueFingerprint(issue)
    if (!seen.has(fp)) {
      seen.set(fp, issue)
      result.push(issue)
    }
  }
  return result
}
