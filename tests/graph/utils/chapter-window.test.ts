import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildPreviousChapterEndingContext,
  extractChapterEndingParagraphs,
  hasDuplicateEndingParagraphs,
} from '../../../src/graph/utils/chapter-window.js'
import type { ReducedGraphState } from '../../../src/graph/state.js'

describe('chapter-window', () => {
  describe('extractChapterEndingParagraphs', () => {
    it('returns the last N non-heading paragraphs', () => {
      const content = `# 第一章

第一段。

第二段。

第三段。

第四段。`
      const result = extractChapterEndingParagraphs(content, 2)
      expect(result).toEqual(['第三段。', '第四段。'])
    })

    it('returns fewer paragraphs when content has fewer than N', () => {
      const content = `# 第一章\n\n只有一段。`
      const result = extractChapterEndingParagraphs(content, 2)
      expect(result).toEqual(['只有一段。'])
    })
  })

  describe('hasDuplicateEndingParagraphs', () => {
    it('detects identical last paragraphs', () => {
      const previous = `# 第一章\n\n第一段。\n\n重复的结尾。`
      const current = `# 第二章\n\n新的内容。\n\n重复的结尾。`
      const result = hasDuplicateEndingParagraphs(previous, current)
      expect(result.duplicate).toBe(true)
      expect(result.paragraph).toBe('重复的结尾。')
    })

    it('returns false when endings differ', () => {
      const previous = `# 第一章\n\n第一段。\n\n上一章结尾。`
      const current = `# 第二章\n\n新的内容。\n\n本章结尾。`
      const result = hasDuplicateEndingParagraphs(previous, current)
      expect(result.duplicate).toBe(false)
      expect(result.paragraph).toBeUndefined()
    })

    it('detects duplicates within the last N paragraphs, not only the very last', () => {
      const previous = `# 第一章\n\nA\n\nB\n\nC`
      const current = `# 第二章\n\nX\n\nY\n\nB`
      const result = hasDuplicateEndingParagraphs(previous, current, 2)
      expect(result.duplicate).toBe(true)
      expect(result.paragraph).toBe('B')
    })

    it('ignores empty paragraphs', () => {
      const previous = `# 第一章\n\n`
      const current = `# 第二章\n\n`
      const result = hasDuplicateEndingParagraphs(previous, current)
      expect(result.duplicate).toBe(false)
    })
  })

  describe('buildPreviousChapterEndingContext sanitization', () => {
    let storyDir: string

    beforeEach(() => {
      storyDir = mkdtempSync(join(tmpdir(), 'museflow-chapter-window-'))
      mkdirSync(join(storyDir, 'chapters'), { recursive: true })
    })

    afterEach(() => {
      rmSync(storyDir, { recursive: true, force: true })
    })

    function makeState(): ReducedGraphState {
      return {
        story: { id: 'story-1', title: 'Story', outputDir: storyDir },
        totalChapters: 10,
        storyArc: null,
        storyMemory: {
          version: '3',
          lastChapterIndex: 0,
          entities: {
            characters: { 'c-25': { id: 'c-25', name: '殷温娇' } },
            items: {},
            locations: {},
            factions: {},
            plots: {},
          },
          events: [],
          foreshadows: {},
          beats: {},
          tasks: {},
        },
      } as unknown as ReducedGraphState
    }

    it('strips protocol residue and identifier parentheticals before re-feeding', async () => {
      writeFileSync(
        join(storyDir, 'chapters', 'chapter_1.md'),
        `# 第1章 进京\n\n${'夜色渐深，更鼓声远远传来。'.repeat(30)}\n\n=== STORY_EVENTS ===\n- character-location: c-25 -> l-1 @p1\n\n殷温娇（c-25）吹灭了灯。`,
        'utf-8'
      )

      const context = await buildPreviousChapterEndingContext(makeState(), 1)

      expect(context).toContain('【上一章结尾片段】')
      expect(context).not.toContain('STORY_EVENTS')
      expect(context).not.toContain('character-location')
      expect(context).not.toContain('（c-25）')
      expect(context).toContain('殷温娇吹灭了灯')
    })

    it('returns the ending as-is when there is nothing to strip', async () => {
      writeFileSync(
        join(storyDir, 'chapters', 'chapter_1.md'),
        `# 第1章 进京\n\n${'夜色渐深，更鼓声远远传来。'.repeat(30)}\n\n殷温娇吹灭了灯。`,
        'utf-8'
      )

      const context = await buildPreviousChapterEndingContext(makeState(), 1)

      expect(context).toContain('殷温娇吹灭了灯')
    })

    it('returns empty string for the first chapter', async () => {
      expect(await buildPreviousChapterEndingContext(makeState(), 0)).toBe('')
    })
  })
})
