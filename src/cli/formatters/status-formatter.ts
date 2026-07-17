import { getForeshadowAlerts, formatForeshadowAlerts } from './foreshadow-alerts.js'
import { formatActForeshadowBoundaryPressure } from './foreshadow-boundary-pressure.js'
import { createCheckpointService } from '../../storage/checkpoint-service.js'
import { buildArcStatus } from '../../utils/story-arc.js'
import { getChapterPlanningConfig } from '../../utils/chapter-planning.js'
import type { Story } from '../../types/story.js'
import type { ReducedGraphState } from '../../graph/state.js'
import {
  foreshadowMemoryToItem,
  groupActiveForeshadowsByPolicy,
} from '../../story-memory/foreshadow-policy.js'
import { getCanonicalForeshadows } from '../../story-memory/foreshadow-alias.js'

export interface ChapterIssue {
  chapterNumber: number
  title: string
  issues: Array<{
    severity: string
    type: string
    description: string
    location?: string
    suggestion?: string
  }>
}

export async function getChapterIssues(
  outputDir: string,
  totalChapters: number
): Promise<ChapterIssue[]> {
  const service = createCheckpointService(outputDir)
  const results: ChapterIssue[] = []

  for (let chapterNum = 1; chapterNum <= totalChapters; chapterNum++) {
    const checkpointId = await service.getChapterMarker(chapterNum)
    if (!checkpointId) continue

    try {
      const tuple = await service.getTuple({
        configurable: { thread_id: '', outputDir, checkpoint_id: checkpointId },
      })
      if (!tuple) continue

      const values = (
        tuple.checkpoint as unknown as {
          channel_values?: {
            pendingIssues?: ChapterIssue['issues']
            outline?: Array<{ title?: string }>
          }
        }
      ).channel_values
      const pendingIssues = values?.pendingIssues ?? []
      const title = values?.outline?.[chapterNum - 1]?.title ?? `第${chapterNum}章`

      if (pendingIssues.length > 0) {
        results.push({
          chapterNumber: chapterNum,
          title,
          issues: pendingIssues,
        })
      }
    } catch {
      // ignore unreadable checkpoint
    }
  }

  return results
}

export function printStatusHeader(): void {
  console.log('='.repeat(50))
  console.log('故事进度')
  console.log('='.repeat(50))
}

export function printStoryInfo(story: Story): void {
  console.log(`ID: ${story.id}`)
  console.log(`简介: ${story.synopsis || story.idea}`)
  console.log(`状态: ${story.status}`)
  console.log('')
}

export function printChapterProgress(state: ReducedGraphState): void {
  const current = state.currentChapterIndex
  const total = state.totalChapters
  const doneChapters = state.chapters.filter((c) => c !== null).length
  const progress = total > 0 ? Math.round((doneChapters / total) * 100) : 0

  console.log(`章节进度: ${doneChapters}/${total} (${progress}%)`)

  if (state.storyArc) {
    const arcStatus = buildArcStatus(
      state.storyArc,
      state.actProgress,
      current,
      getChapterPlanningConfig(state.genre).bookClosingPhaseRatio
    )
    console.log('')
    console.log('故事弧线')
    console.log('-'.repeat(50))
    if (arcStatus.currentAct) {
      console.log(
        `当前幕: 第 ${arcStatus.currentAct.index} 幕「${arcStatus.currentAct.title}」（第 ${arcStatus.currentAct.startChapter}-${arcStatus.currentAct.endChapter} 章）`
      )
      console.log(`本章位置: 第 ${current + 1}/${state.totalChapters} 章`)
      console.log(`收尾阶段: ${arcStatus.closingPhase ? '是' : '否'}`)
      for (const line of formatActForeshadowBoundaryPressure(state, arcStatus.currentAct)) {
        console.log(line)
      }
    } else {
      console.log('当前幕: 未定位')
    }
    console.log('')
    console.log('节拍进度')
    console.log(`已消费: ${arcStatus.beatsConsumed}/${arcStatus.beatsTotal}`)
    if (arcStatus.beatsPending.length > 0) {
      console.log('待消费:')
      for (let i = 0; i < arcStatus.beatsPending.length; i++) {
        console.log(`  ${i + 1}. ${arcStatus.beatsPending[i]}`)
      }
    }
    if (arcStatus.overdueKeyBeats.length > 0 || arcStatus.upcomingKeyBeats.length > 0) {
      console.log('')
      console.log('全局关键节拍')
      for (const kb of arcStatus.overdueKeyBeats) {
        console.log(`逾期: ${kb.beat}（截止第 ${kb.deadlineAct} 幕）`)
      }
      for (const kb of arcStatus.upcomingKeyBeats) {
        console.log(`即将到期: ${kb.beat}（截止第 ${kb.deadlineAct} 幕）`)
      }
    }
    console.log('')
    console.log(
      `收尾风险: ${arcStatus.riskLevel === 'low' ? '低' : arcStatus.riskLevel === 'medium' ? '中' : '高'}`
    )
  }
}

export function printPendingIssues(
  state: ReducedGraphState,
  chapterIssues: ChapterIssue[] = []
): void {
  if (state.pendingIssues.length === 0) return

  console.log(`待处理问题: ${state.pendingIssues.length}`)
  const errors = state.pendingIssues.filter((i) => i.severity === 'error')
  const warnings = state.pendingIssues.filter((i) => i.severity === 'warning')
  const infos = state.pendingIssues.filter((i) => i.severity === 'info')
  if (errors.length > 0) console.log(`  - 严重问题: ${errors.length}`)
  if (warnings.length > 0) console.log(`  - 警告: ${warnings.length}`)
  if (infos.length > 0) console.log(`  - 提示: ${infos.length}`)

  console.log('')
  const showIssues = (items: typeof state.pendingIssues, label: string, icon: string) => {
    if (items.length === 0) return
    console.log(`  ${label}:`)
    for (const issue of items) {
      console.log(`    ${icon} [${issue.type}] ${issue.description}`)
      if (issue.location) {
        console.log(`       位置: ${issue.location}`)
      }
      if (issue.suggestion) {
        console.log(`       建议: ${issue.suggestion}`)
      }
    }
  }
  showIssues(errors, '严重问题', '❌')
  showIssues(warnings, '警告', '⚠️')
  showIssues(infos, '提示', 'ℹ️')

  if (chapterIssues.length > 0) {
    console.log('')
    console.log('  各章节问题汇总:')
    for (const ci of chapterIssues) {
      const errorCount = ci.issues.filter((i) => i.severity === 'error').length
      const warningCount = ci.issues.filter((i) => i.severity === 'warning').length
      const infoCount = ci.issues.filter((i) => i.severity === 'info').length
      const parts = []
      if (errorCount > 0) parts.push(`${errorCount} 个错误`)
      if (warningCount > 0) parts.push(`${warningCount} 个警告`)
      if (infoCount > 0) parts.push(`${infoCount} 个提示`)
      console.log(`    第 ${ci.chapterNumber} 章「${ci.title}」: ${parts.join(', ') || '0 个问题'}`)
    }
  }
}

export function printWorldBuildingStatus(state: ReducedGraphState): void {
  console.log('')
  if (state.world) {
    console.log('世界观: ✓ 已构建')
  } else {
    console.log('世界观: 待构建')
  }

  if (state.characters.length > 0) {
    console.log(`人物: ✓ ${state.characters.length} 个`)
  } else {
    console.log('人物: 待创建')
  }

  if (state.outline.length > 0) {
    console.log(`大纲: ✓ ${state.outline.length} 章`)
  } else {
    console.log('大纲: 待生成')
  }
}

export function printForeshadowStatus(state: ReducedGraphState): void {
  console.log('')
  const policyGroups = state.storyMemory ? groupActiveForeshadowsByPolicy(state.storyMemory) : null
  const activeItems = policyGroups
    ? [
        ...policyGroups.mustResolve,
        ...policyGroups.shouldResolve,
        ...policyGroups.mayRemainOpen,
      ].map(foreshadowMemoryToItem)
    : state.foreshadowStack.filter((foreshadow) => !foreshadow.fulfilledChapter)
  const fulfilled = state.storyMemory
    ? getCanonicalForeshadows(state.storyMemory)
        .filter(
          (foreshadow) => foreshadow.fulfilledIn !== null && foreshadow.waivedIn === undefined
        )
        .map(foreshadowMemoryToItem)
    : state.foreshadowStack.filter((foreshadow) => foreshadow.fulfilledChapter)
  if (activeItems.length === 0 && fulfilled.length === 0) return

  console.log(`伏笔: ${fulfilled.length} 个已回收, ${activeItems.length} 个未结`)
  if (policyGroups) {
    console.log(`  必须回收: ${policyGroups.mustResolve.length}`)
    console.log(`  建议自然回收: ${policyGroups.shouldResolve.length}`)
    console.log(`  可保持开放: ${policyGroups.mayRemainOpen.length}`)
  }

  const alertItems = policyGroups
    ? policyGroups.mustResolve.map(foreshadowMemoryToItem)
    : activeItems
  if (alertItems.length > 0) {
    const alerts = getForeshadowAlerts(alertItems, state.currentChapterIndex + 1)
    console.log('')
    console.log(formatForeshadowAlerts(alerts))
  }

  if (fulfilled.length > 0) {
    console.log('')
    console.log('已回收伏笔:')
    for (const fs of fulfilled.slice(0, 5)) {
      const createdCh = fs.createdAtChapter || '?'
      console.log(
        `  ✓ "${fs.text.substring(0, 40)}..." (第${createdCh}章埋下 → 第${fs.fulfilledChapter}章回收)`
      )
    }
    if (fulfilled.length > 5) {
      console.log(`  ... 还有 ${fulfilled.length - 5} 个`)
    }
  }
}

export function printNextStep(state: ReducedGraphState): void {
  console.log('')

  if (state.rewriteRequested) {
    console.log('⚠️  等待重写确认')
    console.log('  使用 museflow continue 命令处理')
  } else if (state.currentChapterIndex < state.totalChapters) {
    console.log(`下一步: 撰写第 ${state.currentChapterIndex + 1} 章`)
    console.log('  使用 museflow continue 命令继续')
  } else {
    console.log('✓ 故事已完成')
    console.log('  使用 museflow export 命令导出')
  }
}

export function printNotStarted(): void {
  console.log('状态: 未开始或状态不可用')
  console.log('  使用 museflow start 开始此故事')
}

export function printStatusFooter(): void {
  console.log('='.repeat(50))
}
