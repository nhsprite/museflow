import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  auditChapterNarrative,
  narrativeAuditIssues,
  isNarrativeAuditCurrent,
  narrativeStalledChapters,
} from '../../../src/graph/services/narrative-audit/index.js'
import { createEmptyStoryMemory } from '../../../src/story-memory/projector.js'
import { createEmptyStoryState } from '../../../src/storage/meta/stores/story-state.js'
import { createChapterSession } from '../../../src/core/chapter-generation/routing/session.js'
import { DEFAULT_CHAPTER_PLANNING_CONFIG } from '../../../src/utils/chapter-planning.js'
import type { ReducedGraphState } from '../../../src/graph/state.js'
import type { ModelProvider } from '../../../src/model/provider.js'
import { checkProseHygiene } from '../../../src/graph/services/prose-hygiene/index.js'

import { deduplicateByRule } from '../../../src/utils/issue-deduplication.js'

const config = { ...DEFAULT_CHAPTER_PLANNING_CONFIG }
vi.mock('../../../src/utils/chapter-planning.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/utils/chapter-planning.js')>()),
  getChapterPlanningConfig: () => config,
}))

const fixtures = JSON.parse(
  readFileSync(new URL('../../fixtures/narrative-audit/cases.json', import.meta.url), 'utf8')
)
let dir: string
let extraction: { facts: any[] }
let review: { coverage: any[]; findings: any[]; progress: any[] }
let provider: ModelProvider

function stateFor(id: string): { state: ReducedGraphState; content: string } {
  const fixture = fixtures.find((item: any) => item.id === id)
  const chapterIndex = fixture.chapters.length - 1
  for (const [index, chapter] of fixture.chapters.entries())
    writeFileSync(join(dir, 'chapters', `chapter_${index + 1}.md`), chapter.content)
  const state = {
    story: { id: 's', outputDir: dir },
    genre: 'default',
    currentChapterIndex: chapterIndex,
    characters: fixture.entities,
    storyMemory: createEmptyStoryMemory(),
    storyState: createEmptyStoryState(),
    draftChapterEvents: [],
    chapterFinalStateDeclarations: [],
    pendingIssues: [],
    session: createChapterSession(chapterIndex),
  } as unknown as ReducedGraphState
  review.progress = fixture.chapters.map((_: unknown, index: number) => ({
    chapterIndex: index,
    verdict: 'transition',
    dimensions: [],
    evidenceParagraphs: [0],
    explanation: '有效过渡。',
  }))
  return { state, content: fixture.chapters[chapterIndex].content }
}

function deathFact() {
  return {
    kind: 'lifecycle',
    entityId: 'c-sword',
    attribute: 'alive',
    value: false,
    scope: 'current',
    evidenceParagraphs: [0],
  }
}
function missingCoverage() {
  return {
    factIndex: 0,
    verdict: 'missing',
    recordIndexes: [],
    confidence: 'high',
    explanation: '正文事实无记录。',
  }
}
function omission() {
  return {
    kind: 'omission',
    factIndexes: [0],
    recordIndexes: [],
    evidence: [{ chapterIndex: 0, paragraphIndex: 0 }],
    confidence: 'high',
    explanation: '死亡已在正文成立，但事件记录遗漏。',
    repairTarget: 'current_prose',
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'museflow-narrative-audit-'))
  mkdirSync(join(dir, 'chapters'))
  Object.assign(config, DEFAULT_CHAPTER_PLANNING_CONFIG)
  extraction = { facts: [] }
  review = { coverage: [], findings: [], progress: [] }
  provider = {
    chat: vi.fn(),
    chatStructured: vi.fn(async (_messages, _schema, _temperature, metadata) =>
      structuredClone(metadata?.purpose === 'narrative.extract' ? extraction : review)
    ),
  } as ModelProvider
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('evidence-bound narrative audit (fixed judgments test plumbing, not model accuracy)', () => {
  it('routes a historical omitted death without mutating memory; extractor cannot see records or future outline', async () => {
    const { state, content } = stateFor('death-omitted')
    state.outline = [{ description: 'FUTURE_SECRET' }] as any
    state.draftChapterEvents = [
      {
        id: 'EVENT_SECRET',
        type: 'character-location',
        characterId: 'c-sword',
        locationId: null,
        chapterIndex: 0,
        source: 'chapter',
      },
    ] as any
    extraction.facts = [deathFact()]
    review.coverage = [missingCoverage()]
    const before = structuredClone(state)
    const report = (await auditChapterNarrative(provider, state, content))!
    expect(narrativeAuditIssues(report)).toEqual([
      expect.objectContaining({
        ruleId: 'narrative.omission',
        severity: 'error',
        retryStrategy: 'draft',
        source: 'narrative_audit',
      }),
    ])
    expect(state).toEqual(before)
    const calls = vi.mocked(provider.chatStructured!).mock.calls
    expect(calls[0]![0][1]!.content).not.toContain('EVENT_SECRET')
    expect(JSON.stringify(calls)).not.toContain('FUTURE_SECRET')
    expect(calls[1]![0][1]!.content).toContain('EVENT_SECRET')
  })

  it('requires both historical and current evidence for an unexplained return', async () => {
    const { state, content } = stateFor('unexplained-return')
    review.findings = [
      {
        ...omission(),
        kind: 'contradiction',
        factIndexes: [],
        evidence: [
          { chapterIndex: 0, paragraphIndex: 0 },
          { chapterIndex: 1, paragraphIndex: 0 },
        ],
      },
    ]
    const report = (await auditChapterNarrative(provider, state, content))!
    expect(narrativeAuditIssues(report)[0]?.severity).toBe('error')
    review.findings[0].evidence = [{ chapterIndex: 1, paragraphIndex: 0 }]
    await expect(auditChapterNarrative(provider, state, content)).rejects.toThrow(
      '缺少既有事实依据'
    )
  })

  it.each(['editorial-analysis', 'editorial-deletion'])(
    'preserves prose-artifact feedback for %s',
    async (id) => {
      const { state, content } = stateFor(id)
      review.findings = [{ ...omission(), kind: 'prose_artifact', factIndexes: [] }]
      const report = (await auditChapterNarrative(provider, state, content))!
      expect(narrativeAuditIssues(report)[0]?.ruleId).toBe('narrative.prose_artifact')
    }
  )

  it('accepts temporal contradictions grounded in both excerpts without guessing calendar fields', async () => {
    const { state, content } = stateFor('calendar-regression')
    review.findings = [
      {
        ...omission(),
        kind: 'contradiction',
        factIndexes: [],
        evidence: [
          { chapterIndex: 0, paragraphIndex: 0 },
          { chapterIndex: 1, paragraphIndex: 3 },
        ],
      },
    ]
    const report = (await auditChapterNarrative(provider, state, content))!
    expect(report.findings[0]?.kind).toBe('contradiction')
    expect(state.storyState.storyTime).toEqual(createEmptyStoryState().storyTime)
  })

  it.each([
    'recollection-not-revival',
    'explicit-revival',
    'quiet-relationship-change',
    'in-story-editing',
  ])('does not manufacture errors for the reasonable control %s', async (id) => {
    const { state, content } = stateFor(id)
    review.progress[review.progress.length - 1] = {
      chapterIndex: state.currentChapterIndex,
      verdict: 'advancing',
      dimensions: ['relationship'],
      evidenceParagraphs: [0],
      explanation: '人物关系或处境有明确变化。',
    }
    const report = (await auditChapterNarrative(provider, state, content))!
    expect(narrativeAuditIssues(report)).toEqual([])
    expect(narrativeStalledChapters(report)).toBe(0)
  })

  it('records cross-chapter stagnation independently of state event counts', async () => {
    const { state, content } = stateFor('repeated-inventory')
    review.progress = review.progress.map((item) => ({
      ...item,
      verdict: 'stalled',
      explanation: '持续重复清单和守位，未产生新的处境。',
    }))
    const report = (await auditChapterNarrative(provider, state, content))!
    expect(narrativeStalledChapters(report)).toBe(2)
    expect(narrativeAuditIssues(report)[0]?.severity).toBe('warning')
    report.progress[1]!.verdict = 'transition'
    expect(narrativeStalledChapters(report)).toBe(1)
  })

  it('report mode downgrades findings; off mode performs no I/O or calls', async () => {
    const { state, content } = stateFor('death-omitted')
    extraction.facts = [deathFact()]
    review.coverage = [missingCoverage()]
    config.narrativeAuditMode = 'report'
    expect(
      narrativeAuditIssues((await auditChapterNarrative(provider, state, content))!)[0]?.severity
    ).toBe('warning')
    config.narrativeAuditMode = 'off'
    vi.mocked(provider.chatStructured!).mockClear()
    expect(await auditChapterNarrative(provider, state, '')).toBeUndefined()
    expect(provider.chatStructured).not.toHaveBeenCalled()
  })

  it('keeps medium-confidence observations advisory', async () => {
    const { state, content } = stateFor('death-omitted')
    extraction.facts = [deathFact()]
    review.coverage = [{ ...missingCoverage(), confidence: 'medium' }]
    expect(
      narrativeAuditIssues((await auditChapterNarrative(provider, state, content))!)[0]?.severity
    ).toBe('warning')
  })

  it.each(['paragraph', 'entity', 'fact', 'record', 'window', 'scope', 'boolean'])(
    'rejects invalid %s references instead of certifying a pass',
    async (kind) => {
      const { state, content } = stateFor('death-omitted')
      extraction.facts = [deathFact()]
      review.coverage = [missingCoverage()]
      if (kind === 'paragraph') extraction.facts[0].evidenceParagraphs = [999]
      if (kind === 'entity') extraction.facts[0].entityId = 'unknown'
      if (kind === 'fact') review.coverage[0].factIndex = 999
      if (kind === 'record') review.coverage[0].recordIndexes = [999]
      if (kind === 'window') review.progress.push(review.progress[0])
      if (kind === 'scope') extraction.facts[0].scope = 'recollection'
      if (kind === 'boolean') extraction.facts[0].value = 'dead'
      await expect(auditChapterNarrative(provider, state, content)).rejects.toThrow('检查未完成')
      expect(state.session.narrativeAudit).toBeUndefined()
    }
  )

  it('keeps omissions for different entities in the same paragraph through issue deduplication', async () => {
    const { state, content } = stateFor('death-omitted')
    state.characters.push({ id: 'c-other', name: '另一人' } as any)
    extraction.facts = [deathFact(), { ...deathFact(), entityId: 'c-other' }]
    review.coverage = [missingCoverage(), { ...missingCoverage(), factIndex: 1 }]
    const report = (await auditChapterNarrative(provider, state, content))!
    expect(deduplicateByRule(narrativeAuditIssues(report))).toHaveLength(2)
  })

  it('distinguishes a newly named entity from an anonymous role for registration coverage', async () => {
    const { state, content } = stateFor('in-story-editing')
    extraction.facts = [
      {
        kind: 'identity',
        entityId: null,
        entityName: null,
        attribute: 'identity',
        value: '投稿者',
        scope: 'current',
        evidenceParagraphs: [0],
      },
    ]
    review.coverage = [{ ...missingCoverage(), verdict: 'not_recordable' }]
    expect((await auditChapterNarrative(provider, state, content))?.findings).toEqual([])
    const input = JSON.parse(vi.mocked(provider.chatStructured!).mock.calls[1]![0][1]!.content)
    expect(input.draftObservations[0].recordable).toBe(false)
    extraction.facts[0].entityName = '新角色'
    review.coverage = [missingCoverage()]
    expect((await auditChapterNarrative(provider, state, content))?.findings[0]?.kind).toBe(
      'omission'
    )
  })

  it('normalizes JSON boolean literals in the controlled lifecycle channel', async () => {
    const { state, content } = stateFor('death-omitted')
    extraction.facts = [{ ...deathFact(), value: 'false' }]
    review.coverage = [missingCoverage()]
    const report = (await auditChapterNarrative(provider, state, content))!
    expect(report.facts[0]?.value).toBe(false)
    expect(report.findings[0]?.kind).toBe('omission')
    expect(provider.chatStructured).toHaveBeenCalledTimes(2)
  })

  it('cannot silently omit extracted facts or exempt an explicit death', async () => {
    const { state, content } = stateFor('death-omitted')
    extraction.facts = [deathFact()]
    await expect(auditChapterNarrative(provider, state, content)).rejects.toThrow('未覆盖全部')
    review.coverage = [{ ...missingCoverage(), verdict: 'not_recordable' }]
    await expect(auditChapterNarrative(provider, state, content)).rejects.toThrow('verdict=missing')
  })

  it('feeds validation errors back to the model and uses explicit paragraph indexes', async () => {
    const { state, content } = stateFor('death-omitted')
    extraction.facts = [deathFact()]
    let reviews = 0
    vi.mocked(provider.chatStructured!).mockImplementation(
      async (_messages, _schema, _t, metadata) => {
        if (metadata?.purpose === 'narrative.extract') return extraction
        return { ...review, coverage: reviews++ === 0 ? [] : [missingCoverage()] }
      }
    )
    const report = (await auditChapterNarrative(provider, state, content))!
    expect(report.findings[0]?.kind).toBe('omission')
    const calls = vi.mocked(provider.chatStructured!).mock.calls
    expect(JSON.parse(calls[0]![0][1]!.content).paragraphs[0]).toEqual({
      paragraphIndex: 0,
      text: content,
    })
    expect(calls[2]![0].at(-1)?.content).toContain('未覆盖全部')
    expect(report.findings[0]?.repairTarget).toBe('current_records')
  })

  it('accepts recorded deaths but rejects a mismatching entity or lifecycle value as coverage', async () => {
    const { state, content } = stateFor('death-omitted')
    extraction.facts = [deathFact()]
    state.draftChapterEvents = [
      {
        id: 'e',
        type: 'character-status',
        characterId: 'c-sword',
        attribute: 'alive',
        value: 'false',
        lifecycle: { attribute: 'alive', value: false },
        chapterIndex: 0,
        source: 'chapter',
      },
    ] as any
    review.coverage = [{ ...missingCoverage(), verdict: 'recorded', recordIndexes: [0] }]
    expect((await auditChapterNarrative(provider, state, content))?.findings).toEqual([])
    ;(state.draftChapterEvents[0] as any).lifecycle.value = true
    await expect(auditChapterNarrative(provider, state, content)).rejects.toThrow('同一实体同值')
  })

  it('does not emit a second death for an already recorded terminal state', async () => {
    const { state, content } = stateFor('death-omitted')
    extraction.facts = [deathFact()]
    state.storyMemory!.entities.characters['c-sword'] = {
      id: 'c-sword',
      name: '剑无名',
      lifecycle: { alive: false },
    } as any
    review.coverage = [{ ...missingCoverage(), verdict: 'unchanged', recordIndexes: [0] }]
    expect((await auditChapterNarrative(provider, state, content))?.findings).toEqual([])
  })

  it('rejects repair directions that would change established records to fit the draft', async () => {
    const { state, content } = stateFor('calendar-regression')
    review.findings = [
      {
        ...omission(),
        kind: 'contradiction',
        factIndexes: [],
        repairTarget: 'current_records',
        evidence: [
          { chapterIndex: 0, paragraphIndex: 0 },
          { chapterIndex: 1, paragraphIndex: 0 },
        ],
      },
    ]
    await expect(auditChapterNarrative(provider, state, content)).rejects.toThrow('repairTarget')
    review.findings[0].repairTarget = 'current_prose'
    const report = (await auditChapterNarrative(provider, state, content))!
    expect(report.findings[0]?.suggestion).toContain('不得改写前文')
    review.findings[0].repairTarget = 'manual_review'
    expect(
      narrativeAuditIssues((await auditChapterNarrative(provider, state, content))!)[0]
        ?.retryStrategy
    ).toBe('manual')
  })

  it('fails closed on persistent transport and malformed output failures', async () => {
    const { state, content } = stateFor('death-omitted')
    vi.mocked(provider.chatStructured!).mockRejectedValue(new Error('timeout'))
    await expect(auditChapterNarrative(provider, state, content)).rejects.toThrow('timeout')
    expect(provider.chatStructured).toHaveBeenCalledTimes(3)
    vi.mocked(provider.chatStructured!).mockResolvedValue({})
    await expect(auditChapterNarrative(provider, state, content)).rejects.toThrow('检查未完成')
  })

  it('supports providers without native structured output', async () => {
    const { state, content } = stateFor('death-omitted')
    const fallback = {
      chat: vi
        .fn()
        .mockResolvedValueOnce(JSON.stringify(extraction))
        .mockResolvedValueOnce(JSON.stringify(review)),
    }
    expect(await auditChapterNarrative(fallback, state, content)).toBeDefined()
    expect(fallback.chat).toHaveBeenCalledTimes(2)
  })

  it('invalidates audit after edits to prose, records, prior chapters, config, or a legacy checkpoint', async () => {
    const { state, content } = stateFor('unexplained-return')
    expect(await isNarrativeAuditCurrent(state, content)).toBe(false)
    state.session.narrativeAudit = await auditChapterNarrative(provider, state, content)
    expect(await isNarrativeAuditCurrent(state, content)).toBe(true)
    expect(await isNarrativeAuditCurrent(state, content + '新段落')).toBe(false)
    config.narrativeAuditMode = 'report'
    expect(await isNarrativeAuditCurrent(state, content)).toBe(false)
    config.narrativeAuditMode = 'enforce'
    state.chapterFinalStateDeclarations = [
      { entityId: 'c-sword', attribute: 'status', value: '变化' },
    ]
    expect(await isNarrativeAuditCurrent(state, content)).toBe(false)
    state.chapterFinalStateDeclarations = []
    writeFileSync(join(dir, 'chapters/chapter_1.md'), '重写后的前章')
    expect(await isNarrativeAuditCurrent(state, content)).toBe(false)
  })

  it('revalidates protocol upgrades and clears old audit issues when the mode is disabled', async () => {
    const { state, content } = stateFor('death-omitted')
    state.session.narrativeAudit = await auditChapterNarrative(provider, state, content)
    ;(state.session.narrativeAudit as any).protocolVersion = 1
    expect(await isNarrativeAuditCurrent(state, content)).toBe(false)
    config.narrativeAuditMode = 'off'
    expect(await isNarrativeAuditCurrent(state, content)).toBe(false)
    delete state.session.narrativeAudit
    state.pendingIssues = [{ source: 'narrative_audit' }] as any
    expect(await isNarrativeAuditCurrent(state, content)).toBe(false)
    state.pendingIssues = []
    expect(await isNarrativeAuditCurrent(state, content)).toBe(true)
  })

  it('fails closed when a committed chapter is missing or changes during review', async () => {
    const { state, content } = stateFor('unexplained-return')
    const previous = join(dir, 'chapters/chapter_1.md')
    vi.mocked(provider.chatStructured!).mockImplementation(async (_m, _s, _t, metadata) => {
      if (metadata?.purpose === 'narrative.extract') return extraction
      writeFileSync(previous, '已改变')
      return review
    })
    await expect(auditChapterNarrative(provider, state, content)).rejects.toThrow('前文发生变化')
    rmSync(previous)
    await expect(auditChapterNarrative(provider, state, content)).rejects.toThrow('缺少第 1 章正文')
  })

  it('guards the historical explicit protocol leak using the deterministic hygiene gate', () => {
    const fixture = fixtures.find((item: any) => item.id === 'protocol-leak')
    expect(checkProseHygiene(fixture.chapters[0].content, {})).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'prose.protocol-block' })])
    )
  })
})
