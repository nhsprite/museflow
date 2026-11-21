import { z } from 'zod'
import type { JsonSchema } from '../../../model/provider.js'

const index = z.number().int().nonnegative()
const indexes = z.array(index)
const evidenceIndexes = indexes.min(1)
const text = z.string().trim().min(1)
const factKinds = ['lifecycle', 'identity', 'custody', 'time', 'history'] as const
const scopes = ['current', 'recollection', 'uncertain'] as const
const findingKinds = ['unsupported_record', 'contradiction', 'prose_artifact'] as const
const coverageVerdicts = [
  'recorded',
  'unchanged',
  'missing',
  'not_recordable',
  'uncertain',
] as const
const repairTargets = ['current_prose', 'current_records', 'manual_review'] as const
const confidences = ['high', 'medium', 'low'] as const
const verdicts = ['advancing', 'transition', 'stalled', 'uncertain'] as const
const dimensions = ['goal', 'information', 'decision', 'relationship', 'consequence'] as const

export const factExtractionSchema = z
  .object({
    facts: z.array(
      z
        .object({
          kind: z.enum(factKinds),
          entityId: text.nullable(),
          entityName: text.nullable().default(null),
          attribute: text,
          value: z.union([z.string(), z.boolean(), z.null()]),
          scope: z.enum(scopes),
          evidenceParagraphs: evidenceIndexes,
        })
        .strict()
        // 兼容 JSON 提供方将联合类型中的布尔值编码成字面量字符串；不解析自然语言。
        .transform((fact) =>
          fact.kind === 'lifecycle' &&
          fact.attribute === 'alive' &&
          (fact.value === 'true' || fact.value === 'false')
            ? { ...fact, value: fact.value === 'true' }
            : fact
        )
        .refine(
          (fact) =>
            fact.kind !== 'lifecycle' ||
            fact.attribute !== 'alive' ||
            typeof fact.value === 'boolean',
          {
            message: 'lifecycle/alive 的 value 必须是布尔值，不能使用字符串或 null',
            path: ['value'],
          }
        )
    ),
  })
  .strict()

export const narrativeReviewSchema = z
  .object({
    coverage: z.array(
      z
        .object({
          factIndex: index,
          verdict: z.enum(coverageVerdicts),
          recordIndexes: indexes,
          confidence: z.enum(confidences),
          explanation: text,
        })
        .strict()
    ),
    findings: z.array(
      z
        .object({
          kind: z.enum(findingKinds),
          factIndexes: indexes,
          recordIndexes: indexes,
          evidence: z
            .array(z.object({ chapterIndex: index, paragraphIndex: index }).strict())
            .min(1),
          confidence: z.enum(confidences),
          explanation: text,
          repairTarget: z.enum(repairTargets),
        })
        .strict()
    ),
    progress: z
      .array(
        z
          .object({
            chapterIndex: index,
            verdict: z.enum(verdicts),
            dimensions: z.array(z.enum(dimensions)),
            evidenceParagraphs: evidenceIndexes,
            explanation: text,
          })
          .strict()
      )
      .min(1),
  })
  .strict()

const numberSchema = { type: 'integer', minimum: 0 }
const arrayOf = (items: unknown, minItems = 0) => ({ type: 'array', items, minItems })
const enumOf = (values: readonly string[]) => ({ type: 'string', enum: values })
const objectOf = (
  properties: Record<string, unknown>
): JsonSchema & { additionalProperties: false } => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
})
const textSchema = { type: 'string', minLength: 1 }

export const FACT_EXTRACTION_SCHEMA = objectOf({
  facts: arrayOf(
    objectOf({
      kind: enumOf(factKinds),
      entityId: { type: ['string', 'null'] },
      entityName: { type: ['string', 'null'] },
      attribute: textSchema,
      value: { type: ['string', 'boolean', 'null'] },
      scope: enumOf(scopes),
      evidenceParagraphs: arrayOf(numberSchema, 1),
    })
  ),
})

export const NARRATIVE_REVIEW_SCHEMA = objectOf({
  coverage: arrayOf(
    objectOf({
      factIndex: numberSchema,
      verdict: enumOf(coverageVerdicts),
      recordIndexes: arrayOf(numberSchema),
      confidence: enumOf(confidences),
      explanation: textSchema,
    })
  ),
  findings: arrayOf(
    objectOf({
      kind: enumOf(findingKinds),
      factIndexes: arrayOf(numberSchema),
      recordIndexes: arrayOf(numberSchema),
      evidence: arrayOf(objectOf({ chapterIndex: numberSchema, paragraphIndex: numberSchema }), 1),
      confidence: enumOf(confidences),
      explanation: textSchema,
      repairTarget: enumOf(repairTargets),
    })
  ),
  progress: arrayOf(
    objectOf({
      chapterIndex: numberSchema,
      verdict: enumOf(verdicts),
      dimensions: arrayOf(enumOf(dimensions)),
      evidenceParagraphs: arrayOf(numberSchema, 1),
      explanation: textSchema,
    }),
    1
  ),
})
