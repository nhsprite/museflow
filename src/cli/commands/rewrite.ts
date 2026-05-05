import { getStory, updateStoryStatus, initStoryDb } from '../../storage/database/dao/story.js'
import { getState } from '../../core/runner.js'
import type { StoryStatus } from '../../types/story.js'
import { withSpinner } from '../utils/spinner.js'
import { buildNovelGraph } from '../../graph/novel.graph.js'
import { getCheckpointer } from '../../graph/checkpointer.js'
import {
  auto_fix_warnings,
  detect_consistency,
  detect_foreshadowing,
  detect_hallucination,
  draft_chapter,
  finalize_chapter,
  plan_chapter,
  quality_pass,
  validate_chapter,
  verify_outline_compliance,
} from '../../graph/nodes.js'
import { writeChapterContent, deleteChapterContent } from '../../storage/filesystem/writer.js'
import { getOutputsDir } from '../../utils/paths.js'
import type { RunnableConfig } from '@langchain/core/runnables'
import type { ReducedGraphState } from '../../graph/state.js'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

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

interface RewriteOptions {
  storyId: string
  chapter?: string
}

export async function rewrite(storyId: string, options: RewriteOptions): Promise<void> {
  await initStoryDb()
  const story = getStory(storyId)
  if (!story) {
    console.error(`[MuseFlow] 错误: 故事 "${storyId}" 不存在`)
    process.exit(1)
  }

  const targetChapter = options.chapter ? parseInt(options.chapter, 10) : null

  const state = await getState(storyId)
  if (!state) {
    console.error('[MuseFlow] 错误: 无法获取故事状态，请先运行 start')
    process.exit(1)
  }

  if (targetChapter !== null) {
    if (targetChapter < 1 || targetChapter > state.totalChapters) {
      console.error(`[MuseFlow] 错误: 章节编号必须在 1 到 ${state.totalChapters} 之间`)
      process.exit(1)
    }
    const targetIndex = targetChapter - 1
    console.log(`[MuseFlow] 重写章节: ${story.title}`)
    console.log(`  目标章节: ${targetChapter}/${state.totalChapters}`)
    console.log(`  原当前章节: ${state.currentChapterIndex + 1}`)
    await handleRewrite(storyId, true, targetIndex)
    return
  }

  const checkpointer = getCheckpointer()
  await checkpointer.clearPendingWrites(story.outputDir)

  if (state.pendingIssues.length > 0) {
    console.log('[MuseFlow] 重写章节: ', story.title)
    console.log(`  当前章节: ${state.currentChapterIndex + 1}/${state.totalChapters}`)
    console.log('[MuseFlow] 发现以下问题:')
    for (const issue of state.pendingIssues) {
      const icon = issue.severity === 'error' ? '❌' : issue.severity === 'warning' ? '⚠️' : 'ℹ️'
      console.log(`  ${icon} [${issue.type}] ${issue.description}`)
      if (issue.location) {
        console.log(`     位置: ${issue.location}`)
      }
    }
    console.log()
  } else {
    console.log(`[MuseFlow] 重写章节: ${story.title}`)
    console.log(`  当前章节: ${state.currentChapterIndex + 1}/${state.totalChapters}`)
    console.log('[MuseFlow] 当前章节没有已知问题，确认重写？')
    const answer = await question('  输入 y 确认重写，输入 n 取消 > ')
    const confirm = answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes'
    if (!confirm) {
      console.log('[MuseFlow] 已取消')
      console.log('  输入 "museflow write" 查看故事状态或继续撰写\n')
      return
    }
  }

  await handleRewrite(storyId, true)
}

async function handleRewrite(storyId: string, userResponse: boolean, targetChapterIndex?: number): Promise<void> {
  const updateStatus = (status: StoryStatus) => {
    updateStoryStatus(storyId, status)
  }

  const state = await getState(storyId)
  const chapterNum = targetChapterIndex !== undefined
    ? targetChapterIndex + 1
    : (state ? state.currentChapterIndex + 1 : 1)
  const totalChapters = state ? state.totalChapters : 0

  try {
    const result = await withSpinner(
      `正在重写第 ${chapterNum}/${totalChapters} 章...`,
      () => rewriteChapter(storyId, userResponse, targetChapterIndex)
    )

    if (result.rewriteRequested) {
      const errors = result.pendingIssues.filter(i => i.severity === 'error')
      console.log(`\n[MuseFlow] 检测到 ${errors.length} 个严重问题，重写已中断：`)
      for (const err of errors) {
        const icon = err.severity === 'error' ? '❌' : err.severity === 'warning' ? '⚠️' : 'ℹ️'
        console.log(`  ${icon} [${err.type}] ${err.description}`)
        if (err.location) {
          console.log(`     位置: ${err.location}`)
        }
      }
      const hasConsistencyErrors = errors.some(e => e.type === 'consistency')
      console.log(`\n请选择修复方式：`)
      if (hasConsistencyErrors) {
        console.log(`   museflow rewrite ${storyId}  # 彻底重写（推荐）`)
        console.log(`   museflow fix ${storyId}      # 针对性修复`)
        console.log(`\n  ⚠️  检测到跨章节一致性矛盾，rewrite 才能重新对齐前文事实`)
      } else {
        console.log(`   museflow fix ${storyId}      # 针对性修复（推荐）`)
        console.log(`   museflow rewrite ${storyId}  # 彻底重写`)
      }
      return
    }

    console.log(`\n✅ 第 ${chapterNum} 章重写完成`)

    if (result.currentChapterIndex >= result.totalChapters) {
      updateStatus('done')
      return
    }

    updateStatus('writing')

    const writtenIndex = result.currentChapterIndex - 1
    const outlineItem = result.outline[writtenIndex]
    const errors = result.pendingIssues.filter(i => i.severity === 'error')

    if (errors.length > 0) {
      console.log(`\n[MuseFlow] 第 ${writtenIndex + 1}/${result.totalChapters} 章重写完成`)
      if (outlineItem) {
        console.log(`  章节名: ${outlineItem.title}`)
      }
      console.log(`  状态: 仍有 ${errors.length} 个严重问题`)
      console.log('  请再次运行 "museflow rewrite" 重写本章\n')
      return
    }

    console.log(`\n[MuseFlow] ✅ 第 ${writtenIndex + 1}/${result.totalChapters} 章重写完成`)
    if (outlineItem) {
      console.log(`  章节名: ${outlineItem.title}`)
    }

    const fixedCount = state!.pendingIssues.filter(i => i.severity === 'error').length
    if (fixedCount > 0) {
      console.log(`  已修复: ${fixedCount} 个严重问题`)
    }

    const remainingWarnings = result.pendingIssues.filter(i => i.severity === 'warning')
    if (remainingWarnings.length > 0) {
      console.log(`  仍有 ${remainingWarnings.length} 个警告`)
    }

    console.log('\n✨ 质量检查通过，运行 "museflow write" 继续下一章\n')

    const nextIndex = result.currentChapterIndex + 1
    if (nextIndex < result.totalChapters) {
      updateStatus('writing')
    } else {
      updateStatus('done')
    }

  } catch (err) {
    console.error('[MuseFlow] 错误:', err instanceof Error ? err.message : String(err))
    updateStatus('error')
    process.exit(1)
  }
}

async function rewriteChapter(storyId: string, userResponse: boolean, targetChapterIndex?: number): Promise<ReducedGraphState> {
  const { Command } = await import('@langchain/langgraph')
  const outputDir = getOutputDirFromStoryId(storyId)
  if (!outputDir) {
    throw new Error(`Story ${storyId} not found`)
  }

  const checkpointer = getCheckpointer()

  let config: RunnableConfig = {
    configurable: { thread_id: storyId, outputDir, checkpoint_dir: outputDir },
  }

  if (targetChapterIndex !== undefined) {
    const chapterCheckpoint = await checkpointer.getChapterCheckpoint(outputDir, targetChapterIndex + 1)
    if (chapterCheckpoint) {
      config = {
        configurable: {
          thread_id: storyId,
          checkpoint_id: chapterCheckpoint.checkpointId,
          outputDir,
        },
      }
      console.log(`[MuseFlow] 已恢复第 ${targetChapterIndex + 1} 章完成时的状态`)
    } else {
      console.log(`[MuseFlow] 未找到第 ${targetChapterIndex + 1} 章的章节级 checkpoint，将从当前状态继续`)
    }
  }

  const graph = buildNovelGraph()

  if (targetChapterIndex !== undefined) {
    await checkpointer.clearPendingWrites(outputDir)

    const snapshot = await graph.getState(config)
    const checkpointState = snapshot.values as ReducedGraphState

    const rewrittenChapters = new Array(checkpointState.totalChapters).fill(null) as ReducedGraphState['chapters']
    for (let i = 0; i < targetChapterIndex; i++) {
      rewrittenChapters[i] = checkpointState.chapters[i] ?? null
    }

    let workingState: ReducedGraphState = {
      ...checkpointState,
      currentChapterIndex: targetChapterIndex,
      chapters: rewrittenChapters,
      pendingIssues: [],
      rewriteApproved: userResponse,
      rewriteRequested: false,
      isWriting: true,
      writeOneChapterOnly: true,
      chapterPlan: null,
    }

    for (let ch = targetChapterIndex + 1; ch <= checkpointState.totalChapters; ch++) {
      await deleteChapterContent(outputDir, ch)
    }

    const nodeSequence = [
      plan_chapter,
      draft_chapter,
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
      if (node === auto_fix_warnings) {
        const errors = workingState.pendingIssues.filter((i: { severity: string }) => i.severity === 'error')
        if (errors.length > 0) {
          console.error(`[MuseFlow] 检测到 ${errors.length} 个错误，中断章节重写流程`)
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
    workingState = {
      ...workingState,
      rewriteApproved: false,
      rewriteRequested: hasErrors,
    }
    if (!hasErrors) {
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
      await checkpointer.saveChapterCheckpoint(outputDir, targetChapterIndex + 1)
      await checkpointer.pruneIntermediateCheckpoints(outputDir)
    } else {
      await checkpointer.clearPendingWrites(outputDir)
      // 保存错误状态到 checkpointer，让 write 命令能检测到
      await graph.updateState(
        { configurable: { thread_id: storyId, outputDir } },
        {
          rewriteRequested: true,
          pendingIssues: workingState.pendingIssues,
        }
      )
    }

    return workingState
  }

  const update: Record<string, unknown> = {
    rewriteApproved: userResponse,
    rewriteRequested: false,
    isWriting: true,
    writeOneChapterOnly: true,
  }

  // For the non-targeted rewrite case, we need to use the same manual node sequence
  // approach to avoid LangGraph's "LastValue can only receive one value per step" error
  // that occurs when using graph.invoke(Command(goto, update)) on a persisted thread.
  await checkpointer.clearPendingWrites(outputDir)

  const snapshot = await graph.getState(config)
  const checkpointState = snapshot.values as ReducedGraphState

  // Find which chapter to rewrite - either currentChapterIndex or first chapter if none
  const rewriteIndex = checkpointState.currentChapterIndex > 0
    ? checkpointState.currentChapterIndex
    : 0

  const rewrittenChapters = new Array(checkpointState.totalChapters).fill(null) as ReducedGraphState['chapters']
  for (let i = 0; i < rewriteIndex; i++) {
    rewrittenChapters[i] = checkpointState.chapters[i] ?? null
  }

  let workingState: ReducedGraphState = {
    ...checkpointState,
    currentChapterIndex: rewriteIndex,
    chapters: rewrittenChapters,
    pendingIssues: [],
    rewriteApproved: userResponse,
    rewriteRequested: false,
    isWriting: true,
    writeOneChapterOnly: true,
    chapterPlan: null,
  }

  const nodeSequence = [
    plan_chapter,
    draft_chapter,
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
    if (node === auto_fix_warnings) {
      const errors = workingState.pendingIssues.filter((i: { severity: string }) => i.severity === 'error')
      if (errors.length > 0) {
        console.error(`[MuseFlow] 检测到 ${errors.length} 个错误，中断章节重写流程`)
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
  workingState = {
    ...workingState,
    rewriteApproved: false,
    rewriteRequested: hasErrors,
  }
  if (!hasErrors) {
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
    await checkpointer.saveChapterCheckpoint(outputDir, rewriteIndex + 1)
  } else {
    await checkpointer.clearPendingWrites(outputDir)
    // 保存错误状态到 checkpointer，让 write 命令能检测到
    await graph.updateState(
      { configurable: { thread_id: storyId, outputDir } },
      {
        rewriteRequested: true,
        pendingIssues: workingState.pendingIssues,
      }
    )
  }

  return workingState
}

function question(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    })
    rl.question(prompt, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}
