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

async function loadStateForChapter(storyId: string, currentState: ReducedGraphState, targetChapter: number): Promise<ReducedGraphState> {
  if (targetChapter === currentState.currentChapterIndex + 1) {
    return currentState
  }

  const outputDir = getOutputDirFromStoryId(storyId)
  if (!outputDir) {
    return { ...currentState, pendingIssues: [] }
  }

  const checkpointer = getCheckpointer()
  const chapterCheckpoint = await checkpointer.getChapterCheckpoint(outputDir, targetChapter)

  if (!chapterCheckpoint) {
    console.warn(`[MuseFlow] 未找到第 ${targetChapter} 章的 checkpoint，无法加载历史问题`)
    return { ...currentState, pendingIssues: [] }
  }

  try {
    const checkpointValues = (chapterCheckpoint.checkpoint as unknown as { channel_values: ReducedGraphState }).channel_values
    if (checkpointValues && Array.isArray(checkpointValues.pendingIssues)) {
      return {
        ...currentState,
        pendingIssues: checkpointValues.pendingIssues,
      }
    }
  } catch {
    console.warn(`[MuseFlow] 读取第 ${targetChapter} 章 checkpoint 失败`)
  }

  return { ...currentState, pendingIssues: [] }
}

interface FixOptions {
  storyId: string
  chapter?: number
}

export async function fix(storyId: string, options: FixOptions): Promise<void> {
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

  let targetChapter = options.chapter
  if (!targetChapter) {
    const currentChapter = state.currentChapterIndex + 1
    const currentStateCheck = await loadStateForChapter(storyId, state, currentChapter)
    if (currentStateCheck.pendingIssues.length > 0) {
      targetChapter = currentChapter
    } else {
      const previousChapter = state.currentChapterIndex
      if (previousChapter > 0) {
        const previousStateCheck = await loadStateForChapter(storyId, state, previousChapter)
        if (previousStateCheck.pendingIssues.length > 0) {
          targetChapter = previousChapter
          console.log(`[MuseFlow] 当前章节没有问题，自动切换到最近有问题的第 ${targetChapter} 章`)
        }
      }
    }
  }

  if (!targetChapter) {
    console.log('[MuseFlow] 没有找到有待修复问题的章节')
    console.log('  运行 "museflow write" 继续撰写\n')
    return
  }

  const outputDir = getOutputDirFromStoryId(storyId)
  const chapterFilePath = outputDir ? join(outputDir, 'chapters', `chapter_${targetChapter}.md`) : ''
  if (outputDir && !existsSync(chapterFilePath)) {
    console.log(`[MuseFlow] 第 ${targetChapter} 章尚未撰写，无法修复`)
    const previousChapter = targetChapter - 1
    if (previousChapter > 0) {
      const previousStateCheck = await loadStateForChapter(storyId, state, previousChapter)
      if (previousStateCheck.pendingIssues.length > 0) {
        targetChapter = previousChapter
        console.log(`[MuseFlow] 自动切换到最近有问题的第 ${targetChapter} 章`)
      } else {
        console.log(`  请先运行: museflow write ${storyId}\n`)
        return
      }
    } else {
      console.log(`  请先运行: museflow write ${storyId}\n`)
      return
    }
  }

  if (options.chapter && options.chapter !== state.currentChapterIndex + 1) {
    console.log(`[MuseFlow] 指定修复第 ${targetChapter} 章`)
  }

  const effectiveState = await loadStateForChapter(storyId, state, targetChapter)

  if (effectiveState.pendingIssues.length === 0) {
    console.log(`[MuseFlow] 第 ${targetChapter} 章没有待修复的问题`)
    console.log('  该章节可能没有质量检查记录，或问题已在后续修复\n')
    return
  }

  const errors = effectiveState.pendingIssues.filter(i => i.severity === 'error')
  const warnings = effectiveState.pendingIssues.filter(i => i.severity === 'warning')

  console.log('[MuseFlow] 修复问题: ', story.title)
  console.log(`  目标章节: ${targetChapter}/${state.totalChapters}`)
  console.log(`  发现 ${errors.length} 个错误，${warnings.length} 个警告\n`)

  const issueGroups = groupIssuesByType(effectiveState.pendingIssues)
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

  await handleFix(storyId, targetChapter)
}

async function handleFix(storyId: string, targetChapter: number): Promise<void> {
  const state = await getState(storyId)
  const totalChapters = state ? state.totalChapters : 0
  const targetChapterIndex = targetChapter - 1

  const effectiveState = await loadStateForChapter(storyId, state ?? {} as ReducedGraphState, targetChapter)

  const errors = effectiveState.pendingIssues.filter(i => i.severity === 'error')
  const warnings = effectiveState.pendingIssues.filter(i => i.severity === 'warning')

  if (errors.length === 0) {
    console.log(`\n[MuseFlow] 第 ${targetChapter} 章没有需要修复的错误`)
    if (warnings.length > 0) {
      console.log(`  有 ${warnings.length} 个警告/建议，但不影响继续写作`)
      console.log('  警告可在下次 rewrite 时一并优化\n')
    }
    console.log('  运行 "museflow write" 继续下一章\n')
    return
  }

  const fixableIssues = effectiveState.pendingIssues.filter(isFixable)
  const nonFixableIssues = effectiveState.pendingIssues.filter(i => !isFixable(i))

  if (nonFixableIssues.length > 0) {
    console.log(`\n[MuseFlow] 检测到 ${nonFixableIssues.length} 个结构性问题，不适合用 fix 修复：`)
    for (const issue of nonFixableIssues) {
      console.log(`  ❌ [${issue.type}] ${issue.description}`)
    }
    console.log('\n  结构性问题（时间线、逻辑矛盾、段落结构）需要彻底重写才能解决。')
    console.log(`   museflow rewrite ${storyId} --chapter ${targetChapter}\n`)
    return
  }

  const initialErrorCount = errors.length

  try {
    const result = await withSpinner(
      `正在修复第 ${targetChapter}/${totalChapters} 章...`,
      () => invokeGraph(storyId, true, targetChapterIndex),
      `✅ 第 ${targetChapter} 章修复完成`
    )

    const remainingErrors = result.pendingIssues.filter(i => i.severity === 'error').length

    if (remainingErrors === 0) {
      console.log(`\n[MuseFlow] ✅ 第 ${targetChapter}/${totalChapters} 章修复完成`)
      if (result.outline[targetChapterIndex]) {
        console.log(`  章节名: ${result.outline[targetChapterIndex].title}`)
      }

      const remainingWarnings = result.pendingIssues.filter(i => i.severity === 'warning')
      if (remainingWarnings.length > 0) {
        console.log(`  仍有 ${remainingWarnings.length} 个警告`)
      }

      console.log('\n✨ 所有严重问题已修复，运行 "museflow write" 继续下一章\n')
      return
    }

    if (remainingErrors > initialErrorCount) {
      console.log(`\n[MuseFlow] 修复后问题反而增加（${initialErrorCount} → ${remainingErrors}）`)
      console.log('  说明本章结构性矛盾较多，建议彻底重写\n')
      console.log(`   museflow rewrite ${storyId} --chapter ${targetChapter}\n`)
      return
    }

    console.log(`\n[MuseFlow] 修复后仍有 ${remainingErrors} 个问题`)
    console.log('  这些问题可能需要更大幅度的调整\n')
    console.log(`请选择修复方式：`)
    console.log(`   museflow rewrite ${storyId} --chapter ${targetChapter}  # 彻底重写（推荐）`)
    console.log(`   museflow fix ${storyId} --chapter ${targetChapter}      # 再次尝试针对性修复\n`)
  } catch (err) {
    console.error('[MuseFlow] 错误:', err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}

function isFixable(issue: { type: string; severity: string; description: string }): boolean {
  // 只有 error 级别的 consistency 才需要 rewrite
  if (issue.type === 'consistency' && issue.severity === 'error') {
    return false
  }

  // 只有 error 级别且包含结构性关键词的问题才不可修复
  if (issue.severity === 'error') {
    const structuralKeywords = [
      '时间混乱', '逻辑矛盾', '因果关系断裂', '结构',
      '段落结构', '叙事结构', '前后矛盾', '逻辑不通',
    ]
    if (structuralKeywords.some(kw => issue.description.includes(kw))) {
      return false
    }
  }

  return true
}

async function invokeGraph(storyId: string, rewriteApproved: boolean, targetChapterIndex?: number): Promise<ReducedGraphState> {
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

  let targetIndex = checkpointState.currentChapterIndex
  let pendingIssues = checkpointState.pendingIssues

  if (targetChapterIndex !== undefined && targetChapterIndex !== targetIndex) {
    targetIndex = targetChapterIndex
    const chapterCheckpoint = await checkpointer.getChapterCheckpoint(outputDir, targetChapterIndex + 1)
    if (chapterCheckpoint) {
      try {
        const checkpointValues = (chapterCheckpoint.checkpoint as unknown as { channel_values: ReducedGraphState }).channel_values
        if (checkpointValues && Array.isArray(checkpointValues.pendingIssues)) {
          pendingIssues = checkpointValues.pendingIssues
        }
      } catch {
        console.warn(`[MuseFlow] 读取第 ${targetChapterIndex + 1} 章 checkpoint 失败，使用当前 pendingIssues`)
      }
    }
  }

  const rewrittenChapters = new Array(checkpointState.totalChapters).fill(null) as ReducedGraphState['chapters']
  for (let i = 0; i < targetIndex; i++) {
    rewrittenChapters[i] = checkpointState.chapters[i] ?? null
  }

  let workingState: ReducedGraphState = {
    ...checkpointState,
    currentChapterIndex: targetIndex,
    chapters: rewrittenChapters,
    pendingIssues,
    rewriteApproved,
    rewriteRequested: false,
    isWriting: true,
    writeOneChapterOnly: true,
  }

  const nodeSequence = [
    fix_chapter,
    validate_chapter,
    quality_pass,
    detect_hallucination,
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
        currentChapterIndex: workingState.currentChapterIndex,
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
