import { describe, expect, it } from 'vitest'
import { ModelTelemetry } from '../../src/model/telemetry.js'

describe('ModelTelemetry', () => {
  it('summarizes calls, retries, fallbacks and token usage for a chapter', async () => {
    const telemetry = new ModelTelemetry()

    await telemetry.runWithChapter(2, async () => {
      telemetry.record({
        timestamp: new Date().toISOString(),
        durationMs: 120,
        structured: true,
        transportRetries: 1,
        metadata: { purpose: 'chapter' },
        usage: { inputTokens: 100, outputTokens: 40, totalTokens: 140 },
      })
      telemetry.record({
        timestamp: new Date().toISOString(),
        durationMs: 80,
        structured: false,
        transportRetries: 0,
        metadata: { purpose: 'chapter', fallback: true },
        usage: { inputTokens: 60, outputTokens: 20 },
      })
    })
    telemetry.record({
      timestamp: new Date().toISOString(),
      durationMs: 10,
      structured: false,
      transportRetries: 0,
      metadata: { chapterIndex: 1, purpose: 'other-chapter' },
    })

    expect(telemetry.summarizeChapter(2)).toEqual({
      calls: 2,
      failures: 0,
      structuredCalls: 1,
      fallbackCalls: 1,
      transportRetries: 1,
      inputTokens: 160,
      outputTokens: 60,
      totalTokens: 220,
      durationMs: 200,
      usageReportedCalls: 2,
      callsByPurpose: { chapter: 2 },
    })
  })

  it('keeps failed calls visible in the chapter summary', () => {
    const telemetry = new ModelTelemetry()
    telemetry.record({
      timestamp: new Date().toISOString(),
      durationMs: 30,
      structured: true,
      transportRetries: 2,
      metadata: { chapterIndex: 0, agent: 'summary' },
      error: 'request failed',
    })

    expect(telemetry.summarizeChapter(0)).toMatchObject({
      calls: 1,
      failures: 1,
      structuredCalls: 1,
      transportRetries: 2,
      usageReportedCalls: 0,
      callsByPurpose: { summary: 1 },
    })
  })
})
