import { getStory, updateStoryStatus, initStoryDb } from '../../storage/database/dao/story.js'
import { getState } from '../../core/runner.js'
import type { StoryStatus } from '../../types/story.js'
import { withSpinner } from '../utils/spinner.js'
import { buildNovelGraph } from '../../graph/novel.graph.js'
import { getOutputsDir } from '../../utils/paths.js'
import type { RunnableConfig } from '@langchain/core/runnables'
import type { ReducedGraphState } from '../../graph/state.js'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

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

  try {
    const result = await withSpinner(`正在修复第 ${chapterNum}/${totalChapters} 章...`, () =>
      invokeGraph(storyId, true)
    )

    if (result.rewriteRequested) {
      console.log('\n[MuseFlow] 修复后仍有问题，运行 "museflow rewrite" 进行全面重写')
      return
    }

    const remainingErrors = result.pendingIssues.filter(i => i.severity === 'error').length
    if (remainingErrors > 0) {
      console.log(`\n[MuseFlow] 第 ${chapterNum}/${totalChapters} 章修复完成`)
      console.log(`  状态: 仍有 ${remainingErrors} 个问题未解决`)
      console.log('  运行 "museflow rewrite" 进行全面重写\n')
      return
    }

    console.log(`\n[MuseFlow] ✅ 第 ${chapterNum}/${totalChapters} 章修复完成`)
    if (result.outline[currentChapterIndex]) {
      console.log(`  章节名: ${result.outline[currentChapterIndex].title}`)
    }

    const fixedWarnings = result.pendingIssues.filter(i => i.severity !== 'error').length
    if (fixedWarnings > 0) {
      console.log(`  已修复: ${fixedWarnings} 个问题`)
    }

    const remainingWarnings = result.pendingIssues.filter(i => i.severity === 'warning')
    if (remainingWarnings.length > 0) {
      console.log(`  仍有 ${remainingWarnings.length} 个警告`)
    }

    console.log('\n✨ 所有严重问题已修复，运行 "museflow write" 继续下一章\n')

  } catch (err) {
    console.error('[MuseFlow] 错误:', err instanceof Error ? err.message : String(err))
    updateStatus('error')
    process.exit(1)
  }
}

async function invokeGraph(storyId: string, rewriteApproved: boolean): Promise<ReducedGraphState> {
  const { Command } = await import('@langchain/langgraph')
  const outputDir = getOutputDirFromStoryId(storyId)
  if (!outputDir) {
    throw new Error(`Story ${storyId} not found`)
  }

  const config: RunnableConfig = {
    configurable: { thread_id: storyId, outputDir },
  }

  const graph = buildNovelGraph()

  return await graph.invoke(
    new Command({
      goto: 'draft_chapter',
      update: {
        rewriteApproved,
        rewriteRequested: false,
        isWriting: true,
        writeOneChapterOnly: true,
      },
    }),
    config
  )
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
