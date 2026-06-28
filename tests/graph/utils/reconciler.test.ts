import { describe, expect, it, vi, beforeEach } from 'vitest'
import * as contextJudge from '../../../src/utils/context-judge.js'
import {
  mergeStoryState,
  sanitizeStoryState,
  formatStateConflicts,
  applyCanonicalFactsToState,
  reconcileStoryState,
  detectOutlineStateConflicts,
  detectItemLocationConflicts,
  detectCharacterStatusConflicts,
  classifyConflicts,
} from '../../../src/graph/utils/reconciler.js'
import type { StoryState, Conflict } from '../../../src/types/story-state.js'
import type { Character } from '../../../src/types/character.js'
import type { ModelProvider } from '../../../src/model/provider.js'

vi.mock('../../../src/utils/context-judge.js', async (importOriginal) => {
  const actual = await importOriginal<typeof contextJudge>()
  return {
    ...actual,
    batchExtractEntityChanges: vi.fn(),
    batchDetectTimeJumps: vi.fn(),
    batchJudgeBlockingConflictDescriptions: vi.fn(),
  }
})

vi.mock('../../../src/model/registry.js', () => ({
  createProvider: vi.fn(() => ({ chat: vi.fn() })),
}))

function emptyState(): StoryState {
  return {
    characterLocations: {},
    characterStatus: {},
    keyItemsLocation: {},
    keyItemsState: {},
    activePlots: [],
    revealedSecrets: [],
    pendingTasks: [],
    currentScene: '',
    storyTime: '',
  }
}

function createProvider(): ModelProvider {
  return { chat: vi.fn() }
}

function makeConflict(overrides: Partial<Conflict>): Conflict {
  return {
    id: 'test',
    type: 'retcon',
    subject: '血封信笺',
    attribute: '所在位置',
    oldValue: '妆台抽屉',
    newValue: '刑部证物房',
    outlineReference: '',
    severity: 'auto',
    description: '',
    ...overrides,
  }
}

const characters: Character[] = [
  { id: '1', storyId: 's', name: '苏半城', description: '', createdAt: 1 },
  { id: '2', storyId: 's', name: '何氏（奶娘）', description: '', createdAt: 2 },
]

describe('mergeStoryState', () => {
  it('deduplicates existing base items when delta does not mention them', () => {
    const existing: StoryState = {
      ...emptyState(),
      keyItemsLocation: {
        '血封信笺（柏字残画）': '妆台抽屉附近',
        '血封信笺（密函）': '东院正房妆台暗屉',
      },
    }
    const delta: StoryState = {
      ...emptyState(),
      keyItemsLocation: {},
    }
    const merged = mergeStoryState(existing, delta)
    expect(Object.keys(merged.keyItemsLocation).length).toBe(1)
    expect(Object.values(merged.keyItemsLocation)[0]).toBe('东院正房妆台暗屉')
  })

  it('overrides old canonical entries with delta entries', () => {
    const existing: StoryState = {
      ...emptyState(),
      keyItemsLocation: {
        '血封信笺（柏字残画）': '妆台抽屉附近',
        '血封信笺（密函）': '东院正房妆台暗屉',
      },
    }
    const delta: StoryState = {
      ...emptyState(),
      keyItemsLocation: {
        '血封信笺': '袖袋中',
      },
    }
    const merged = mergeStoryState(existing, delta)
    expect(Object.keys(merged.keyItemsLocation).length).toBe(1)
    expect(merged.keyItemsLocation['血封信笺']).toBe('袖袋中')
  })

  it('merges supersededFacts and canonicalFacts without duplicates', () => {
    const existing: StoryState = {
      ...emptyState(),
      supersededFacts: [{ subject: '血封信笺', oldFact: '妆台抽屉附近', reason: '冲突', chapterIndex: 1 }],
      canonicalFacts: [{ id: 'cf1', subject: '血封信笺', attribute: '所在位置', value: '东院正房妆台暗屉', establishedIn: 1 }],
    }
    const delta: StoryState = {
      ...emptyState(),
      supersededFacts: [{ subject: '血封信笺', oldFact: '妆台抽屉附近', reason: '冲突', chapterIndex: 1 }],
      canonicalFacts: [{ id: 'cf1', subject: '血封信笺', attribute: '所在位置', value: '东院正房妆台暗屉', establishedIn: 1 }],
    }
    const merged = mergeStoryState(existing, delta)
    expect(merged.supersededFacts?.length).toBe(1)
    expect(merged.canonicalFacts?.length).toBe(1)
  })

  it('keeps distinct canonical facts for different subjects', () => {
    const existing: StoryState = {
      ...emptyState(),
      canonicalFacts: [{ id: 'cf1', subject: '血封信笺', attribute: '所在位置', value: '东院正房妆台暗屉', establishedIn: 1 }],
    }
    const delta: StoryState = {
      ...emptyState(),
      canonicalFacts: [{ id: 'cf2', subject: '小银刀', attribute: '所在位置', value: '袖袋', establishedIn: 2 }],
    }
    const merged = mergeStoryState(existing, delta)
    expect(merged.canonicalFacts?.length).toBe(2)
  })
})

describe('sanitizeStoryState', () => {
  it('removes invented characters from locations/status', () => {
    const state: StoryState = {
      ...emptyState(),
      characterLocations: { 苏半城: '正房', 苏孟祥: '门外', 陆廷樑: '灵堂' },
      characterStatus: { 苏半城: '冷静', 苏孟祥: '疲惫' },
    }
    const report = sanitizeStoryState(state, characters)
    expect(report.state.characterLocations).toEqual({ 苏半城: '正房' })
    expect(report.state.characterStatus).toEqual({ 苏半城: '冷静' })
    expect(report.removedCharacters).toContain('苏孟祥')
    expect(report.removedCharacters).toContain('陆廷樑')
  })

  it('keeps established characters when preserveExisting is true', () => {
    const existingStoryState: StoryState = {
      ...emptyState(),
      characterLocations: { 苏半城: '正房', 亲王: '王府' },
      characterStatus: { 苏半城: '冷静', 亲王: '阴沉' },
    }
    const state: StoryState = {
      ...existingStoryState,
      characterLocations: { ...existingStoryState.characterLocations, 苏孟祥: '门外' },
      characterStatus: { ...existingStoryState.characterStatus, 苏孟祥: '疲惫' },
    }
    const report = sanitizeStoryState(state, characters, { preserveExisting: true, existingStoryState })
    expect(report.state.characterLocations).toEqual({ 苏半城: '正房', 亲王: '王府' })
    expect(report.state.characterStatus).toEqual({ 苏半城: '冷静', 亲王: '阴沉' })
    expect(report.removedCharacters).toContain('苏孟祥')
  })

  it('detects conflicting item locations', () => {
    const state: StoryState = {
      ...emptyState(),
      keyItemsLocation: {
        '廷樾手记': '妆台抽屉',
        '《廷樾手记》': '樟木箱暗格',
      },
    }
    const report = sanitizeStoryState(state, characters)
    expect(report.itemLocationConflicts.length).toBeGreaterThan(0)
  })

  it('resolves conflicting item locations and generates canonical facts with Chinese attribute', () => {
    const state: StoryState = {
      ...emptyState(),
      keyItemsLocation: {
        '血封信笺（柏字残画）': '妆台抽屉附近',
        '血封信笺（密函）': '东院正房妆台暗屉',
      },
    }
    const report = sanitizeStoryState(state, characters, { chapterIndex: 5 })
    expect(Object.keys(report.state.keyItemsLocation).length).toBe(1)
    expect(Object.values(report.state.keyItemsLocation)[0]).toBe('东院正房妆台暗屉')
    expect(report.state.supersededFacts?.length).toBe(1)
    expect(report.state.supersededFacts?.[0].subject).toBe('血封信笺')
    expect(report.state.canonicalFacts?.length).toBe(1)
    expect(report.state.canonicalFacts?.[0].subject).toBe('血封信笺')
    expect(report.state.canonicalFacts?.[0].attribute).toBe('所在位置')
    expect(report.state.canonicalFacts?.[0].value).toBe('东院正房妆台暗屉')
  })

  it('removes facts that reference invented characters', () => {
    const state: StoryState = {
      ...emptyState(),
      activePlots: ['苏孟祥出门办事'],
      revealedSecrets: ['陆廷樑偷了东西'],
    }
    const report = sanitizeStoryState(state, characters)
    expect(report.state.activePlots).toEqual([])
    expect(report.state.revealedSecrets).toEqual([])
    expect(report.removedFacts).toContain('苏孟祥出门办事')
    expect(report.removedFacts).toContain('陆廷樑偷了东西')
  })

  it('detects ambiguous item names at same location', () => {
    const state: StoryState = {
      ...emptyState(),
      keyItemsLocation: {
        '廷樾手记': '妆台抽屉',
        '《廷樾手记》': '妆台抽屉',
      },
    }
    const report = sanitizeStoryState(state, characters)
    expect(report.ambiguousItems.length).toBeGreaterThan(0)
    expect(report.ambiguousItems[0].items).toContain('廷樾手记')
  })

  it('formats state conflicts into instructions', () => {
    const state: StoryState = {
      ...emptyState(),
      keyItemsLocation: {
        '廷樾手记': '妆台抽屉',
        '《廷樾手记》': '樟木箱暗格',
      },
    }
    const report = sanitizeStoryState(state, characters)
    const formatted = formatStateConflicts(report)
    expect(formatted).toContain('物品位置冲突')
    expect(formatted).toContain('妆台抽屉')
    expect(formatted).toContain('樟木箱暗格')
  })
})

describe('applyCanonicalFactsToState', () => {
  it('updates keyItemsLocation based on canonical fact', () => {
    const state = emptyState()
    state.keyItemsLocation = { '血封信笺': '妆台抽屉', '另一物品': '书架' }
    state.canonicalFacts = [
      { id: 'f1', subject: '血封信笺', attribute: '所在位置', value: '刑部证物房', establishedIn: 9 },
    ]

    const result = applyCanonicalFactsToState(state)
    expect(result.keyItemsLocation['血封信笺']).toBe('刑部证物房')
    expect(result.keyItemsLocation['另一物品']).toBe('书架')
  })
})

describe('reconcileStoryState', () => {
  beforeEach(() => {
    vi.mocked(contextJudge.batchExtractEntityChanges).mockReset()
    vi.mocked(contextJudge.batchDetectTimeJumps).mockReset()
    vi.mocked(contextJudge.batchJudgeBlockingConflictDescriptions).mockReset()
    vi.mocked(contextJudge.batchExtractEntityChanges).mockResolvedValue([])
    vi.mocked(contextJudge.batchDetectTimeJumps).mockResolvedValue([false])
    vi.mocked(contextJudge.batchJudgeBlockingConflictDescriptions).mockResolvedValue([false])
  })

  function baseState(): StoryState {
    return {
      ...emptyState(),
      characterLocations: { '苏半城': '正房' },
      characterStatus: { '苏半城': '自由' },
      keyItemsLocation: { '血封信笺': '妆台抽屉' },
      keyItemsState: { '血封信笺': '完整' },
      revealedSecrets: ['苏半城是主谋'],
      storyTime: '民国三年三月初五',
    }
  }

  it('returns a report with reconciled state', async () => {
    const report = await reconcileStoryState(baseState(), '第10章：主角前往天津。', [], 9, createProvider())
    expect(report.state).toBeDefined()
    expect(report.conflicts).toBeDefined()
    expect(report.autoResolved).toBeDefined()
    expect(report.requiresAuthorDecision).toBeDefined()
    expect(report.suggestedOverrides).toBeDefined()
  })

  it('auto-resolves item location retcon', async () => {
    const state = baseState()
    vi.mocked(contextJudge.batchExtractEntityChanges).mockResolvedValue([
      { skip: false, location: '刑部证物房', state: null },
    ])

    const report = await reconcileStoryState(state, '第10章：血封信笺被转移至刑部证物房。', [], 9, createProvider())
    expect(report.autoResolved.some(c => c.subject === '血封信笺')).toBe(true)
    expect(report.state.keyItemsLocation['血封信笺']).toBe('刑部证物房')
    expect(report.state.canonicalFacts).toHaveLength(1)
    expect(report.state.canonicalFacts?.[0].value).toBe('刑部证物房')
  })

  it('surfaces contradiction for repeated secret reveal', async () => {
    const state = baseState()
    vi.mocked(contextJudge.batchExtractEntityChanges).mockResolvedValue([])

    const report = await reconcileStoryState(state, '第10章：真相大白，苏半城是主谋。', [], 9, createProvider())
    expect(report.requiresAuthorDecision.length).toBeGreaterThan(0)
    expect(report.requiresAuthorDecision[0].type).toBe('contradiction')
  })

  it('preserves canonical facts from input state and updates them', async () => {
    const state = baseState()
    state.canonicalFacts = [
      { id: 'f1', subject: '血封信笺', attribute: '所在位置', value: '妆台抽屉', establishedIn: 8 },
    ]
    vi.mocked(contextJudge.batchExtractEntityChanges).mockResolvedValue([
      { skip: false, location: '刑部证物房', state: null },
    ])

    const report = await reconcileStoryState(state, '第10章：血封信笺被转移至刑部证物房。', [], 9, createProvider())
    const fact = report.state.canonicalFacts?.find(f => f.subject === '血封信笺')
    expect(fact).toBeDefined()
    expect(fact?.value).toBe('刑部证物房')
    expect(fact?.establishedIn).toBe(10)
    expect(fact?.supersedes?.length).toBeGreaterThan(0)
    expect(fact?.supersedes?.[0].chapter).toBe(8)
  })
})

describe('detectOutlineStateConflicts', () => {
  it('returns empty result when no provider is given', async () => {
    const result = await detectOutlineStateConflicts(emptyState(), '大纲描述', 5, undefined)
    expect(result.conflicts).toHaveLength(0)
    expect(result.constraints).toHaveLength(0)
  })

  it('returns empty result when outline is empty', async () => {
    const provider = { chat: vi.fn() } as unknown as ModelProvider
    const result = await detectOutlineStateConflicts(emptyState(), '', 5, provider)
    expect(result.conflicts).toHaveLength(0)
    expect(result.constraints).toHaveLength(0)
    expect(provider.chat).not.toHaveBeenCalled()
  })

  it('parses model response into conflicts and constraints', async () => {
    const state: StoryState = {
      ...emptyState(),
      canonicalFacts: [
        {
          id: 'cf1',
          subject: '鹤卿第三条退路',
          attribute: '限制',
          value: '不写在账册上、不托付任何人，仅苏半城自己知道',
          establishedIn: 11,
        },
      ],
    }

    const provider = {
      chat: vi.fn(async (): Promise<string> => JSON.stringify({
        conflicts: [
          {
            subject: '鹤卿第三条退路',
            attribute: '限制',
            oldValue: '不托付任何人',
            newValue: '寄养于外姓友人',
            severity: 'warning',
            description: '大纲要求将鹤卿寄养于外姓友人，与权威事实存在张力',
          },
        ],
        constraints: [
          '若本章执行寄养，必须明确是前两条已建立退路的落实',
        ],
      })),
    } as unknown as ModelProvider

    const result = await detectOutlineStateConflicts(state, '苏半城被迫将幼子寄养于外姓友人家中', 16, provider)
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0].severity).toBe('warning')
    expect(result.conflicts[0].type).toBe('contradiction')
    expect(result.constraints).toHaveLength(1)
    expect(result.constraints[0]).toContain('前两条已建立退路')
  })

  it('falls back to empty result on model error', async () => {
    const provider = {
      chat: vi.fn(async (): Promise<string> => { throw new Error('模型调用失败') }),
    } as unknown as ModelProvider

    const result = await detectOutlineStateConflicts(emptyState(), '大纲描述', 5, provider)
    expect(result.conflicts).toHaveLength(0)
    expect(result.constraints).toHaveLength(0)
  })
})

describe('conflict detection & classification', () => {
  beforeEach(() => {
    vi.mocked(contextJudge.batchExtractEntityChanges).mockReset()
    vi.mocked(contextJudge.batchJudgeBlockingConflictDescriptions).mockReset()
    vi.mocked(contextJudge.batchExtractEntityChanges).mockResolvedValue([])
    vi.mocked(contextJudge.batchJudgeBlockingConflictDescriptions).mockResolvedValue([false])
  })

  it('detects item location retcon', async () => {
    const state = emptyState()
    state.keyItemsLocation = { '血封信笺': '妆台抽屉' }
    vi.mocked(contextJudge.batchExtractEntityChanges).mockResolvedValueOnce([
      { skip: false, location: '刑部证物房', state: null },
    ])

    const conflicts = await detectItemLocationConflicts(state, '第10章：血封信笺被转移至刑部证物房。', createProvider())
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].subject).toBe('血封信笺')
    expect(conflicts[0].newValue).toBe('刑部证物房')
    expect(conflicts[0].type).toBe('retcon')
  })

  it('detects character status retcon', async () => {
    const state = emptyState()
    state.characterStatus = { '苏半城': '自由' }
    vi.mocked(contextJudge.batchExtractEntityChanges).mockResolvedValueOnce([
      { skip: false, location: null, state: '身受重伤' },
    ])

    const conflicts = await detectCharacterStatusConflicts(state, '第10章：苏半城已身受重伤。', createProvider())
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].subject).toBe('苏半城')
    expect(conflicts[0].attribute).toBe('状态')
  })

  it('classifies location retcon as auto and status retcon as warning', async () => {
    const conflicts = [
      makeConflict({ id: '1', attribute: '所在位置' }),
      makeConflict({ id: '2', attribute: '状态' }),
    ]
    const results = await classifyConflicts(conflicts, createProvider())
    expect(results[0].severity).toBe('auto')
    expect(results[1].severity).toBe('warning')
  })

  it('elevates contradiction to blocking', async () => {
    const conflict = makeConflict({ type: 'retcon', description: '已死角色再次出现' })
    vi.mocked(contextJudge.batchJudgeBlockingConflictDescriptions).mockResolvedValueOnce([true])
    const result = await classifyConflicts([conflict], createProvider())
    expect(result[0].type).toBe('contradiction')
    expect(result[0].severity).toBe('blocking')
  })
})
