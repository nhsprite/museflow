import { getStory, updateStoryStatus, initStoryDb } from '../../storage/database/dao/story.js'
import { getState } from '../../core/runner.js'
import type { StoryStatus } from '../../types/story.js'
import { withSpinner } from '../utils/spinner.js'
import { getOutputsDir } from '../../utils/paths.js'
import type { ReducedGraphState } from '../../graph/state.js'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getCheckpointer } from '../../graph/checkpointer.js'
import { buildNovelGraph } from '../../graph/novel.graph.js'
import type { RunnableConfig } from '@langchain/core/runnables'
import {
  fix_chapter,
  validate_chapter,
  quality_pass,
  detect_foreshadowing,
  detect_hallucination,
  detect_consistency,
  verify_outline_compliance,
  auto_fix_warnings,
  finalize_chapter,
} from '../../graph/nodes.js'

function getOutputDirFromStoryId(storyId: string): string | undefined {
  const booksDir = getOutputsDir()
  if (!existsSync(booksDir)) return undefined

  const storyIdSuffix = storyId.split('_').pop() ?? storyId
  const shortId = storyIdSuffix.slice(0, 12).toLowerCase()

  try {
    const entries = readdirSync(booksDir)
    for (const entry of entries) {
      if (!entry.includes(`-${shortId}`) && !entry.includes(`_${shortId}`)) continue
      const metaPath = join(booksDir, entry, 'meta.json')
      if (existsSync(metaPath)) {
        const content = readFileSync(metaPath, 'utf-8')
        const meta = JSON.parse(content)
        if (meta.story?.id === storyId) {
          return join(booksDir, entry)
        }
      }
    }
  } catch {
  }
  return undefined
}

interface FixOptions {
  storyId: string
}

export async function fix(storyId: string, _options: FixOptions): Promise<void> {
  await initStoryDb()
  const story = getStory(storyId)
  if (!story) {
    console.error(`[MuseFlow] 错误: 故事 "${storyId}" 不存在`)
    process.exit(1)
  }

  const state = await getState(storyId)
  if (!state) {
    console.error('[MuseFlow] 错误: 无法获取故事状态，请先运行 start')
    process.exit(1)
  }

  if (state.pendingIssues.length === 0) {
    console.log(`[MuseFlow] 当前章节没有待修复的问题`)
    console.log('  运行 "museflow write" 继续撰写\n')
    return
  }

  const errors = state.pendingIssues.filter(i => i.severity === 'error')
  const warnings = state.pendingIssues.filter(i => i.severity === 'warning')

  console.log('[MuseFlow] 修复问题: ', story.title)
  console.log(`  当前章节: ${state.currentChapterIndex + 1}/${state.totalChapters}`)
  console.log(`  发现 ${errors.length} 个错误，${warnings.length} 个警告\n`)

  const issueGroups = groupIssuesByType(state.pendingIssues)
  for (const [type, items] of Object.entries(issueGroups)) {
    console.log(`  【${type}】`)
    for (const issue of items) {
      const icon = issue.severity === 'error' ? '❌' : '⚠️'
      console.log(`    ${icon} ${issue.description}`)
      if (issue.location) {
        console.log(`       位置: ${issue.location}`)
      }
    }
    console.log()
  }

  await handleFix(storyId)
}

async function handleFix(storyId: string): Promise<void> {
  const updateStatus = (status: StoryStatus) => {
    updateStoryStatus(storyId, status)
  }

  const state = await getState(storyId)
  const chapterNum = state ? state.currentChapterIndex + 1 : 1
  const totalChapters = state ? state.totalChapters : 0
  const currentChapterIndex = state?.currentChapterIndex ?? 0
  const maxRounds = 3

  let lastErrorCount = state?.pendingIssues.filter(i => i.severity === 'error').length ?? 0

  for (let round = 1; round <= maxRounds; round++) {
    try {
      const roundLabel = round > 1 ? `（第 ${round}/${maxRounds} 轮）` : ''
      const result = await withSpinner(
        `正在修复第 ${chapterNum}/${totalChapters} 章${roundLabel}...`,
        () => invokeGraph(storyId, true),
        `✅ 第 ${chapterNum} 章第 ${round} 轮修复完成`
      )

      const remainingErrors = result.pendingIssues.filter(i => i.severity === 'error').length

      if (remainingErrors === 0) {
        console.log(`\n[MuseFlow] ✅ 第 ${chapterNum}/${totalChapters} 章修复完成`)
        if (result.outline[currentChapterIndex]) {
          console.log(`  章节名: ${result.outline[currentChapterIndex].title}`)
        }

        const remainingWarnings = result.pendingIssues.filter(i => i.severity === 'warning')
        if (remainingWarnings.length > 0) {
          console.log(`  仍有 ${remainingWarnings.length} 个警告`)
        }

        console.log('\n✨ 所有严重问题已修复，运行 "museflow write" 继续下一章\n')
        return
      }

      if (round < maxRounds) {
        if (remainingErrors < lastErrorCount) {
          console.log(`\n[MuseFlow] 第 ${round} 轮修复后问题减少：${lastErrorCount} → ${remainingErrors}，继续下一轮...\n`)
          lastErrorCount = remainingErrors
        } else if (remainingErrors === lastErrorCount) {
          console.log(`\n[MuseFlow] 第 ${round} 轮修复后问题数量未变化（${remainingErrors} 个），继续下一轮尝试...\n`)
        } else {
          console.log(`\n[MuseFlow] 第 ${round} 轮修复后问题增加：${lastErrorCount} → ${remainingErrors}，继续下一轮尝试...\n`)
          lastErrorCount = remainingErrors
        }
      }
    } catch (err) {
      console.error('[MuseFlow] 错误:', err instanceof Error ? err.message : String(err))
      updateStatus('error')
      process.exit(1)
    }
  }

  console.log(`\n[MuseFlow] 第 ${chapterNum}/${totalChapters} 章经过 ${maxRounds} 轮修复后仍有问题`)
  console.log(`  状态: 仍有 ${lastErrorCount} 个问题未解决`)
  console.log(`\n请选择修复方式：`)
  console.log(`   museflow fix ${storyId}      # 再次尝试针对性修复（推荐）`)
  console.log(`   museflow rewrite ${storyId}  # 彻底重写\n`)
}

async function invokeGraph(storyId: string, rewriteApproved: boolean): Promise<ReducedGraphState> {
  const graph = buildNovelGraph()
  const outputDir = getOutputDirFromStoryId(storyId)
  if (!outputDir) {
    throw new Error(`Story ${storyId} not found`)
  }

  const checkpointer = getCheckpointer()
  await checkpointer.clearPendingWrites(outputDir)

  const config: RunnableConfig = {
    configurable: { thread_id: storyId, outputDir },
  }

  const snapshot = await graph.getState(config)
  const checkpointState = snapshot.values as ReducedGraphState

  const targetIndex = checkpointState.currentChapterIndex

  const rewrittenChapters = new Array(checkpointState.totalChapters).fill(null) as ReducedGraphState['chapters']
  for (let i = 0; i < targetIndex; i++) {
    rewrittenChapters[i] = checkpointState.chapters[i] ?? null
  }

  let workingState: ReducedGraphState = {
    ...checkpointState,
    currentChapterIndex: targetIndex,
    chapters: rewrittenChapters,
    pendingIssues: checkpointState.pendingIssues,
    rewriteApproved,
    rewriteRequested: false,
    isWriting: true,
    writeOneChapterOnly: true,
  }

  const nodeSequence = [
    fix_chapter,
    validate_chapter,
    quality_pass,
    detect_foreshadowing,
    detect_hallucination,
    detect_consistency,
    verify_outline_compliance,
    auto_fix_warnings,
    finalize_chapter,
  ]

  for (const node of nodeSequence) {
    const partial = await node(workingState)
    workingState = {
      ...workingState,
      ...partial,
    }
    if (node === fix_chapter) {
      // fix_chapter 执行后清空 pendingIssues，让验证节点从零重新检测
      workingState.pendingIssues = []
    }
    if (node === auto_fix_warnings) {
      const errors = workingState.pendingIssues.filter((i: { severity: string }) => i.severity === 'error')
      if (errors.length > 0) {
        console.error(`[MuseFlow] 检测到 ${errors.length} 个错误，中断章节修复流程`)
        for (const err of errors) {
          const icon = err.severity === 'error' ? '❌' : err.severity === 'warning' ? '⚠️' : 'ℹ️'
          console.error(`  ${icon} [${err.type}] ${err.description}`)
          if (err.location) {
            console.error(`     位置: ${err.location}`)
          }
        }
        break
      }
    }
  }

  const hasErrors = workingState.pendingIssues.some((i: { severity: string }) => i.severity === 'error')
  if (hasErrors) {
    workingState.rewriteRequested = true
    await checkpointer.clearPendingWrites(outputDir)
    await graph.updateState(
      { configurable: { thread_id: storyId, outputDir } },
      {
        rewriteRequested: true,
        pendingIssues: workingState.pendingIssues,
      }
    )
    return workingState
  }

  workingState = {
    ...workingState,
    rewriteApproved: false,
    rewriteRequested: false,
  }
  await graph.updateState(
    { configurable: { thread_id: storyId, outputDir } },
    {
      rewriteApproved: false,
      rewriteRequested: false,
      pendingIssues: [],
      currentChapterIndex: workingState.currentChapterIndex,
      chapters: workingState.chapters,
      chapterSummaries: workingState.chapterSummaries,
    }
  )
  await checkpointer.saveChapterCheckpoint(outputDir, targetIndex + 1)

  return workingState
}

function groupIssuesByType(issues: { type: string; severity: string; description: string; location?: string }[]): Record<string, typeof issues> {
  const groups: Record<string, typeof issues> = {}
  const typeNames: Record<string, string> = {
    hallucination: '幻觉检测',
    consistency: '一致性检测',
    quality: '质量检查',
    word_count: '字数检查',
    outline_violation: '大纲偏离',
    outline_deviation: '大纲偏差',
  }

  for (const issue of issues) {
    const typeName = typeNames[issue.type] || issue.type
    if (!groups[typeName]) {
      groups[typeName] = []
    }
    groups[typeName].push(issue)
  }

  return groups
}
