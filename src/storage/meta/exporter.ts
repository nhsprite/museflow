import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ReducedGraphState } from '../../graph/state.js'
import type { StoryMeta } from './index.js'
import { getCheckpointer } from '../../graph/checkpointer.js'
import { logger } from '../../utils/logger.js'

function writeFileAtomic(path: string, data: string): void {
  const tmpPath = `${path}.tmp`
  writeFileSync(tmpPath, data, 'utf-8')
  renameSync(tmpPath, path)
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
    logger.warn(`[MuseFlow] 读取现有 meta.json 失败: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

/**
 * Export the latest checkpoint state into meta.json.
 *
 * This function treats the LangGraph checkpoint as the single source of truth
 * for runtime state. `meta.json` is only a human-readable export view for CLI
 * commands and external inspection.
 */
export async function exportMetaFromCheckpoint(outputDir: string): Promise<void> {
  const checkpointer = getCheckpointer()
  const checkpoint = await checkpointer.getTuple({ configurable: { thread_id: '', outputDir } })

  if (!checkpoint) {
    logger.debug(`[MuseFlow] No checkpoint found at ${outputDir}, skipping meta export`)
    return
  }

  const state = checkpoint.checkpoint.channel_values as ReducedGraphState | undefined
  if (!state) {
    logger.debug('[MuseFlow] Checkpoint has no channel values, skipping meta export')
    return
  }

  const existing = readExistingMeta(outputDir)

  const meta: StoryMeta = {
    story: state.story,
    world: state.world,
    characters: state.characters,
    outline: state.outline,
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
    contextSnapshot: null,
    timeline: existing?.timeline ?? [],
    foreshadowStack: state.foreshadowStack,
    foreshadowAlerts: [],
    storyState: state.storyState,
  }

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true })
  }

  writeFileAtomic(getMetaPath(outputDir), JSON.stringify(meta, null, 2))
  logger.debug(`[MuseFlow] Exported meta.json from checkpoint: ${outputDir}`)
}
