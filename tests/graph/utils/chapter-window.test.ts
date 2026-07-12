import { describe, expect, it } from 'vitest'
import {
  extractChapterEndingParagraphs,
  hasDuplicateEndingParagraphs,
} from '../../../src/graph/utils/chapter-window.js'

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
})
