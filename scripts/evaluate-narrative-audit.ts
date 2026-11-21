#!/usr/bin/env tsx
/** Opt-in model evaluation on frozen excerpts. Never reads or writes books/. */
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseArgs } from 'node:util'
import { createProvider } from '../src/model/registry.js'
import { loadConfig } from '../src/config/store.js'
import { ModelTelemetry } from '../src/model/telemetry.js'
import { createEmptyStoryMemory, applyEvents } from '../src/story-memory/projector.js'
import { createEmptyStoryState } from '../src/storage/meta/stores/story-state.js'
import {
  auditChapterNarrative,
  narrativeAuditIssues,
} from '../src/graph/services/narrative-audit/index.js'
import { adjudicateContradictions } from '../src/graph/services/narrative-audit/contradictions.js'
import { splitContentParagraphs } from '../src/utils/text.js'
import type { NarrativeFinding } from '../src/types/narrative-audit.js'
import { checkProseHygiene } from '../src/graph/services/prose-hygiene/index.js'
import type { ReducedGraphState } from '../src/graph/state.js'
import type { NarrativeAuditReport } from '../src/types/narrative-audit.js'

import { decideNextStep } from '../src/core/chapter-generation/routing/index.js'
import { createChapterSession } from '../src/core/chapter-generation/routing/session.js'
import { getChapterPlanningConfig } from '../src/utils/chapter-planning.js'
import {
  isInterpretiveIssue,
  isStateCorruptionIssue,
} from '../src/core/chapter-generation/issue-classifier.js'
import { calculateIssueSetSimilarity } from '../src/core/chapter-generation/routing/issue-policy.js'
import type { StoryEvent } from '../src/types/story-memory.js'
import type { ModelProvider } from '../src/model/provider.js'

interface Fixture {
  id: string
  kind: string
  chapters: Array<{ content: string }>
  entities: Array<{ id: string; name: string }>
  memoryEvents?: StoryEvent[]
  draftEvents?: StoryEvent[]
  expected: {
    outlineRegeneration?: boolean
    repairTarget?: string
    finding?: string
    currentProgress?: string
    hygieneCode?: string
    noHighFindings?: boolean
    noContradiction?: boolean
    noArtifact?: boolean
  }
}

const { values } = parseArgs({
  options: {
    live: { type: 'boolean' },
    'adjudication-only': { type: 'boolean' },
    case: { type: 'string' },
    concurrency: { type: 'string', default: '1' },
    repeat: { type: 'string', default: '1' },
  },
})
const allFixtures: Fixture[] = JSON.parse(
  readFileSync(new URL('../tests/fixtures/narrative-audit/cases.json', import.meta.url), 'utf8')
)
const selected = values.case ? allFixtures.filter((item) => item.id === values.case) : allFixtures
const fixtures = values['adjudication-only']
  ? selected.filter(
      (item) =>
        item.chapters.length > 1 &&
        (item.expected.finding === 'contradiction' || item.expected.noHighFindings)
    )
  : selected
if (fixtures.length === 0) throw new Error('Unknown fixture id')
if (!values.live) {
  console.log(fixtures.map((item) => `${item.id} (${item.kind})`).join('\n'))
  console.log('\nCatalog only. Use --live to call the configured model (incurs API usage).')
} else {
  const config = loadConfig()
  const outputDir = mkdtempSync(join(tmpdir(), 'museflow-narrative-evaluation-'))
  const results: Array<{
    id: string
    kind: string
    passed: boolean
    iteration: number
    adjudicatedFindings?: NarrativeFinding[]
    report?: NarrativeAuditReport
    routing?: unknown
    durationMs?: number
    responses?: unknown[]
    usage?: unknown
    error?: string
  }> = []
  const sourceFiles = [
    '../src/agents/prompts/narrative-audit-prompt.ts',
    '../src/graph/services/narrative-audit/index.ts',
    '../src/graph/services/narrative-audit/coverage.ts',
    '../src/graph/services/narrative-audit/schema.ts',
    '../src/graph/services/narrative-audit/contradictions.ts',
    '../src/graph/services/narrative-audit/model-call.ts',
    '../src/utils/chapter-planning.ts',
    '../src/core/chapter-generation/routing/index.ts',
    '../tests/fixtures/narrative-audit/cases.json',
    './evaluate-narrative-audit.ts',
  ]
  const sourceHashes = Object.fromEntries(
    sourceFiles.map((file) => [
      file,
      createHash('sha256')
        .update(readFileSync(new URL(file, import.meta.url)))
        .digest('hex'),
    ])
  )
  const startedAt = new Date().toISOString()
  const path = join(outputDir, 'results.json')
  console.log(`Evidence: ${path}`)
  const save = () =>
    writeFileSync(
      path,
      JSON.stringify(
        {
          sourceHashes,
          mode: values['adjudication-only'] ? 'adjudication-only' : 'pipeline',
          startedAt,
          model: config.model.model,
          temperature: config.model.temperature,
          evaluatedAt: new Date().toISOString(),
          results,
        },
        null,
        2
      )
    )
  const concurrency = Number(values.concurrency)
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4)
    throw new Error('concurrency must be 1–4')
  const repetitions = Number(values.repeat)
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 5)
    throw new Error('repeat must be 1–5')
  const scheduled = fixtures.flatMap((fixture) =>
    Array.from({ length: repetitions }, (_, index) => ({ fixture, iteration: index + 1 }))
  )
  async function evaluate(fixture: Fixture, iteration: number) {
    const telemetry = new ModelTelemetry()
    const delegate = createProvider(config, telemetry)
    const responses: unknown[] = []
    const provider: ModelProvider = {
      chat: delegate.chat.bind(delegate),
      ...(delegate.chatStructured
        ? {
            chatStructured: async (
              ...args: Parameters<NonNullable<ModelProvider['chatStructured']>>
            ) => {
              const response = await delegate.chatStructured!(...args)
              responses.push({ purpose: args[3]?.purpose, response })
              return response
            },
          }
        : {}),
    }
    const started = Date.now()
    let result: (typeof results)[number] = {
      id: fixture.id,
      kind: fixture.kind,
      passed: false,
      iteration,
    }

    const workDir = mkdtempSync(join(tmpdir(), 'museflow-narrative-fixture-'))
    try {
      mkdirSync(join(workDir, 'chapters'))
      fixture.chapters.forEach((chapter, index) =>
        writeFileSync(join(workDir, 'chapters', `chapter_${index + 1}.md`), chapter.content)
      )
      const chapterIndex = fixture.chapters.length - 1
      const content = fixture.chapters[chapterIndex]!.content
      const state = {
        story: { id: fixture.id, outputDir: workDir },
        currentChapterIndex: chapterIndex,
        genre: 'default',
        characters: fixture.entities,
        storyMemory: applyEvents(createEmptyStoryMemory(), fixture.memoryEvents ?? []),
        storyState: createEmptyStoryState(),
        draftChapterEvents: fixture.draftEvents ?? [],
        chapterFinalStateDeclarations: [],
      } as unknown as ReducedGraphState
      if (values['adjudication-only']) {
        const chapters = fixture.chapters.map((chapter, chapterIndex) => ({
          chapterIndex,
          paragraphs: splitContentParagraphs(chapter.content).map((text, paragraphIndex) => ({
            text,
            paragraphIndex,
          })),
        }))
        const shouldConfirm = fixture.expected.finding === 'contradiction'
        const candidates: NarrativeFinding[] = [
          {
            kind: 'contradiction',
            confidence: shouldConfirm ? 'medium' : 'high',
            factIndexes: [],
            recordIndexes: [],
            evidence: [
              { chapterIndex: 0, paragraphIndex: 0 },
              { chapterIndex, paragraphIndex: 0 },
            ],
            explanation: '固定候选，用于验证复核能提升真矛盾并否决错误初判。',
            repairTarget: 'current_prose',
            suggestion: '固定测试建议',
          },
        ]
        const adjudicatedFindings = await adjudicateContradictions(
          provider,
          chapterIndex,
          chapters,
          [],
          candidates
        )
        const confirmed = adjudicatedFindings[0]?.contradictionReview?.verdict === 'confirmed'
        result = { ...result, passed: confirmed === shouldConfirm, adjudicatedFindings }
      } else if (fixture.expected.hygieneCode) {
        const passed = checkProseHygiene(content, {}).some(
          (issue) => issue.code === fixture.expected.hygieneCode
        )
        result = { ...result, passed }
      } else {
        const report = await auditChapterNarrative(provider, state, content)
        if (!report) throw new Error('Narrative audit is disabled in the default genre')
        const planningConfig = getChapterPlanningConfig('default')
        const routing = await decideNextStep(
          {
            session: createChapterSession(chapterIndex, {
              validatedContentHash: report.contentHash,
              narrativeAudit: report,
            }),
            pendingIssues: narrativeAuditIssues(report),
            genre: 'default',
            chapterFileExists: true,
            structuredValidationResult: undefined,
          },
          {
            issuePolicy: { planningConfig, isInterpretiveIssue },
            rewritePolicy: {
              planningConfig,
              calculateIssueSetSimilarity,
              isInterpretiveIssue,
              isStateCorruptionIssue,
            },
            fixPolicy: {},
          }
        )
        const regenerated =
          routing.step.kind === 'draft_chapter' && routing.step.regenerateOutline === true
        const expected = fixture.expected
        const errors = narrativeAuditIssues(report).filter((issue) => issue.severity === 'error')
        const high = report.findings.filter((finding) => finding.confidence === 'high')
        const passed =
          (expected.outlineRegeneration === undefined ||
            regenerated === expected.outlineRegeneration) &&
          (!expected.repairTarget ||
            report.findings
              .filter((f) => f.kind === expected.finding)
              .every((f) => f.repairTarget === expected.repairTarget)) &&
          (!expected.finding ||
            (errors.some((issue) => issue.ruleId === `narrative.${expected.finding}`) &&
              routing.step.kind !== 'finalize_chapter')) &&
          (!expected.currentProgress ||
            report.progress.at(-1)?.verdict === expected.currentProgress) &&
          (!expected.noHighFindings || high.length === 0) &&
          (!expected.noContradiction ||
            !high.some((finding) => finding.kind === 'contradiction')) &&
          (!expected.noArtifact || !high.some((finding) => finding.kind === 'prose_artifact'))
        result = { ...result, passed, report, routing: routing.step }
      }
    } catch (error) {
      result = {
        ...result,
        passed: false,
        error: error instanceof Error ? error.message : String(error),
      }
    } finally {
      rmSync(workDir, { recursive: true, force: true })
    }
    result.durationMs = Date.now() - started
    result.responses = responses
    result.usage = telemetry.getRecords()
    results.push(result)
    save()
    console.log(
      `${result.passed ? 'PASS' : 'FAIL'} ${result.id} #${iteration} (${Math.round(result.durationMs / 1000)}s)`
    )
  }
  let next = 0
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < scheduled.length) {
        const job = scheduled[next++]!
        await evaluate(job.fixture, job.iteration)
      }
    })
  )
  console.log(
    `${results.filter((result) => result.passed).length}/${results.length} passed. Evidence: ${path}`
  )
  if (results.some((result) => !result.passed)) process.exitCode = 1
}
