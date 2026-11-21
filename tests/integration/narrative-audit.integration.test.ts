import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StateGraph, START, END } from '@langchain/langgraph'
import { GraphState, type ReducedGraphState } from '../../src/graph/state.js'
import { validate_chapter_comprehensive } from '../../src/graph/nodes/validation.js'
import { validateChapterStructured } from '../../src/graph/nodes/structured-validation.js'
import { convergeAndDecide } from '../../src/graph/services/chapter-orchestration/routing.js'
import { createEmptyStoryMemory } from '../../src/story-memory/projector.js'
import { createEmptyStoryState } from '../../src/storage/meta/stores/story-state.js'
import { createChapterSession } from '../../src/core/chapter-generation/routing/session.js'
import { buildChapterReport } from '../../src/graph/services/finalization/chapter-report.js'
import { finalize_chapter } from '../../src/graph/nodes/finalization.js'
import { buildZeroProgressRejectionSection } from '../../src/agents/prompts/fragments/zero-progress-rejection.js'
import { passingNarrativeAuditResponse } from '../utils/narrative-audit.js'
import type { RuntimeContext } from '../../src/core/context.js'

// Other model tasks are fixed; the new audit, disk reader, schema, graph channel and routing are real.
vi.mock('../../src/graph/agent-factory.js', () => ({
  getConsistencyAgent: () => ({ run: async () => ({ success: true }), processOutput: () => [] }),
}))
vi.mock('../../src/graph/utils/chapter-context.js', () => ({
  buildChapterAgentContext: async () => ({}),
  mergeAgentState: (base: object, extra: object) => ({ ...base, ...extra }),
}))
vi.mock('../../src/utils/chapter-content-validation.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/utils/chapter-content-validation.js')>()),
  validateWordCount: () => ({ valid: true }),
}))

let dir: string
let state: ReducedGraphState
let context: RuntimeContext
let stalled: boolean
let findings: any[]
let facts: any[]
let coverage: any[]
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'museflow-narrative-integration-'))
  mkdirSync(join(dir, 'chapters'))
  for (let index = 0; index < 3; index++)
    writeFileSync(
      join(dir, 'chapters', `chapter_${index + 1}.md`),
      `第 ${index + 1} 次记录，二人继续守在桌边。`
    )
  state = {
    story: { id: 's', outputDir: dir },
    idea: 'test',
    genre: 'default',
    totalChapters: 4,
    currentChapterIndex: 2,
    storyArc: null,
    world: null,
    characters: [{ id: 'c-1', name: '老人' }],
    outline: [0, 1, 2].map((index) => ({ number: index + 1, title: '守候', description: '等待' })),
    chapters: [0, 1, 2].map((index) => ({ number: index + 1, title: '守候', summary: null })),
    storyMemory: createEmptyStoryMemory(),
    storyState: createEmptyStoryState(),
    draftChapterEvents: [],
    chapterPlan: { chapterIndex: 2, chapterTimeAnchor: '当晚', touchedCharacterIds: [] },
    pendingIssues: [],
    foreshadowStack: [],
    verifiedConstraints: [],
    actProgress: {},
    session: createChapterSession(2),
    rewriteRequested: false,
    rewriteApproved: false,
  } as unknown as ReducedGraphState
  stalled = false
  findings = []
  facts = []
  coverage = []
  context = {
    provider: {
      chat: vi.fn(),
      chatStructured: vi.fn(async (messages, schema, _temperature, metadata) => {
        if (metadata?.purpose === 'narrative.extract') return { facts }
        const result = passingNarrativeAuditResponse(messages, schema) as any
        if (result) {
          result.findings = findings
          result.coverage = coverage
          if (stalled)
            result.progress = result.progress.map((chapter: any) => ({
              ...chapter,
              verdict: 'stalled',
              dimensions: [],
              explanation: '连续维持原状，没有新的选择或后果。',
            }))
          return result
        }
        return { isContinuous: true }
      }),
    },
  } as RuntimeContext
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

async function review() {
  state = { ...state, ...(await validateChapterStructured(context, state)) }
  const updates = await validate_chapter_comprehensive(context, state)
  return { ...state, ...updates }
}

describe('narrative audit in the chapter pipeline', () => {
  it('persists evidence into session/report and feeds a stalled window into outline regeneration', async () => {
    stalled = true
    const checked = await review()
    expect(checked.session.narrativeAudit?.window).toHaveLength(3)
    const next = await convergeAndDecide(checked, context)
    expect(next.session?.routingDecision).toBe('draft_chapter')
    expect(next.chapterPlan).toBeNull()
    expect(next.session?.outlineRegenAttempts).toBe(1)
    expect(
      buildZeroProgressRejectionSection({
        zeroProgressRejection: next.session?.zeroProgressOutlineRejection,
      })
    ).toContain('连续维持原状')
    const report = buildChapterReport(checked, checked.chapters[2], '正文', checked.storyState)
    expect(report.narrativeAudit).toEqual(checked.session.narrativeAudit)
  })

  it('sends a prose omission through counted replanning, then clears resolved findings on rerun', async () => {
    facts = [
      {
        kind: 'lifecycle',
        entityId: 'c-1',
        attribute: 'alive',
        value: false,
        scope: 'current',
        evidenceParagraphs: [0],
      },
    ]
    coverage = [
      {
        factIndex: 0,
        verdict: 'missing',
        recordIndexes: [],
        confidence: 'high',
        explanation: '关键事实遗漏',
      },
    ]
    const checked = await review()
    const next = await convergeAndDecide(checked, context)
    expect(next.session?.routingDecision).toBe('draft_chapter')
    expect(next.session?.errorRewriteAttempts).toBe(1)
    state = { ...checked, ...next }
    findings = []
    facts = []
    coverage = []
    const corrected = await review()
    expect(corrected.pendingIssues.some((issue) => issue.ruleId === 'narrative.omission')).toBe(
      false
    )
    expect(corrected.storyMemory).toEqual(state.storyMemory)
  })

  it('revalidates old checkpoints and stale records even when the content hash still matches', async () => {
    const checked = await review()
    const legacy = structuredClone(checked)
    delete legacy.session.narrativeAudit
    expect((await convergeAndDecide(legacy, context)).session?.routingDecision).toBe(
      'validate_chapter'
    )
    checked.chapterFinalStateDeclarations = [
      { entityId: 'c-1', attribute: 'status', value: 'changed' },
    ]
    expect((await convergeAndDecide(checked, context)).session?.routingDecision).toBe(
      'validate_chapter'
    )
  })

  it('clears prior audit reports and findings after switching the genre audit off', async () => {
    const checked = await review()
    state = checked
    const planning = await import('../../src/utils/chapter-planning.js')
    const spy = vi
      .spyOn(planning, 'getChapterPlanningConfig')
      .mockReturnValue({ ...planning.DEFAULT_CHAPTER_PLANNING_CONFIG, narrativeAuditMode: 'off' })
    try {
      expect((await convergeAndDecide(state, context)).session?.routingDecision).toBe(
        'validate_chapter'
      )
      state.pendingIssues = [
        { source: 'narrative_audit', severity: 'error', ruleId: 'narrative.omission' },
      ] as any
      const disabled = await review()
      expect(disabled.session.narrativeAudit).toBeUndefined()
      expect(disabled.pendingIssues.some((issue) => issue.source === 'narrative_audit')).toBe(false)
      expect(
        buildChapterReport(state, state.chapters[2], '正文', state.storyState).narrativeAudit
      ).toBeUndefined()
    } finally {
      spy.mockRestore()
    }
  })

  it('aborts the graph before routing/finalization if the new review cannot execute', async () => {
    vi.mocked(context.provider.chatStructured!).mockRejectedValue(new Error('audit offline'))
    const finalize = vi.fn(() => ({}))
    const graph = new StateGraph(GraphState)
      .addNode('review', (state) => validate_chapter_comprehensive(context, state))
      .addNode('commit', finalize)
      .addEdge(START, 'review')
      .addEdge('review', 'commit')
      .addEdge('commit', END)
      .compile()
    await expect(graph.invoke(state)).rejects.toThrow('检查未完成')
    expect(finalize).not.toHaveBeenCalled()
  })

  it('blocks a resumed finalize node after its audit has gone stale', async () => {
    const checked = await review()
    writeFileSync(join(dir, 'chapters/chapter_3.md'), '检查后被改变的正文')
    await expect(finalize_chapter(context, checked)).rejects.toThrow(
      '审计凭证缺失或正文/记录已变化'
    )
  })
})
