import type { ReducedGraphState } from '../graph/state.js'
import { readChapterContent } from '../storage/filesystem/writer.js'
import { getChapterFilePath } from '../utils/paths.js'
import { existsSync } from 'node:fs'

export interface DiagnosisResult {
  hasIssues: boolean
  summary: string
  outlineIssues: string[]
  fileIssues: string[]
  foreshadowIssues: string[]
  suggestions: string[]
}

export async function diagnoseStoryState(state: ReducedGraphState, outputDir: string): Promise<DiagnosisResult> {
  const outlineIssues: string[] = []
  const fileIssues: string[] = []
  const foreshadowIssues: string[] = []
  const suggestions: string[] = []

  const chapterIndex = state.currentChapterIndex
  const outlineItem = state.outline[chapterIndex]

  if (outlineItem) {
    const eventCount = outlineItem.description.split(/[。；]/).filter(s => s.trim().length > 5).length
    if (eventCount > 5) {
      outlineIssues.push(`第${chapterIndex + 1}章 "${outlineItem.title}" 包含 ${eventCount} 个情节点，信息密度过高`)
      suggestions.push(`建议拆分第${chapterIndex + 1}章大纲：将次要事件移至后续章节`)
    }

    const foreshadowPattern = /伏笔|铺垫|暗示|预示|留下悬念/g
    const callbackPattern = /回收|兑现|揭晓|揭示/g
    const hasForeshadow = foreshadowPattern.test(outlineItem.description)
    const hasCallback = callbackPattern.test(outlineItem.description)
    if (hasForeshadow && hasCallback) {
      outlineIssues.push(`第${chapterIndex + 1}章大纲同时包含"埋下伏笔"和"回收伏笔"`)
      suggestions.push(`建议修改大纲："埋下伏笔"和"回收伏笔"应分属不同章节`)
    }
  }

  const crossChapterConflicts = detectCrossChapterOutlineConflicts(state.outline)
  for (const conflict of crossChapterConflicts) {
    outlineIssues.push(conflict)
    suggestions.push('建议修改大纲：避免在前章使用终结性词汇（如"伏法"），同时后章要求对该事件进行后续辨别/审判')
  }

  const chapterPath = getChapterFilePath(outputDir, chapterIndex + 1)
  if (!existsSync(chapterPath)) {
    fileIssues.push(`第 ${chapterIndex + 1} 章文件不存在`)
  } else {
    const content = await readChapterContent(outputDir, chapterIndex + 1)
    if (!content || content.trim().length === 0) {
      fileIssues.push(`第 ${chapterIndex + 1} 章文件内容为空`)
    }
  }

  for (const item of state.foreshadowStack) {
    if (item.status === 'shown' && !item.fulfilledChapter && item.createdAtChapter === chapterIndex + 1) {
      foreshadowIssues.push(`伏笔 "${item.text.substring(0, 40)}..." 在本章被明确展示但未留待第${item.expectedFulfillChapter}章回收`)
    }
    if (!item.fulfilledChapter && chapterIndex + 1 > item.expectedFulfillChapter + 1) {
      foreshadowIssues.push(`伏笔 "${item.text.substring(0, 40)}..." 已逾期 ${chapterIndex + 1 - item.expectedFulfillChapter} 章未回收`)
    }
  }

  const errorTypes = state.pendingIssues.filter(i => i.severity === 'error').map(i => i.type)
  const typeCounts = errorTypes.reduce((acc, type) => {
    acc[type] = (acc[type] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  const totalErrors = state.pendingIssues.filter(i => i.severity === 'error').length
  const hasIssues = outlineIssues.length > 0 || fileIssues.length > 0 || foreshadowIssues.length > 0 || totalErrors > 0

  let summary = ''
  if (hasIssues) {
    const parts: string[] = []
    if (outlineIssues.length > 0) parts.push(`${outlineIssues.length} 个大纲问题`)
    if (fileIssues.length > 0) parts.push(`${fileIssues.length} 个文件问题`)
    if (foreshadowIssues.length > 0) parts.push(`${foreshadowIssues.length} 个伏笔问题`)
    if (totalErrors > 0) parts.push(`${totalErrors} 个质量错误`)
    summary = `检测到 ${parts.join('，')}`
  } else {
    summary = '未发现系统性问题'
  }

  if (typeCounts['outline_violation'] || typeCounts['outline_deviation']) {
    suggestions.push('大纲与正文偏离严重，建议简化当前章节大纲描述')
  }
  if (typeCounts['consistency']) {
    suggestions.push('一致性错误较多，建议检查前序章节的状态记录')
  }
  if (typeCounts['hallucination']) {
    suggestions.push('幻觉错误较多，建议在 prompt 中加强前文约束')
  }

  return {
    hasIssues,
    summary,
    outlineIssues,
    fileIssues,
    foreshadowIssues,
    suggestions,
  }
}

function detectCrossChapterOutlineConflicts(
  outline: Array<{ number: number; title: string; description: string }>
): string[] {
  const conflicts: string[] = []
  const terminalKeywords = ['伏法', '处死', '消灭', '死亡', '已死', '被灭', '已毁', '已除', '已诛', '已斩']
  const resolutionKeywords = ['辨别', '审判', '查明', '验证', '确认', '分辨', '识别', '识破', '揭露', '查证']

  for (let i = 0; i < outline.length - 1; i++) {
    const current = outline[i]
    const next = outline[i + 1]
    if (!current?.description || !next?.description) continue

    const hasTerminal = terminalKeywords.some(k => current.description.includes(k))
    const hasResolution = resolutionKeywords.some(k => next.description.includes(k))

    if (hasTerminal && hasResolution) {
      conflicts.push(
        `第${current.number}章 "${current.title}" 包含终结性事件（如"${terminalKeywords.find(k => current.description.includes(k))}"），但第${next.number}章 "${next.title}" 需要对该事件进行后续辨别/审判，存在逻辑冲突`
      )
    }
  }
  return conflicts
}

export function printDiagnosis(result: DiagnosisResult): void {
  if (!result.hasIssues) return

  console.error('\n' + '═'.repeat(60))
  console.error('📋 失败原因分析')
  console.error('═'.repeat(60))
  console.error(`\n${result.summary}\n`)

  if (result.outlineIssues.length > 0) {
    console.error('📝 大纲问题：')
    result.outlineIssues.forEach(issue => console.error(`  ❌ ${issue}`))
    console.error('')
  }

  if (result.foreshadowIssues.length > 0) {
    console.error('🔍 伏笔问题：')
    result.foreshadowIssues.forEach(issue => console.error(`  ❌ ${issue}`))
    console.error('')
  }

  if (result.fileIssues.length > 0) {
    console.error('📁 文件问题：')
    result.fileIssues.forEach(issue => console.error(`  ❌ ${issue}`))
    console.error('')
  }

  if (result.suggestions.length > 0) {
    console.error('💡 修复建议：')
    result.suggestions.forEach((suggestion, i) => console.error(`  ${i + 1}. ${suggestion}`))
    console.error('')
  }

  console.error('═'.repeat(60))
  console.error('')
}
