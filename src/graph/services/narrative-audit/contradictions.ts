import { z } from 'zod'
import type { ModelProvider, JsonSchema } from '../../../model/provider.js'
import { CONTRADICTION_CHECKS } from '../../../types/narrative-audit.js'
import type {
  NarrativeAuditRecord,
  NarrativeFinding,
  ContradictionReview,
} from '../../../types/narrative-audit.js'
import { CONTRADICTION_REVIEW_PROMPT } from '../../../agents/prompts/narrative-audit-prompt.js'
import { runRequiredChapterCheck } from '../../../utils/chapter-validation-error.js'
import { callAudit } from './model-call.js'

const index = z.number().int().nonnegative()
const answer = z.enum(['yes', 'no', 'uncertain'])
const checksSchema = z
  .object({
    sameSubject: answer,
    sameAttribute: answer,
    comparableTime: answer,
    establishedPremise: answer,
    incompatibleClaims: answer,
    resolutionAbsent: answer,
  })
  .strict()
const schema = z
  .object({
    assessments: z.array(
      z
        .object({
          findingIndex: index,
          checks: checksSchema,
          evidence: z
            .array(z.object({ chapterIndex: index, paragraphIndex: index }).strict())
            .min(1),
          recordIndexes: z.array(index),
          explanation: z.string().trim().min(1),
        })
        .strict()
    ),
  })
  .strict()
const integer = { type: 'integer', minimum: 0 }
const object = (properties: Record<string, unknown>) => ({
  type: 'object' as const,
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
})
const jsonSchema: JsonSchema = object({
  assessments: {
    type: 'array',
    items: object({
      findingIndex: integer,
      checks: object(
        Object.fromEntries(
          CONTRADICTION_CHECKS.map((key) => [
            key,
            { type: 'string', enum: ['yes', 'no', 'uncertain'] },
          ])
        )
      ),
      evidence: {
        type: 'array',
        minItems: 1,
        items: object({ chapterIndex: integer, paragraphIndex: integer }),
      },
      recordIndexes: { type: 'array', items: integer },
      explanation: { type: 'string', minLength: 1 },
    }),
  },
})

export interface IndexedAuditChapter {
  chapterIndex: number
  paragraphs: Array<{ paragraphIndex: number; text: string }>
}

export function contradictionVerdict(
  checks: ContradictionReview['checks']
): ContradictionReview['verdict'] {
  if (CONTRADICTION_CHECKS.some((key) => checks[key] === 'no')) return 'rejected'
  return CONTRADICTION_CHECKS.every((key) => checks[key] === 'yes') ? 'confirmed' : 'uncertain'
}

/** 复核所有置信度的矛盾候选；不把初审的结论、解释或提取事实喂回模型。 */
export async function adjudicateContradictions(
  provider: ModelProvider,
  chapterIndex: number,
  chapters: IndexedAuditChapter[],
  records: NarrativeAuditRecord[],
  findings: NarrativeFinding[]
): Promise<NarrativeFinding[]> {
  const candidates = findings.flatMap((finding, findingIndex) =>
    finding.kind === 'contradiction'
      ? [{ findingIndex, evidence: finding.evidence, recordIndexes: finding.recordIndexes }]
      : []
  )
  if (candidates.length === 0) return findings
  const candidateIndexes = new Set(candidates.map((item) => item.findingIndex))
  let validationFailure: string | undefined
  const result = await runRequiredChapterCheck('narrative.audit', chapterIndex, async () => {
    try {
      const parsed = schema.parse(
        await callAudit(
          provider,
          chapterIndex,
          'narrative.contradiction',
          [
            { role: 'system', content: CONTRADICTION_REVIEW_PROMPT },
            {
              role: 'user',
              content: JSON.stringify({
                chapterIndex,
                candidates,
                chapters,
                records: records.map((record, recordIndex) => ({ recordIndex, ...record })),
              }),
            },
          ],
          jsonSchema,
          validationFailure
        )
      )
      const seen = new Set<number>()
      for (const assessment of parsed.assessments) {
        if (!candidateIndexes.has(assessment.findingIndex) || seen.has(assessment.findingIndex))
          throw new Error('矛盾复核 findingIndex 越界或重复')
        seen.add(assessment.findingIndex)
        for (const evidence of assessment.evidence) {
          const chapter = chapters.find((item) => item.chapterIndex === evidence.chapterIndex)
          if (!chapter?.paragraphs.some((item) => item.paragraphIndex === evidence.paragraphIndex))
            throw new Error('矛盾复核引用了不存在的正文段落')
        }
        for (const recordIndex of assessment.recordIndexes)
          if (!records[recordIndex]) throw new Error('矛盾复核引用了不存在的记录')
        if (!assessment.evidence.some((item) => item.chapterIndex === chapterIndex))
          throw new Error('矛盾复核缺少当前正文证据')
        if (
          contradictionVerdict(assessment.checks) === 'confirmed' &&
          !assessment.evidence.some((item) => item.chapterIndex < chapterIndex) &&
          !assessment.recordIndexes.some((index) => records[index]?.origin === 'established')
        )
          throw new Error('确认矛盾必须引用既有事实依据')
      }
      if (seen.size !== candidates.length) throw new Error('矛盾复核未覆盖全部候选')
      return parsed
    } catch (error) {
      validationFailure = error instanceof Error ? error.message : String(error)
      throw error
    }
  })
  const byIndex = new Map(result.assessments.map((item) => [item.findingIndex, item]))
  return findings.map((finding, index) => {
    const assessment = byIndex.get(index)
    if (!assessment) return finding
    const verdict = contradictionVerdict(assessment.checks)
    return {
      ...finding,
      confidence: verdict === 'confirmed' ? 'high' : verdict === 'rejected' ? 'low' : 'medium',
      evidence: assessment.evidence,
      recordIndexes: assessment.recordIndexes,
      explanation: assessment.explanation,
      contradictionReview: {
        initialConfidence: finding.confidence,
        verdict,
        checks: assessment.checks,
        evidence: assessment.evidence,
        recordIndexes: assessment.recordIndexes,
        explanation: assessment.explanation,
      },
    }
  })
}
