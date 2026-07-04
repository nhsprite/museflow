import type { ChapterOutline } from '../../types/outline.js'
import type { ChapterReport } from '../../types/chapter-report.js'
import type { ReducedGraphState } from '../../graph/state.js'
import { buildArcStatus } from '../../utils/story-arc.js'

function toDisplayChapterNumber(chapterIndex: number): number {
  return chapterIndex + 1
}

export function printChapterOutline(outlineItem: ChapterOutline | undefined, chapterIndex: number): boolean {
  if (!outlineItem) {
    console.error('[MuseFlow] 错误: 未找到章节大纲')
    return false
  }

  console.log('═'.repeat(60))
  console.log(`第 ${toDisplayChapterNumber(chapterIndex)} 章`)
  console.log('═'.repeat(60))
  return true
}

export function printActProgress(state: ReducedGraphState, chapterIndex = state.currentChapterIndex): void {
  if (!state.storyArc) return

  const arcStatus = buildArcStatus(state.storyArc, state.actProgress ?? {}, chapterIndex)
  const act = arcStatus.currentAct
  if (!act) return

  const chapterNumber = chapterIndex + 1
  const actChapterNumber = chapterNumber - act.startChapter + 1
  const actChapterTotal = act.endChapter - act.startChapter + 1
  const actChaptersRemaining = Math.max(0, act.endChapter - chapterNumber)

  console.log(`  当前幕: 第 ${act.index} 幕「${act.title}」（第 ${act.startChapter}-${act.endChapter} 章）`)
  console.log(`  幕内进度: 第 ${actChapterNumber}/${actChapterTotal} 章，剩余 ${actChaptersRemaining} 章`)
  console.log(`  节拍进度: ${arcStatus.beatsConsumed}/${arcStatus.beatsTotal} 已消费，剩余 ${arcStatus.beatsPending.length}`)
  if (arcStatus.beatsPending.length > 0) {
    console.log(`  待消费: ${arcStatus.beatsPending.join('、')}`)
  }
}

export function printChapterReport(report: ChapterReport | null | undefined): void {
  if (!report) return

  const displayChapter = toDisplayChapterNumber(report.chapterIndex)

  console.log('\n' + '═'.repeat(60))
  console.log(`✅ 第 ${displayChapter} 章撰写完成`)
  console.log('═'.repeat(60))

  if (report.chapterTitle) {
    console.log(`\n📖 章节：${report.chapterTitle}`)
  }

  console.log(`📝 策略：${draftStrategyLabel(report.draftStrategy)}`)
  if (report.rewriteAttempts > 1) {
    console.log(`🔄 重写次数：${report.rewriteAttempts - 1}`)
  }
  if (report.errorRewriteAttempts > 0) {
    console.log(`🔁 错误重写：${report.errorRewriteAttempts} 轮`)
  }
  if (report.autoFixAttempts > 0) {
    console.log(`🔧 自动修复：${report.autoFixAttempts} 轮`)
  }

  const summary = report.issuesSummary
  if (summary.total > 0) {
    console.log(`\n🔍 质量检查：${summary.errors} 个错误 / ${summary.warnings} 个警告`)
  } else {
    console.log('\n🔍 质量检查：无问题')
  }

  if (report.issuesAutoResolved.length > 0) {
    console.log(`✔ 自动解决：${report.issuesAutoResolved.length} 个问题`)
  }

  if (report.stateCorrections.length > 0) {
    console.log(`📌 状态修正：${report.stateCorrections.length} 条`)
  }

  if (report.actProgress) {
    const progress = report.actProgress
    console.log(`📚 幕进度：第 ${progress.actIndex} 幕，${progress.beatsConsumed}/${progress.beatsTotal} 节拍已消费，剩余 ${progress.beatsPending.length} 个，幕内剩余 ${progress.chaptersRemaining} 章`)
    if (progress.beatsPending.length > 0) {
      console.log(`   待消费：${progress.beatsPending.join('、')}`)
    }
  }

  console.log(`\n🎣 伏笔：埋下 ${report.foreshadowsPlanted} / 回收 ${report.foreshadowsFulfilled}`)
  if (report.foreshadowsOverdue > 0) {
    console.log(`⚠️  逾期伏笔：${report.foreshadowsOverdue} 个`)
  }

  if (report.wordCount > 0) {
    console.log(`\n📝 字数：约 ${report.wordCount} 字`)
  }

  if (report.convergence !== 'success') {
    console.log(`\n⛔ 收敛结果：${convergenceLabel(report.convergence)}`)
  }
}

function draftStrategyLabel(strategy: ChapterReport['draftStrategy']): string {
  switch (strategy) {
    case 'draft':
      return '完整起草'
    case 'fix':
      return '段落修复'
    case 'replan':
      return '重新规划'
    case 'finalize-only':
      return '直接归档'
    default:
      return '未知'
  }
}

function convergenceLabel(convergence: ChapterReport['convergence']): string {
  switch (convergence) {
    case 'success':
      return '成功'
    case 'max-attempts-reached':
      return '达到最大重写次数'
    case 'state-corruption-escape':
      return '状态污染逃逸'
    case 'manual-rewrite-requested':
      return '需要手动重写'
    default:
      return '未知'
  }
}
