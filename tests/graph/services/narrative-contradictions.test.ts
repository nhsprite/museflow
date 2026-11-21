import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  adjudicateContradictions,
  contradictionVerdict,
} from '../../../src/graph/services/narrative-audit/contradictions.js'
import { CONTRADICTION_CHECKS } from '../../../src/types/narrative-audit.js'
import type { ContradictionReview, NarrativeFinding } from '../../../src/types/narrative-audit.js'
import type { ModelProvider } from '../../../src/model/provider.js'

const chapters = [
  { chapterIndex: 0, paragraphs: [{ paragraphIndex: 0, text: '已定稿的先前事实。' }] },
  {
    chapterIndex: 1,
    paragraphs: [
      { paragraphIndex: 0, text: '当前叙事。' },
      { paragraphIndex: 1, text: '后续解释也必须提供。' },
    ],
  },
]
const allYes = (): ContradictionReview['checks'] =>
  Object.fromEntries(
    CONTRADICTION_CHECKS.map((key) => [key, 'yes'])
  ) as ContradictionReview['checks']
let findings: NarrativeFinding[]
let response: any
let provider: ModelProvider
beforeEach(() => {
  findings = [
    {
      kind: 'contradiction',
      confidence: 'medium',
      factIndexes: [],
      recordIndexes: [],
      evidence: [
        { chapterIndex: 0, paragraphIndex: 0 },
        { chapterIndex: 1, paragraphIndex: 0 },
      ],
      explanation: 'INITIAL_VERDICT_SECRET',
      repairTarget: 'current_prose',
      suggestion: 'INITIAL_REPAIR_SECRET',
    },
  ]
  response = {
    assessments: [
      {
        findingIndex: 0,
        checks: allYes(),
        evidence: findings[0]!.evidence,
        recordIndexes: [],
        explanation: '独立复核依据。',
      },
    ],
  }
  provider = { chat: vi.fn(), chatStructured: vi.fn(async () => structuredClone(response)) }
})
const run = () => adjudicateContradictions(provider, 1, chapters, [], findings)

describe('independent evidence checklist for contradictions (fixed model judgments)', () => {
  it('confirms a medium candidate from explicit checks without exposing its original verdict', async () => {
    const before = structuredClone(findings)
    const result = await run()
    expect(result[0]).toMatchObject({
      confidence: 'high',
      contradictionReview: { initialConfidence: 'medium', verdict: 'confirmed' },
    })
    expect(findings).toEqual(before)
    const prompt = JSON.stringify(vi.mocked(provider.chatStructured!).mock.calls[0]![0])
    expect(prompt).not.toContain('INITIAL_VERDICT_SECRET')
    expect(prompt).not.toContain('INITIAL_REPAIR_SECRET')
    expect(prompt).toContain('后续解释也必须提供')
  })

  it('replays the exact historical medium-confidence finding through the evidence gate', async () => {
    const historical = JSON.parse(
      readFileSync(
        new URL(
          '../../fixtures/narrative-audit/historical-medium-contradiction.json',
          import.meta.url
        ),
        'utf8'
      )
    )
    findings = [historical.finding]
    expect(findings[0]?.confidence).toBe('medium')
    const result = await run()
    expect(result[0]?.contradictionReview?.verdict).toBe('confirmed')
    expect(result[0]?.confidence).toBe('high')
    expect(JSON.stringify(vi.mocked(provider.chatStructured!).mock.calls[0]![0])).not.toContain(
      historical.finding.explanation
    )
  })

  it.each(CONTRADICTION_CHECKS)(
    'rejects even a high-confidence candidate when %s is no',
    async (key) => {
      findings[0]!.confidence = 'high'
      response.assessments[0].checks[key] = 'no'
      expect((await run())[0]).toMatchObject({
        confidence: 'low',
        contradictionReview: { initialConfidence: 'high', verdict: 'rejected' },
      })
    }
  )

  it.each(CONTRADICTION_CHECKS)('does not block when %s is uncertain', async (key) => {
    response.assessments[0].checks[key] = 'uncertain'
    expect((await run())[0]).toMatchObject({
      confidence: 'medium',
      contradictionReview: { verdict: 'uncertain' },
    })
  })

  it('allows established record evidence but keeps manual repair targets', async () => {
    findings[0]!.repairTarget = 'manual_review'
    response.assessments[0].evidence = [{ chapterIndex: 1, paragraphIndex: 0 }]
    response.assessments[0].recordIndexes = [0]
    const result = await adjudicateContradictions(
      provider,
      1,
      chapters,
      [{ kind: 'entity', origin: 'established', value: { id: 'c1' } }],
      findings
    )
    expect(result[0]).toMatchObject({ confidence: 'high', repairTarget: 'manual_review' })
    await expect(
      adjudicateContradictions(
        provider,
        1,
        chapters,
        [{ kind: 'event', origin: 'current', value: {} }],
        findings
      )
    ).rejects.toThrow('既有事实依据')
  })

  it.each(['missing', 'duplicate', 'unknown', 'paragraph', 'record', 'no_current', 'no_prior'])(
    'fails closed on %s evidence instead of downgrading failed checks',
    async (kind) => {
      const a = response.assessments[0]
      if (kind === 'missing') response.assessments = []
      if (kind === 'duplicate') response.assessments.push(structuredClone(a))
      if (kind === 'unknown') a.findingIndex = 99
      if (kind === 'paragraph') a.evidence[0].paragraphIndex = 99
      if (kind === 'record') a.recordIndexes = [99]
      if (kind === 'no_current') a.evidence = [{ chapterIndex: 0, paragraphIndex: 0 }]
      if (kind === 'no_prior') a.evidence = [{ chapterIndex: 1, paragraphIndex: 0 }]
      await expect(run()).rejects.toThrow('检查未完成')
      expect(provider.chatStructured).toHaveBeenCalledTimes(3)
      expect(vi.mocked(provider.chatStructured!).mock.calls[1]![0].at(-1)?.content).toContain(
        'validationFailure'
      )
    }
  )

  it('does not spend a call on a clean review and supports the JSON fallback', async () => {
    expect(await adjudicateContradictions(provider, 1, chapters, [], [])).toEqual([])
    expect(provider.chatStructured).not.toHaveBeenCalled()
    const fallback = { chat: vi.fn().mockResolvedValue(JSON.stringify(response)) }
    expect(
      (await adjudicateContradictions(fallback, 1, chapters, [], findings))[0]?.confidence
    ).toBe('high')
    expect(fallback.chat).toHaveBeenCalledTimes(1)
  })

  it('never treats an unavailable adjudicator as a clean review', async () => {
    vi.mocked(provider.chatStructured!).mockRejectedValue(new Error('offline'))
    await expect(run()).rejects.toThrow('offline')
  })

  it('treats a disproved premise as rejection even if another premise is uncertain', () => {
    expect(
      contradictionVerdict({ ...allYes(), sameSubject: 'no', comparableTime: 'uncertain' })
    ).toBe('rejected')
  })
})
