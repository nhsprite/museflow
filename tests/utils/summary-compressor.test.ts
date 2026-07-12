import { describe, expect, it } from 'vitest'
import { buildLayeredSummaries } from '../../src/utils/summary-compressor.js'

function buildSummaries(summary: string): string[] {
  return [summary]
}

describe('buildLayeredSummaries legacy text truncation', () => {
  it('truncates medium summaries at sentence boundaries instead of mid-sentence', () => {
    // distance 5 => medium（限额 100 字）
    const firstSentence = `${'风'.repeat(79)}。`
    const summary = `${firstSentence}${'雨'.repeat(80)}。`

    const result = buildLayeredSummaries(buildSummaries(summary), 5)

    expect(result).toContain('第1章[略]：')
    const compressed = result.replace(/^第1章\[略\]：/, '')
    expect(compressed.endsWith('。')).toBe(true)
    expect(compressed).not.toContain('...')
    expect(compressed.length).toBeLessThanOrEqual(100)
    expect(compressed).toBe(firstSentence)
  })

  it('keeps minimal summaries up to the raised 80-char limit intact', () => {
    // distance 10 => minimal（限额 80 字）
    const summary = '山'.repeat(60)

    const result = buildLayeredSummaries(buildSummaries(summary), 10)

    const compressed = result.replace(/^第1章\[概\]：/, '')
    expect(compressed).toBe(summary)
  })

  it('truncates minimal summaries at sentence boundaries within the 80-char limit', () => {
    const firstSentence = `${'水'.repeat(60)}。`
    const summary = `${firstSentence}${'火'.repeat(60)}。`

    const result = buildLayeredSummaries(buildSummaries(summary), 10)

    const compressed = result.replace(/^第1章\[概\]：/, '')
    expect(compressed).toBe(firstSentence)
    expect(compressed.length).toBeLessThanOrEqual(80)
  })

  it('falls back to hard truncation with ellipsis when no boundary is available', () => {
    const summary = '雾'.repeat(150)

    const result = buildLayeredSummaries(buildSummaries(summary), 5)

    const compressed = result.replace(/^第1章\[略\]：/, '')
    expect(compressed.endsWith('...')).toBe(true)
    expect(compressed.length).toBe(103)
  })
})
