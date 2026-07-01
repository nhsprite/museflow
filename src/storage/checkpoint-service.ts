import { readFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { logger } from '../utils/logger.js'
import { writeFileAtomic, ensureDir } from '../utils/fs.js'
import type { ReducedGraphState } from '../graph/state.js'
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
    checkpointer?: BaseCheckpointSaver<string>,
  ) {
    this.checkpointer = checkpointer ?? getCheckpointer()
  }

  private getCheckpointDir(): string {
    return join(this.outputDir, 'checkpoints')
  }

  private getMarkersPath(): string {
    return join(this.getCheckpointDir(), 'chapter_markers.json')
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

  async saveChapterMarker(
    chapterNumber: number,
    checkpointId: string
  ): Promise<void> {
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

  async pruneIntermediateCheckpoints(): Promise<void> {
    const dir = this.getCheckpointDir()
    if (!existsSync(dir)) return

    const markers = await this.loadMarkers()
    const preservedIds = new Set(Object.values(markers))

    const files = readdirSync(dir).filter(
      f => f.endsWith('.json') && f !== 'pending_writes.json' && f !== 'chapter_markers.json'
    )

    const toDelete = files.filter(f => !preservedIds.has(f.slice(0, -5)))
    for (const file of toDelete) {
      unlinkSync(join(dir, file))
      logger.debug(`Pruned intermediate checkpoint: ${file}`)
    }

    logger.debug(
      `Pruned ${toDelete.length} intermediate checkpoints, kept ${preservedIds.size} chapter markers`
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
    const mergedValues = { ...channelValues, ...partialState }
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

  async getTuple(config: RunnableConfig): Promise<ReturnType<BaseCheckpointSaver<string>['getTuple']>> {
    return this.checkpointer.getTuple(config)
  }
}

export function createCheckpointService(
  outputDir: string,
  checkpointer?: BaseCheckpointSaver<string>,
): StoryCheckpointService {
  return new StoryCheckpointService(outputDir, checkpointer)
}
