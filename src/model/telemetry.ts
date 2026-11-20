import { AsyncLocalStorage } from 'node:async_hooks'
import type { ChapterModelUsage } from '../types/chapter-report.js'

export interface ModelCallMetadata {
  agent?: string
  chapterIndex?: number
  purpose?: string
  attempt?: number
  fallback?: boolean
}

export interface ModelUsage {
  inputTokens?: number | undefined
  outputTokens?: number | undefined
  totalTokens?: number | undefined
}

export interface ModelCallRecord {
  timestamp: string
  durationMs: number
  structured: boolean
  transportRetries: number
  metadata: ModelCallMetadata
  usage?: ModelUsage
  error?: string
}

export class ModelTelemetry {
  private readonly chapterContext = new AsyncLocalStorage<number>()
  private readonly records: ModelCallRecord[] = []

  record(record: ModelCallRecord): void {
    const ambientChapter = this.chapterContext.getStore()
    const metadata =
      ambientChapter !== undefined && record.metadata.chapterIndex === undefined
        ? { ...record.metadata, chapterIndex: ambientChapter }
        : record.metadata
    this.records.push({ ...record, metadata })
  }

  runWithChapter<T>(chapterIndex: number, operation: () => Promise<T>): Promise<T> {
    return this.chapterContext.run(chapterIndex, operation)
  }

  getRecords(): readonly ModelCallRecord[] {
    return this.records
  }

  summarizeChapter(chapterIndex: number): ChapterModelUsage {
    const records = this.records.filter((record) => record.metadata.chapterIndex === chapterIndex)
    const callsByPurpose: Record<string, number> = {}
    let failures = 0
    let structuredCalls = 0
    let fallbackCalls = 0
    let transportRetries = 0
    let inputTokens = 0
    let outputTokens = 0
    let totalTokens = 0
    let durationMs = 0
    let usageReportedCalls = 0

    for (const record of records) {
      const purpose = record.metadata.purpose ?? record.metadata.agent ?? 'unspecified'
      callsByPurpose[purpose] = (callsByPurpose[purpose] ?? 0) + 1
      if (record.error) failures++
      if (record.structured) structuredCalls++
      if (record.metadata.fallback) fallbackCalls++
      transportRetries += record.transportRetries
      durationMs += record.durationMs
      if (record.usage) {
        usageReportedCalls++
        inputTokens += record.usage.inputTokens ?? 0
        outputTokens += record.usage.outputTokens ?? 0
        totalTokens +=
          record.usage.totalTokens ??
          (record.usage.inputTokens ?? 0) + (record.usage.outputTokens ?? 0)
      }
    }

    return {
      calls: records.length,
      failures,
      structuredCalls,
      fallbackCalls,
      transportRetries,
      inputTokens,
      outputTokens,
      totalTokens,
      durationMs,
      usageReportedCalls,
      callsByPurpose,
    }
  }
}
