import { updateStoryStatus } from '../../storage/database/dao/story.js'
import { getState, getGraph, getOutputDirFromStoryId } from '../../core/runner.js'
import { executeChapterGeneration } from '../../core/chapter-generation.js'
import type { StoryStatus } from '../../types/story.js'
import { withSpinner, stopStepProgress, stopStepProgressQuiet } from '../utils/spinner.js'
import { printChapterOutline } from '../../utils/chapter-display.js'
import { getCheckpointer } from '../../graph/checkpointer.js'
import { deleteChapterContent } from '../../storage/filesystem/writer.js'
import { getStoryState } from '../../storage/database/dao/story-state.js'
import type { RunnableConfig } from '@langchain/core/runnables'
import type { ReducedGraphState } from '../../graph/state.js'
import type { Issue } from '../../types/agent.js'
import { createInterface } from 'node:readline'
import { requireStoryState } from '../utils/story-loader.js'

interface RewriteOptions {
  storyId: string
  chapter?: string
}

export async function rewrite(storyId: string, options: RewriteOptions): Promise<void> {
  const targetChapter = options.chapter ? parseInt(options.chapter, 10) : null

  const { story, state } = await requireStoryState(storyId)

  if (targetChapter !== null) {
    if (targetChapter < 1 || targetChapter > state.totalChapters) {
      console.error(`[MuseFlow] 错误: 章节编号必须在 1 到 ${state.totalChapters} 之间`)
      process.exit(1)
    }
    const targetIndex = targetChapter - 1
    console.log(`[MuseFlow] 重写章节: ${story.title}`)
    console.log(`  目标章节: ${targetChapter}/${state.totalChapters}`)
    console.log(`  原当前章节: ${state.currentChapterIndex + 1}`)
    const outlineItem = state.outline[targetIndex]
    printChapterOutline(outlineItem, targetIndex)
    await handleRewrite(storyId, true, targetIndex)
    return
  }

  const checkpointer = getCheckpointer()
  await checkpointer.clearPendingWrites(story.outputDir)

  let targetChapterIndex: number | undefined

  if (state.pendingIssues.length > 0) {
    const currentChapterHasErrors = state.rewriteRequested
    targetChapterIndex = currentChapterHasErrors
      ? state.currentChapterIndex
      : Math.max(0, state.currentChapterIndex - 1)
    const chapterNum = targetChapterIndex + 1
    console.log('[MuseFlow] 重写章节: ', story.title)
    console.log(`  目标章节: ${chapterNum}/${state.totalChapters}`)
    const outlineItem = state.outline[targetChapterIndex]
    printChapterOutline(outlineItem, targetChapterIndex)
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
    const chapterNum = state.currentChapterIndex + 1
    console.log(`[MuseFlow] 重写章节: ${story.title}`)
    console.log(`  目标章节: ${chapterNum}/${state.totalChapters}`)
    const outlineItem = state.outline[state.currentChapterIndex]
    printChapterOutline(outlineItem, state.currentChapterIndex)
    console.log('[MuseFlow] 当前章节没有已知问题，确认重写？')
    const answer = await question('  输入 y 确认重写，输入 n 取消 > ')
    const confirm = answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes'
    if (!confirm) {
      console.log('[MuseFlow] 已取消')
      console.log('  输入 "museflow write" 查看故事状态或继续撰写\n')
      return
    }
  }

  await handleRewrite(storyId, true, targetChapterIndex, state.pendingIssues)
}

async function handleRewrite(
  storyId: string,
  userResponse: boolean,
  targetChapterIndex?: number,
  retryIssues: Issue[] = []
): Promise<void> {
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
      () => rewriteChapter(storyId, userResponse, targetChapterIndex, retryIssues),
      `✅ 第 ${chapterNum} 章重写完成`,
      (result) => !result.rewriteRequested
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
      console.log(`\n请再次运行以下命令重写本章：`)
      console.log(`   museflow rewrite ${storyId}  # 彻底重写\n`)
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

async function rewriteChapter(
  storyId: string,
  userResponse: boolean,
  targetChapterIndex?: number,
  retryIssues: Issue[] = []
): Promise<ReducedGraphState> {
  console.log('[MuseFlow] 查找输出目录...')
  const outputDir = getOutputDirFromStoryId(storyId)
  if (!outputDir) {
    throw new Error(`Story ${storyId} not found`)
  }

  console.log('[MuseFlow] 初始化 checkpoint 和 graph...')
  const checkpointer = getCheckpointer()
  const graph = getGraph()

  let config: RunnableConfig = {
    configurable: { thread_id: storyId, outputDir, checkpoint_dir: outputDir },
  }

  let workingState: ReducedGraphState

  if (targetChapterIndex !== undefined) {
    console.log(`[MuseFlow] 查找第 ${targetChapterIndex} 章 checkpoint...`)
    const prevChapterCheckpoint = await checkpointer.getChapterCheckpoint(outputDir, targetChapterIndex)
    if (prevChapterCheckpoint) {
      config = {
        configurable: {
          thread_id: storyId,
          checkpoint_id: prevChapterCheckpoint.checkpointId,
          outputDir,
        },
      }
      console.log(`[MuseFlow] 已恢复第 ${targetChapterIndex} 章完成时的状态`)
    } else {
      const chapterCheckpoint = await checkpointer.getChapterCheckpoint(outputDir, targetChapterIndex + 1)
      if (chapterCheckpoint) {
        config = {
          configurable: {
            thread_id: storyId,
            checkpoint_id: chapterCheckpoint.checkpointId,
            outputDir,
          },
        }
        console.log(`[MuseFlow] 未找到第 ${targetChapterIndex} 章的 checkpoint，已恢复第 ${targetChapterIndex + 1} 章完成时的状态（将清理该章状态）`)
      } else {
        console.log(`[MuseFlow] 未找到相关 checkpoint，将从当前状态继续`)
      }
    }

    console.log('[MuseFlow] 加载 graph state...')
    const snapshot = await graph.getState(config)
    const checkpointState = snapshot.values as ReducedGraphState
    console.log('[MuseFlow] graph state 加载完成')

    const rewrittenChapters = new Array(checkpointState.totalChapters).fill(null) as ReducedGraphState['chapters']
    for (let i = 0; i < targetChapterIndex; i++) {
      rewrittenChapters[i] = checkpointState.chapters[i] ?? null
    }

    const cleanedSummaries = checkpointState.chapterSummaries.slice(0, targetChapterIndex)
    const cleanedForeshadowStack = checkpointState.foreshadowStack.filter(
      f => f.createdAtChapter < targetChapterIndex + 1
    )

    // 从 meta.json 恢复最新的 storyState，因为 checkpoint 中的 storyState 可能是空的或旧的
    const persistedStoryState = getStoryState(storyId)
    if (persistedStoryState && Object.keys(persistedStoryState.characterStatus || {}).length > 0) {
      checkpointState.storyState = persistedStoryState
    }

    workingState = {
      ...checkpointState,
      currentChapterIndex: targetChapterIndex,
      chapters: rewrittenChapters,
      chapterSummaries: cleanedSummaries,
      foreshadowStack: cleanedForeshadowStack,
      chapterTimeAnchor: undefined,
      pendingIssues: retryIssues.length > 0 ? retryIssues : checkpointState.pendingIssues,
      rewriteApproved: userResponse,
      rewriteRequested: false,
      isWriting: true,
      writeOneChapterOnly: true,
      chapterPlan: null,
    }

    console.log('[MuseFlow] 清理后续章节内容...')
    for (let ch = targetChapterIndex + 1; ch <= checkpointState.totalChapters; ch++) {
      await deleteChapterContent(outputDir, ch)
    }
    console.log('[MuseFlow] 开始生成章节...')
  } else {
    await checkpointer.clearPendingWrites(outputDir)

    const snapshot = await graph.getState(config)
    const checkpointState = snapshot.values as ReducedGraphState

    const rewriteIndex = checkpointState.currentChapterIndex > 0
      ? checkpointState.currentChapterIndex
      : 0

    const rewrittenChapters = new Array(checkpointState.totalChapters).fill(null) as ReducedGraphState['chapters']
    for (let i = 0; i < rewriteIndex; i++) {
      rewrittenChapters[i] = checkpointState.chapters[i] ?? null
    }

    const cleanedForeshadowStack = checkpointState.foreshadowStack.filter(
      f => f.createdAtChapter < rewriteIndex + 1
    )

    workingState = {
      ...checkpointState,
      currentChapterIndex: rewriteIndex,
      chapters: rewrittenChapters,
      foreshadowStack: cleanedForeshadowStack,
      chapterTimeAnchor: undefined,
      pendingIssues: retryIssues.length > 0 ? retryIssues : checkpointState.pendingIssues,
      rewriteApproved: userResponse,
      rewriteRequested: false,
      isWriting: true,
      writeOneChapterOnly: true,
    }
  }

  try {
    console.log('[MuseFlow] 调用 executeChapterGeneration...')
    const result = await executeChapterGeneration(storyId, outputDir, workingState, graph, checkpointer, {
      breakOnErrors: true,
      maxRewriteAttempts: 3,
      enableRevalidation: true,
      enableStructuralBranching: true,
    })
    console.log('[MuseFlow] executeChapterGeneration 完成')

    if (!result.rewriteRequested && targetChapterIndex !== undefined) {
      await checkpointer.pruneIntermediateCheckpoints(outputDir)
    }

    if (!result.rewriteRequested) {
      stopStepProgress('章节重写完成')
    }

    return result
  } catch (err) {
    stopStepProgressQuiet()
    throw err
  }
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
