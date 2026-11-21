import type { NarrativeAuditMode, NarrativeAuditReport } from '../../../types/narrative-audit.js'
import { isRecordableFact } from './coverage.js'

/**
 * 结构零增量不等于叙事停滞。只有本轮强制审计明确证明了无需状态记录的推进，
 * 且无未解决发现/覆盖疑点，才中断零增量连击；不补造事件、不消费节拍。
 * 正文/记录/历史窗口的完整凭证校验由图的路由和定稿入口执行。
 */
export function hasAuditedNonStateProgress(
  report: NarrativeAuditReport | undefined,
  chapterIndex: number,
  contentHash: string | undefined,
  mode: NarrativeAuditMode
): boolean {
  if (
    mode !== 'enforce' ||
    !report ||
    report.protocolVersion !== 4 ||
    report.mode !== 'enforce' ||
    report.chapterIndex !== chapterIndex ||
    !contentHash ||
    report.contentHash !== contentHash ||
    report.findings.some((finding) => finding.contradictionReview?.verdict !== 'rejected')
  )
    return false

  const current = report.progress.find((chapter) => chapter.chapterIndex === chapterIndex)
  if (
    current?.verdict !== 'advancing' ||
    current.recording !== 'not_required' ||
    current.dimensions.length === 0 ||
    current.evidenceParagraphs.length === 0
  )
    return false

  // 未覆盖、漏记或不确定的事实不能凭推进标签放行；检查全部 coverage，而非只看 errors。
  if (report.coverage.length !== report.facts.length) return false
  const seen = new Set<number>()
  for (const entry of report.coverage) {
    const fact = report.facts[entry.factIndex]
    if (!fact || seen.has(entry.factIndex)) return false
    seen.add(entry.factIndex)
    if (entry.confidence !== 'high') return false
    if (entry.verdict === 'missing' || entry.verdict === 'uncertain') return false
    if (entry.verdict === 'not_recordable' && isRecordableFact(fact)) return false
  }
  return true
}
