#!/usr/bin/env tsx
/**
 * 修复历史章节正文中的体例残留（确定性车道可机械移除的部分）。
 *
 * 问题根因：早期版本缺少正文体例门禁，生成协议残留（=== STORY_EVENTS === 区块、
 * 事件行、STORY_FINAL_STATE 区块）与内部标识符括号注释（如 `殷温娇（c-25）`）
 * 可能直接落入 chapters/*.md 并随导出发布。
 *
 * 本脚本（数据完整性规则：books/ 下的数据修复必须走代码通道）：
 * 1. 从 story-memory.json 加载已知标识符集合（实体/伏笔/任务/节拍 id）；
 * 2. 对 chapters/*.md 机械剥离协议残留与标识符括号注释，重写章节文件；
 * 3. 不能机械移除的残留（裸标识符、章节自指等 error 级 issue）只报告，不修改；
 * 4. advisory 车道问题（自我修正、占位符、重字、作者腔）属自然语言现象，
 *    本脚本不检测不修复，由 consistency.prose-artifact 车道处理；
 * 5. 修复完成后重新导出 meta 投影。
 *
 * 用法：
 *   npx tsx scripts/repair-chapter-prose.ts <story-dir>
 *   npx tsx scripts/repair-chapter-prose.ts <story-dir> --dry-run
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, renameSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { exportMetaFromCheckpoint } from '../src/storage/meta/exporter.js'
import {
  buildProseHygieneContext,
  checkProseHygiene,
  formatProseHygieneIssue,
  sanitizeProseExcerpt,
  type ProseHygieneIssue,
} from '../src/graph/services/prose-hygiene/index.js'
import type { StoryMemory } from '../src/types/story-memory.js'

export interface ChapterRepairResult {
  chapterNumber: number
  changed: boolean
  remainingIssues: ProseHygieneIssue[]
}

function loadStoryMemory(storyDir: string): StoryMemory | null {
  const memoryPath = join(storyDir, 'story-memory.json')
  if (!existsSync(memoryPath)) return null
  return JSON.parse(readFileSync(memoryPath, 'utf-8')) as StoryMemory
}

function listChapterFiles(storyDir: string): Array<{ chapterNumber: number; path: string }> {
  const chaptersDir = join(storyDir, 'chapters')
  if (!existsSync(chaptersDir)) return []
  return readdirSync(chaptersDir)
    .map((name) => {
      const match = /^chapter_(\d+)\.md$/.exec(name)
      return match
        ? { chapterNumber: Number.parseInt(match[1]!, 10), path: join(chaptersDir, name) }
        : null
    })
    .filter((entry): entry is { chapterNumber: number; path: string } => entry !== null)
    .sort((a, b) => a.chapterNumber - b.chapterNumber)
}

function writeFileAtomic(path: string, content: string): void {
  const tmpPath = `${path}.tmp`
  writeFileSync(tmpPath, content, 'utf-8')
  renameSync(tmpPath, path)
}

export async function repairChapterProse(
  storyDir: string,
  dryRun: boolean
): Promise<ChapterRepairResult[]> {
  const memory = loadStoryMemory(storyDir)
  if (!memory) {
    console.warn(`[repair-chapter-prose] ${storyDir} 缺少 story-memory.json，标识符集合为空。`)
  }

  const chapterFiles = listChapterFiles(storyDir)
  if (chapterFiles.length === 0) {
    console.log(`[repair-chapter-prose] ${storyDir} 下没有章节文件，无需处理。`)
    return []
  }

  const totalChapters = chapterFiles[chapterFiles.length - 1]!.chapterNumber
  const results: ChapterRepairResult[] = []

  for (const { chapterNumber, path } of chapterFiles) {
    const original = readFileSync(path, 'utf-8')
    const ctx = buildProseHygieneContext({
      storyMemory: memory,
      chapterNumber,
      totalChapters,
    })

    const sanitized = sanitizeProseExcerpt(original, ctx)
    // sanitize 输出经过 trim；与 trim 后的原文比较，避免仅结尾换行差异误判为修复。
    const changed = sanitized !== original.trim()
    const remainingIssues = checkProseHygiene(sanitized, ctx).filter(
      (issue) => issue.severity === 'error'
    )

    if (changed && !dryRun) {
      writeFileAtomic(path, sanitized + '\n')
    }
    results.push({ chapterNumber, changed, remainingIssues })
  }

  const changedChapters = results.filter((r) => r.changed)
  const contaminatedChapters = results.filter((r) => r.remainingIssues.length > 0)

  console.log(
    `[repair-chapter-prose] ${dryRun ? '（dry-run，未写入）' : ''}共扫描 ${results.length} 章：` +
      `${changedChapters.length} 章含可机械移除残留，${contaminatedChapters.length} 章含需人工处理残留。`
  )
  for (const { chapterNumber } of changedChapters) {
    console.log(`  - 第 ${chapterNumber} 章：已剥离协议残留/标识符括号注释`)
  }
  for (const { chapterNumber, remainingIssues } of contaminatedChapters) {
    console.log(`  - 第 ${chapterNumber} 章：${remainingIssues.length} 处残留需人工处理：`)
    for (const issue of remainingIssues.slice(0, 10)) {
      console.log(`      ${formatProseHygieneIssue(issue)}`)
    }
  }

  if (!dryRun && changedChapters.length > 0) {
    try {
      await exportMetaFromCheckpoint(storyDir)
      console.log('[repair-chapter-prose] meta 投影已重新导出。')
    } catch (err) {
      console.warn(
        `[repair-chapter-prose] meta 投影导出失败（章节文件已修复）：${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  return results
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    console.error('用法：npx tsx scripts/repair-chapter-prose.ts <story-dir> [--dry-run]')
    process.exit(1)
  }
  const storyDir = resolve(args[0]!)
  await repairChapterProse(storyDir, args.includes('--dry-run'))
}

const isMain = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false
if (isMain) {
  await main()
}
