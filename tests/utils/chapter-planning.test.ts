import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenreSkill } from '../../src/types/genre.js'

const createSkill = (chapterPlanning: GenreSkill['chapterPlanning']): GenreSkill => ({
  name: 'custom',
  displayName: 'Custom',
  version: '1.0.0',
  worldbuildingPrompt: '',
  chapterPromptSupplement: '',
  tropes: [],
  chapterPlanning,
})

describe('chapter planning config', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('merges centralized narrative policy overrides from the genre skill', async () => {
    const skill = createSkill({
      storyActCountMin: 2,
      storyActCountMax: 7,
      chapterWordCountToleranceRatio: 0.05,
      bookClosingPhaseRatio: 0.1,
      actClosingPhaseRatio: 0.25,
      maxAutoFixAttempts: 4,
      maxStateRepairAttempts: 1,
      rewriteStallSimilarityThreshold: 0.8,
      rewriteStallMinRounds: 4,
      actBoundaryAutoAdjustmentMaxChapters: 2,
      actBoundaryAutoAdjustmentMaxCumulativeChapters: 4,
      actBoundaryAutoAdjustmentMaxGlobalRatio: 0.08,
    })
    vi.doMock('../../src/genres/registry.js', () => ({
      getGenreSkill: () => skill,
    }))

    const { getChapterPlanningConfig } = await import('../../src/utils/chapter-planning.js')

    expect(getChapterPlanningConfig('custom')).toMatchObject({
      storyActCountMin: 2,
      storyActCountMax: 7,
      chapterWordCountToleranceRatio: 0.05,
      bookClosingPhaseRatio: 0.1,
      actClosingPhaseRatio: 0.25,
      maxAutoFixAttempts: 4,
      maxStateRepairAttempts: 1,
      rewriteStallSimilarityThreshold: 0.8,
      rewriteStallMinRounds: 4,
      actBoundaryAutoAdjustmentMaxChapters: 2,
      actBoundaryAutoAdjustmentMaxCumulativeChapters: 4,
      actBoundaryAutoAdjustmentMaxGlobalRatio: 0.08,
    })
  })

  it('provides defaults for every centralized narrative policy', async () => {
    vi.doMock('../../src/genres/registry.js', () => ({
      getGenreSkill: () => null,
    }))

    const { getChapterPlanningConfig } = await import('../../src/utils/chapter-planning.js')

    expect(getChapterPlanningConfig('missing')).toMatchObject({
      storyActCountMin: 3,
      storyActCountMax: 5,
      chapterWordCountToleranceRatio: 0.1,
      bookClosingPhaseRatio: 0.15,
      actClosingPhaseRatio: 0.2,
      maxAutoFixAttempts: 3,
      maxStateRepairAttempts: 2,
      rewriteStallSimilarityThreshold: 0.7,
      rewriteStallMinRounds: 3,
      maxErrorRewriteAttempts: 3,
      actBoundaryAutoAdjustmentMaxChapters: 3,
      actBoundaryAutoAdjustmentMaxCumulativeChapters: 3,
      actBoundaryAutoAdjustmentMaxGlobalRatio: 0.15,
    })
  })
})
