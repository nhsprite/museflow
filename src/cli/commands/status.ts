import { requireStory } from '../utils/story-loader.js'
import { getState } from '../../core/runner.js'

import { getForeshadowAlerts, formatForeshadowAlerts } from '../../graph/state.js'
import { getCheckpointer } from '../../graph/checkpointer.js'
import { getOutputsDir } from '../../utils/paths.js'
import { existsSync } from 'node:fs'

interface ChapterIssue {
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

async function getChapterIssues(outputDir: string, totalChapters: number): Promise<ChapterIssue[]> {
  const checkpointer = getCheckpointer()
  const results: ChapterIssue[] = []

  for (let chapterNum = 1; chapterNum <= totalChapters; chapterNum++) {
    const checkpoint = await checkpointer.getChapterCheckpoint(outputDir, chapterNum)
    if (!checkpoint) continue

    try {
      const values = (checkpoint.checkpoint as unknown as { channel_values?: { pendingIssues?: ChapterIssue['issues']; outline?: Array<{ title?: string }> } }).channel_values
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
    }
  }

  return results
}

export async function status(storyId?: string): Promise<void> {
  if (!storyId) {
    console.error('[MuseFlow] 错误: 请提供故事ID')
    console.log('用法: museflow status <story-id>')
    process.exit(1)
  }

  const story = await requireStory(storyId)

  const state = await getState(storyId)

  console.log('='.repeat(50))
  console.log('故事进度')
  console.log('='.repeat(50))
  console.log(`ID: ${story.id}`)
  console.log(`简介: ${story.idea}`)
  console.log(`状态: ${story.status}`)
  console.log('')

  if (state) {
    const current = state.currentChapterIndex
    const total = state.totalChapters
    const doneChapters = state.chapters.filter(c => c !== null).length
    const progress = total > 0 ? Math.round((doneChapters / total) * 100) : 0

    console.log(`章节进度: ${doneChapters}/${total} (${progress}%)`)

    if (state.pendingIssues.length > 0) {
      console.log(`待处理问题: ${state.pendingIssues.length}`)
      const errors = state.pendingIssues.filter(i => i.severity === 'error')
      const warnings = state.pendingIssues.filter(i => i.severity === 'warning')
      const infos = state.pendingIssues.filter(i => i.severity === 'info')
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

      const outputDir = getOutputsDir()
      const storyDir = state.story?.outputDir
      if (storyDir && existsSync(storyDir)) {
        const chapterIssues = await getChapterIssues(storyDir, total)
        if (chapterIssues.length > 0) {
          console.log('')
          console.log('  各章节问题汇总:')
          for (const ci of chapterIssues) {
            const errorCount = ci.issues.filter(i => i.severity === 'error').length
            const warningCount = ci.issues.filter(i => i.severity === 'warning').length
            const infoCount = ci.issues.filter(i => i.severity === 'info').length
            const parts = []
            if (errorCount > 0) parts.push(`${errorCount} 个错误`)
            if (warningCount > 0) parts.push(`${warningCount} 个警告`)
            if (infoCount > 0) parts.push(`${infoCount} 个提示`)
            console.log(`    第 ${ci.chapterNumber} 章「${ci.title}」: ${parts.join(', ') || '0 个问题'}`)
          }
        }
      }
    }

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

    if (state.foreshadowStack.length > 0) {
      const unfulfilled = state.foreshadowStack.filter(f => !f.fulfilledChapter)
      const fulfilled = state.foreshadowStack.filter(f => f.fulfilledChapter)
      console.log(`伏笔: ${fulfilled.length} 个已回收, ${unfulfilled.length} 个待回收`)

      if (unfulfilled.length > 0) {
        const alerts = getForeshadowAlerts(state.foreshadowStack, state.currentChapterIndex + 1)
        console.log('')
        console.log(formatForeshadowAlerts(alerts))
      }

      if (fulfilled.length > 0) {
        console.log('')
        console.log('已回收伏笔:')
        for (const fs of fulfilled.slice(0, 5)) {
          const createdCh = fs.createdAtChapter || '?'
          console.log(`  ✓ "${fs.text.substring(0, 40)}..." (第${createdCh}章埋下 → 第${fs.fulfilledChapter}章回收)`)
        }
        if (fulfilled.length > 5) {
          console.log(`  ... 还有 ${fulfilled.length - 5} 个`)
        }
      }
    }

    console.log('')

    if (state.rewriteRequested) {
      console.log('⚠️  等待重写确认')
      console.log('  使用 museflow continue 命令处理')
    } else if (current < total) {
      console.log(`下一步: 撰写第 ${current + 1} 章`)
      console.log('  使用 museflow continue 命令继续')
    } else {
      console.log('✓ 故事已完成')
      console.log('  使用 museflow export 命令导出')
    }
  } else {
    console.log('状态: 未开始或状态不可用')
    console.log('  使用 museflow start 开始此故事')
  }

  console.log('='.repeat(50))
}
