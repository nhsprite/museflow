import type { JsonSchema, Message } from '../../src/model/provider.js'

/** Existing integration scenarios stub the new model tasks, not the audit service or its gates. */
export function passingNarrativeAuditResponse(messages: Message[], schema: JsonSchema): unknown {
  if (Object.hasOwn(schema.properties, 'facts')) return { facts: [] }
  if (!Object.hasOwn(schema.properties, 'progress')) return undefined
  const input = JSON.parse(messages[1]!.content)
  return {
    coverage: [],
    findings: [],
    progress: input.chapters.map((chapter: { chapterIndex: number }) => ({
      chapterIndex: chapter.chapterIndex,
      verdict: 'advancing',
      dimensions: ['information'],
      evidenceParagraphs: [0],
      explanation: '固定模型回答：本场景不测试叙事停滞。',
    })),
  }
}

/** 固定复核结论仅测试管线；真实语义准确性由 live eval 度量。 */
export function confirmingContradictionResponse(messages: Message[]): unknown {
  const input = JSON.parse(messages[1]!.content)
  return {
    assessments: input.candidates.map((candidate: any) => ({
      findingIndex: candidate.findingIndex,
      checks: {
        sameSubject: 'yes',
        sameAttribute: 'yes',
        comparableTime: 'yes',
        establishedPremise: 'yes',
        incompatibleClaims: 'yes',
        resolutionAbsent: 'yes',
      },
      evidence: candidate.evidence,
      recordIndexes: candidate.recordIndexes,
      explanation: '固定复核结论：证据互斥。',
    })),
  }
}
