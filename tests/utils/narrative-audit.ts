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
