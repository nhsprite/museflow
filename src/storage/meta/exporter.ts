import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { StoryMeta } from './index.js'
import type { Story } from '../../types/story.js'
import type { Character } from '../../types/character.js'
import type { ChapterMeta } from '../../types/chapter.js'
import type { WorldContent } from '../../types/world.js'
import type { ChapterOutline, StoryArc } from '../../types/outline.js'
import type { ForeshadowItem } from '../../types/foreshadow.js'
import type { StoryState } from '../../types/story-state.js'
import type { StateSnapshot } from '../../types/timeline.js'
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint'
import { getCheckpointer } from '../../graph/checkpointer.js'
import { logger } from '../../utils/logger.js'
import { writeFileAtomic, ensureDir } from '../../utils/fs.js'

interface CheckpointState {
  story: Story
  world: WorldContent | null
  characters: Character[]
  outline: ChapterOutline[]
  storyArc: StoryArc | null
  actProgress: Record<number, { consumed: string[]; pending: string[] }>
  chapters: (ChapterMeta | null)[]
  foreshadowStack: ForeshadowItem[]
  timeline?: StateSnapshot[] | undefined
  storyState: StoryState
}

function getMetaPath(outputDir: string): string {
  return join(outputDir, 'meta.json')
}

function readExistingMeta(outputDir: string): StoryMeta | null {
  const path = getMetaPath(outputDir)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as StoryMeta
  } catch (err) {
    logger.warn(
      `[MuseFlow] 读取现有 meta.json 失败: ${err instanceof Error ? err.message : String(err)}`
    )
    return null
  }
}

async function loadLatestCheckpointState(
  outputDir: string,
  checkpointer?: BaseCheckpointSaver<string>
): Promise<CheckpointState | undefined> {
  const resolved = checkpointer ?? getCheckpointer()
  const checkpoint = await resolved.getTuple({ configurable: { thread_id: '', outputDir } })

  if (checkpoint) {
    return checkpoint.checkpoint.channel_values as unknown as CheckpointState | undefined
  }

  // Fallback: read latest.json and the referenced checkpoint file directly.
  // This avoids depending on the checkpointer's thread_id -> outputDir mapping,
  // which is only populated after a graph invocation has run.
  const checkpointsDir = join(outputDir, 'checkpoints')
  const latestPath = join(checkpointsDir, 'latest.json')
  if (!existsSync(latestPath)) return undefined

  try {
    const latest = JSON.parse(readFileSync(latestPath, 'utf-8')) as { checkpointId?: string }
    if (!latest.checkpointId) return undefined

    const checkpointPath = join(checkpointsDir, `${latest.checkpointId}.json`)
    if (!existsSync(checkpointPath)) return undefined

    const record = JSON.parse(readFileSync(checkpointPath, 'utf-8')) as {
      checkpoint?: { channel_values?: unknown }
    }
    return record.checkpoint?.channel_values as CheckpointState | undefined
  } catch (err) {
    logger.warn(
      `[MuseFlow] 读取 checkpoint 失败: ${err instanceof Error ? err.message : String(err)}`
    )
    return undefined
  }
}

/**
 * Export the latest checkpoint state into meta.json.
 *
 * This function treats the LangGraph checkpoint as the single source of truth
 * for runtime state. `meta.json` is only a human-readable export view for CLI
 * commands and external inspection.
 */
export async function exportMetaFromCheckpoint(
  outputDir: string,
  checkpointer?: BaseCheckpointSaver<string>
): Promise<void> {
  const state = await loadLatestCheckpointState(outputDir, checkpointer)

  if (!state) {
    logger.debug(`[MuseFlow] No checkpoint found at ${outputDir}, skipping meta export`)
    return
  }

  const existing = readExistingMeta(outputDir)

  const meta: StoryMeta = {
    story: state.story,
    world: state.world,
    characters: state.characters,
    outline: state.outline,
    actProgress: state.actProgress,
    chapters: state.chapters.map((ch, idx) => {
      if (ch) return ch
      const outlineItem = state.outline[idx]
      return {
        id: `ch_${idx + 1}`,
        storyId: state.story.id,
        number: idx + 1,
        title: outlineItem?.title ?? null,
        outline: outlineItem?.description ?? null,
        summary: null,
        foreshadows: null,
        status: 'outline' as const,
        createdAt: existing?.story.createdAt ?? Date.now(),
        updatedAt: Date.now(),
      }
    }),
    timeline: state.timeline ?? existing?.timeline ?? [],
    foreshadowStack: state.foreshadowStack,
    foreshadowAlerts: [],
    storyState: state.storyState,
  }

  if (state.storyArc) {
    meta.storyArc = state.storyArc
  }

  ensureDir(outputDir)
  writeFileAtomic(getMetaPath(outputDir), JSON.stringify(meta, null, 2))
  logger.debug(`[MuseFlow] Exported meta.json from checkpoint: ${outputDir}`)
}
