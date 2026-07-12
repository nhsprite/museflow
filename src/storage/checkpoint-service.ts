import { readFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { logger } from '../utils/logger.js'
import { writeFileAtomic, ensureDir } from '../utils/fs.js'
import type { ReducedGraphState } from '../graph/state.js'
import type { BlockingReport } from '../types/blocking-report.js'
import { getCheckpointer } from '../graph/checkpointer.js'
import type { Checkpoint, BaseCheckpointSaver } from '@langchain/langgraph-checkpoint'
import type { RunnableConfig } from '@langchain/core/runnables'

/**
 * 业务级 checkpoint 服务。
 *
 * 负责故事级别的 checkpoint 操作（章节标记、清理中间态、图外状态更新），
 * 而 `JsonCheckpointer` 只保留 LangGraph 的 checkpoint saver 契约。
 */
export class StoryCheckpointService {
  private checkpointer: BaseCheckpointSaver<string>

  constructor(
    private outputDir: string,
    checkpointer?: BaseCheckpointSaver<string>
  ) {
    this.checkpointer = checkpointer ?? getCheckpointer()
  }

  private getCheckpointDir(): string {
    return join(this.outputDir, 'checkpoints')
  }

  private getMarkersPath(): string {
    return join(this.getCheckpointDir(), 'chapter_markers.json')
  }

  private getLatestPath(): string {
    return join(this.getCheckpointDir(), 'latest.json')
  }

  private getReportsDir(): string {
    return join(this.outputDir, 'reports')
  }

  private getBlockingReportPath(reportId: string): string {
    return join(this.getReportsDir(), `blocking_${reportId}.json`)
  }

  private async loadMarkers(): Promise<Record<number, string>> {
    const path = this.getMarkersPath()
    if (!existsSync(path)) return {}
    try {
      const raw = readFileSync(path, 'utf-8')
      return JSON.parse(raw) as Record<number, string>
    } catch {
      return {}
    }
  }

  private async saveMarkers(markers: Record<number, string>): Promise<void> {
    ensureDir(this.getCheckpointDir())
    writeFileAtomic(this.getMarkersPath(), JSON.stringify(markers, null, 2))
  }

  private loadLatestCheckpointId(): string | undefined {
    const path = this.getLatestPath()
    if (!existsSync(path)) return undefined
    try {
      const value = JSON.parse(readFileSync(path, 'utf-8')) as { checkpointId?: unknown }
      return typeof value.checkpointId === 'string' ? value.checkpointId : undefined
    } catch {
      return undefined
    }
  }

  async saveChapterMarker(chapterNumber: number, checkpointId: string): Promise<void> {
    const markers = await this.loadMarkers()
    markers[chapterNumber] = checkpointId
    await this.saveMarkers(markers)
    logger.debug(`Chapter marker saved: ${chapterNumber} -> ${checkpointId}`)
  }

  async getChapterMarker(chapterNumber: number): Promise<string | undefined> {
    const markers = await this.loadMarkers()
    return markers[chapterNumber]
  }

  async listChapterMarkers(): Promise<{ chapterNumber: number; checkpointId: string }[]> {
    const markers = await this.loadMarkers()
    return Object.entries(markers)
      .map(([chapterNumber, checkpointId]) => ({
        chapterNumber: parseInt(chapterNumber, 10),
        checkpointId,
      }))
      .sort((a, b) => a.chapterNumber - b.chapterNumber)
  }

  /**
   * 删除 chapterNumber 之后的所有章节标记（rewrite 倒带时使用）。
   * 被重写章节本身的标记会在下一次 commit 时被 saveChapterMarker 覆盖。
   */
  async deleteChapterMarkersFrom(chapterNumber: number): Promise<void> {
    const markers = await this.loadMarkers()
    const remainingEntries = Object.entries(markers).filter(
      ([key]) => parseInt(key, 10) <= chapterNumber
    )
    if (remainingEntries.length === Object.keys(markers).length) return
    await this.saveMarkers(Object.fromEntries(remainingEntries))
    logger.debug(`Chapter markers after ${chapterNumber} deleted`)
  }

  async pruneIntermediateCheckpoints(): Promise<void> {
    const dir = this.getCheckpointDir()
    if (!existsSync(dir)) return

    const markers = await this.loadMarkers()
    const preservedIds = new Set(Object.values(markers))
    const latestCheckpointId = this.loadLatestCheckpointId()
    if (latestCheckpointId) {
      preservedIds.add(latestCheckpointId)
    }

    const files = readdirSync(dir).filter(
      (f) =>
        f.endsWith('.json') &&
        f !== 'pending_writes.json' &&
        f !== 'chapter_markers.json' &&
        f !== 'latest.json'
    )

    const toDelete = files.filter((f) => !preservedIds.has(f.slice(0, -5)))
    for (const file of toDelete) {
      unlinkSync(join(dir, file))
      logger.debug(`Pruned intermediate checkpoint: ${file}`)
    }

    logger.debug(
      `Pruned ${toDelete.length} intermediate checkpoints, kept ${preservedIds.size} protected checkpoints`
    )
  }

  /**
   * 在最新 checkpoint 上直接合并部分状态字段，用于图外应用作者裁决。
   * 原 checkpoint 文件保留，通过生成新 id 实现安全回滚。
   */
  async updateLatestState(partialState: Partial<ReducedGraphState>): Promise<void> {
    const tuple = await this.checkpointer.getTuple({
      configurable: { thread_id: '', outputDir: this.outputDir },
    })
    if (!tuple) {
      throw new Error('No latest checkpoint found')
    }

    const channelValues = tuple.checkpoint.channel_values as ReducedGraphState
    // storyMemory is part of ReducedGraphState, so it is preserved unless the
    // caller explicitly provides a new value in partialState.
    const mergedValues: ReducedGraphState = { ...channelValues, ...partialState }
    const newCheckpointId = randomUUID()

    const newCheckpoint: Checkpoint = {
      ...tuple.checkpoint,
      id: newCheckpointId,
      channel_values: mergedValues,
    }

    const config: RunnableConfig = {
      configurable: {
        thread_id: '',
        outputDir: this.outputDir,
        checkpoint_id: tuple.checkpoint.id as string,
      },
    }

    const metadata = tuple.metadata ?? {
      source: 'update' as const,
      step: -1,
      parents: {},
    }
    await this.checkpointer.put(config, newCheckpoint, metadata, {})
    logger.debug(`Checkpoint updated via author decision: ${newCheckpointId}`)
  }

  async clearPendingWrites(): Promise<void> {
    const path = join(this.getCheckpointDir(), 'pending_writes.json')
    if (existsSync(path)) {
      unlinkSync(path)
      logger.debug(`Cleared pending writes: ${path}`)
    }
  }

  async getTuple(
    config: RunnableConfig
  ): Promise<ReturnType<BaseCheckpointSaver<string>['getTuple']>> {
    return this.checkpointer.getTuple(config)
  }

  /**
   * 基于已有 checkpoint 创建一个新 checkpoint，并合并部分状态字段。
   * 返回新 checkpoint 的 id。这用于 adjust-act 等需要同步更新章节标记的场景。
   */
  async createDerivedCheckpoint(
    baseCheckpointId: string,
    partialState: Partial<ReducedGraphState>,
    source: 'input' | 'update' | 'loop' | 'fork' = 'update'
  ): Promise<string> {
    const tuple = await this.checkpointer.getTuple({
      configurable: {
        thread_id: '',
        outputDir: this.outputDir,
        checkpoint_id: baseCheckpointId,
      },
    })
    if (!tuple) {
      throw new Error(`Base checkpoint ${baseCheckpointId} not found`)
    }

    const mergedValues: ReducedGraphState = {
      ...(tuple.checkpoint.channel_values as ReducedGraphState),
      ...partialState,
    }
    const newCheckpointId = randomUUID()
    const newCheckpoint: Checkpoint = {
      ...tuple.checkpoint,
      id: newCheckpointId,
      channel_values: mergedValues,
    }

    const config: RunnableConfig = {
      configurable: {
        thread_id: '',
        outputDir: this.outputDir,
        checkpoint_id: baseCheckpointId,
      },
    }
    const metadata = tuple.metadata ?? {
      source,
      step: -1,
      parents: {},
    }
    await this.checkpointer.put(config, newCheckpoint, metadata, {})
    logger.debug(`Derived checkpoint created: ${baseCheckpointId} -> ${newCheckpointId}`)
    return newCheckpointId
  }

  async saveBlockingReport(report: BlockingReport): Promise<void> {
    ensureDir(this.getReportsDir())
    const path = this.getBlockingReportPath(report.id)
    writeFileAtomic(path, JSON.stringify(report, null, 2))
    logger.info(`[MuseFlow] 阻断报告已保存: ${path}`)
  }

  async listBlockingReports(): Promise<BlockingReport[]> {
    const dir = this.getReportsDir()
    if (!existsSync(dir)) return []

    const files = readdirSync(dir).filter((f) => f.startsWith('blocking_') && f.endsWith('.json'))
    const reports: BlockingReport[] = []
    for (const file of files) {
      try {
        const raw = readFileSync(join(dir, file), 'utf-8')
        reports.push(JSON.parse(raw) as BlockingReport)
      } catch {
        logger.warn(`[MuseFlow] 无法读取阻断报告: ${file}`)
      }
    }
    return reports.sort((a, b) => b.createdAt - a.createdAt)
  }

  async getLatestBlockingReport(): Promise<BlockingReport | null> {
    const reports = await this.listBlockingReports()
    return reports[0] ?? null
  }
}

export function createCheckpointService(
  outputDir: string,
  checkpointer?: BaseCheckpointSaver<string>
): StoryCheckpointService {
  return new StoryCheckpointService(outputDir, checkpointer)
}
