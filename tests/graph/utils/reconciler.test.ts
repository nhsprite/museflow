import { describe, expect, it, vi, beforeEach } from 'vitest'
import * as contextJudge from '../../../src/utils/context-judge.js'
import * as outlineRevision from '../../../src/core/chapter-generation/outline-revision-proposal.js'
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
  applyAuthorOverrides,
  formatStoryState,
  prepareStoryStateForChapter,
  authorizeOutlineFacts,
  detectSecretRevealConflicts,
} from '../../../src/graph/utils/reconciler.js'
import { BlockingConflictError } from '../../../src/utils/errors.js'
import type { StoryState, Conflict, StateOverride } from '../../../src/types/story-state.js'
import type { Character } from '../../../src/types/character.js'
import type { ModelProvider } from '../../../src/model/provider.js'
import type { ReducedGraphState } from '../../../src/graph/state.js'
import { createProvider as registryCreateProvider } from '../../../src/model/registry.js'

vi.mock('../../../src/utils/context-judge.js', async (importOriginal) => {
  const actual = await importOriginal<typeof contextJudge>()
  return {
    ...actual,
    batchExtractEntityChanges: vi.fn(),
    batchDetectTimeJumps: vi.fn(),
    batchJudgeBlockingConflictDescriptions: vi.fn(),
  }
})

vi.mock('../../../src/core/chapter-generation/outline-revision-proposal.js', async (importOriginal) => {
  const actual = await importOriginal<typeof outlineRevision>()
  return {
    ...actual,
    generateOutlineRevisionProposal: vi.fn(),
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
    subject: '密信',
    attribute: '所在位置',
    oldValue: '书桌抽屉',
    newValue: '官府仓库',
    outlineReference: '',
    severity: 'auto',
    description: '',
    ...overrides,
  }
}

const characters: Character[] = [
  { id: '1', storyId: 's', name: '主角', description: '', createdAt: 1 },
  { id: '2', storyId: 's', name: '侍女', description: '', createdAt: 2 },
]

describe('mergeStoryState', () => {
  it('deduplicates existing base items when delta does not mention them', () => {
    const existing: StoryState = {
      ...emptyState(),
      keyItemsLocation: {
        '密信（残片）': '书桌抽屉附近',
        '密信（副本）': '主卧暗屉',
      },
    }
    const delta: StoryState = {
      ...emptyState(),
      keyItemsLocation: {},
    }
    const merged = mergeStoryState(existing, delta)
    expect(Object.keys(merged.keyItemsLocation).length).toBe(1)
    expect(Object.values(merged.keyItemsLocation)[0]).toBe('主卧暗屉')
  })

  it('overrides old canonical entries with delta entries', () => {
    const existing: StoryState = {
      ...emptyState(),
      keyItemsLocation: {
        '密信（残片）': '书桌抽屉附近',
        '密信（副本）': '主卧暗屉',
      },
    }
    const delta: StoryState = {
      ...emptyState(),
      keyItemsLocation: {
        '密信': '口袋中',
      },
    }
    const merged = mergeStoryState(existing, delta)
    expect(Object.keys(merged.keyItemsLocation).length).toBe(1)
    expect(merged.keyItemsLocation['密信']).toBe('口袋中')
  })

  it('merges supersededFacts and canonicalFacts without duplicates', () => {
    const existing: StoryState = {
      ...emptyState(),
      supersededFacts: [{ subject: '密信', oldFact: '书桌抽屉附近', reason: '冲突', chapterIndex: 1 }],
      canonicalFacts: [{ id: 'cf1', subject: '密信', attribute: '所在位置', value: '主卧暗屉', establishedIn: 1 }],
    }
    const delta: StoryState = {
      ...emptyState(),
      supersededFacts: [{ subject: '密信', oldFact: '书桌抽屉附近', reason: '冲突', chapterIndex: 1 }],
      canonicalFacts: [{ id: 'cf1', subject: '密信', attribute: '所在位置', value: '主卧暗屉', establishedIn: 1 }],
    }
    const merged = mergeStoryState(existing, delta)
    expect(merged.supersededFacts?.length).toBe(1)
    expect(merged.canonicalFacts?.length).toBe(1)
  })

  it('keeps distinct canonical facts for different subjects', () => {
    const existing: StoryState = {
      ...emptyState(),
      canonicalFacts: [{ id: 'cf1', subject: '密信', attribute: '所在位置', value: '主卧暗屉', establishedIn: 1 }],
    }
    const delta: StoryState = {
      ...emptyState(),
      canonicalFacts: [{ id: 'cf2', subject: '匕首', attribute: '所在位置', value: '口袋', establishedIn: 2 }],
    }
    const merged = mergeStoryState(existing, delta)
    expect(merged.canonicalFacts?.length).toBe(2)
  })

  it('keeps the latest canonical fact when subject, attribute and value collide', () => {
    const existing: StoryState = {
      ...emptyState(),
      canonicalFacts: [{ id: 'cf1', subject: '密信', attribute: '所在位置', value: '官府仓库', establishedIn: 1 }],
    }
    const delta: StoryState = {
      ...emptyState(),
      canonicalFacts: [{ id: 'cf2', subject: '密信', attribute: '所在位置', value: '官府仓库', establishedIn: 5 }],
    }
    const merged = mergeStoryState(existing, delta)
    expect(merged.canonicalFacts?.length).toBe(1)
    expect(merged.canonicalFacts?.[0].value).toBe('官府仓库')
    expect(merged.canonicalFacts?.[0].establishedIn).toBe(5)
  })

  it('does not overwrite newer canonical facts with older delta facts when value matches', () => {
    const existing: StoryState = {
      ...emptyState(),
      canonicalFacts: [{ id: 'cf1', subject: '密信', attribute: '所在位置', value: '官府仓库', establishedIn: 5 }],
    }
    const delta: StoryState = {
      ...emptyState(),
      canonicalFacts: [{ id: 'cf2', subject: '密信', attribute: '所在位置', value: '官府仓库', establishedIn: 1 }],
    }
    const merged = mergeStoryState(existing, delta)
    expect(merged.canonicalFacts?.length).toBe(1)
    expect(merged.canonicalFacts?.[0].value).toBe('官府仓库')
    expect(merged.canonicalFacts?.[0].establishedIn).toBe(5)
  })
})

describe('sanitizeStoryState', () => {
  it('removes invented characters from locations/status', () => {
    const state: StoryState = {
      ...emptyState(),
      characterLocations: { 主角: '正厅', 配角甲: '门外', 配角乙: '大厅' },
      characterStatus: { 主角: '冷静', 配角甲: '疲惫' },
    }
    const report = sanitizeStoryState(state, characters)
    expect(report.state.characterLocations).toEqual({ 主角: '正厅' })
    expect(report.state.characterStatus).toEqual({ 主角: '冷静' })
    expect(report.removedCharacters).toContain('配角甲')
    expect(report.removedCharacters).toContain('配角乙')
  })

  it('keeps established characters when preserveExisting is true', () => {
    const existingStoryState: StoryState = {
      ...emptyState(),
      characterLocations: { 主角: '正厅', 权贵: '王府' },
      characterStatus: { 主角: '冷静', 权贵: '阴沉' },
    }
    const state: StoryState = {
      ...existingStoryState,
      characterLocations: { ...existingStoryState.characterLocations, 配角甲: '门外' },
      characterStatus: { ...existingStoryState.characterStatus, 配角甲: '疲惫' },
    }
    const report = sanitizeStoryState(state, characters, { preserveExisting: true, existingStoryState })
    expect(report.state.characterLocations).toEqual({ 主角: '正厅', 权贵: '王府' })
    expect(report.state.characterStatus).toEqual({ 主角: '冷静', 权贵: '阴沉' })
    expect(report.removedCharacters).toContain('配角甲')
  })

  it('detects conflicting item locations', () => {
    const state: StoryState = {
      ...emptyState(),
      keyItemsLocation: {
        '手记': '书桌抽屉',
        '《手记》': '木箱暗格',
      },
    }
    const report = sanitizeStoryState(state, characters)
    expect(report.itemLocationConflicts.length).toBeGreaterThan(0)
  })

  it('resolves conflicting item locations and generates canonical facts with Chinese attribute', () => {
    const state: StoryState = {
      ...emptyState(),
      keyItemsLocation: {
        '密信（残片）': '书桌抽屉附近',
        '密信（副本）': '主卧暗屉',
      },
    }
    const report = sanitizeStoryState(state, characters, { chapterIndex: 5 })
    expect(Object.keys(report.state.keyItemsLocation).length).toBe(1)
    expect(Object.values(report.state.keyItemsLocation)[0]).toBe('主卧暗屉')
    expect(report.state.supersededFacts?.length).toBe(1)
    expect(report.state.supersededFacts?.[0].subject).toBe('密信')
    expect(report.state.canonicalFacts?.length).toBe(1)
    expect(report.state.canonicalFacts?.[0].subject).toBe('密信')
    expect(report.state.canonicalFacts?.[0].attribute).toBe('所在位置')
    expect(report.state.canonicalFacts?.[0].value).toBe('主卧暗屉')
  })

  it('removes facts that reference invented characters', () => {
    const state: StoryState = {
      ...emptyState(),
      activePlots: ['配角甲出门办事'],
      revealedSecrets: ['配角乙偷了东西'],
    }
    const report = sanitizeStoryState(state, characters)
    expect(report.state.activePlots).toEqual([])
    expect(report.state.revealedSecrets).toEqual([])
    expect(report.removedFacts).toContain('配角甲出门办事')
    expect(report.removedFacts).toContain('配角乙偷了东西')
  })

  it('keeps plots and secrets that reference official characters', () => {
    const state: StoryState = {
      ...emptyState(),
      activePlots: ['主角追查密信下落'],
      revealedSecrets: ['主角发现密信被转移出王府'],
    }
    const report = sanitizeStoryState(state, characters)
    expect(report.state.activePlots).toEqual(['主角追查密信下落'])
    expect(report.state.revealedSecrets).toEqual(['主角发现密信被转移出王府'])
    expect(report.removedFacts).toEqual([])
  })

  it('detects ambiguous item names at same location', () => {
    const state: StoryState = {
      ...emptyState(),
      keyItemsLocation: {
        '手记': '书桌抽屉',
        '《手记》': '书桌抽屉',
      },
    }
    const report = sanitizeStoryState(state, characters)
    expect(report.ambiguousItems.length).toBeGreaterThan(0)
    expect(report.ambiguousItems[0].items).toContain('手记')
  })

  it('formatStateConflicts includes removed characters and facts', () => {
    const state = emptyState()
    state.characterLocations['无名路人甲'] = '街上'
    const characters: Character[] = []
    const report = sanitizeStoryState(state, characters, { preserveExisting: false })
    const text = formatStateConflicts(report)
    expect(text).toContain('非官方角色已移除')
    expect(text).toContain('无名路人甲')
  })

  it('formats state conflicts into instructions', () => {
    const state: StoryState = {
      ...emptyState(),
      keyItemsLocation: {
        '手记': '书桌抽屉',
        '《手记》': '木箱暗格',
      },
    }
    const report = sanitizeStoryState(state, characters)
    const formatted = formatStateConflicts(report)
    expect(formatted).toContain('物品位置冲突')
    expect(formatted).toContain('书桌抽屉')
    expect(formatted).toContain('木箱暗格')
  })
})

describe('applyCanonicalFactsToState', () => {
  it('updates keyItemsLocation based on canonical fact', () => {
    const state = emptyState()
    state.keyItemsLocation = { '密信': '书桌抽屉', '另一物品': '书架' }
    state.canonicalFacts = [
      { id: 'f1', subject: '密信', attribute: '所在位置', value: '官府仓库', establishedIn: 9 },
    ]

    const result = applyCanonicalFactsToState(state)
    expect(result.keyItemsLocation['密信']).toBe('官府仓库')
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
      characterLocations: { '主角': '正厅' },
      characterStatus: { '主角': '自由' },
      keyItemsLocation: { '密信': '书桌抽屉' },
      keyItemsState: { '密信': '完整' },
      revealedSecrets: ['主角是主谋'],
      storyTime: '故事时间第一天',
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
      { skip: false, location: '官府仓库', state: null },
    ])

    const report = await reconcileStoryState(state, '第10章：密信被转移至官府仓库。', [], 9, createProvider())
    expect(report.autoResolved.some(c => c.subject === '密信')).toBe(true)
    expect(report.state.keyItemsLocation['密信']).toBe('官府仓库')
    expect(report.state.canonicalFacts).toHaveLength(1)
    expect(report.state.canonicalFacts?.[0].value).toBe('官府仓库')
  })

  it('surfaces contradiction for repeated secret reveal', async () => {
    const state = baseState()
    vi.mocked(contextJudge.batchExtractEntityChanges).mockResolvedValue([])

    const report = await reconcileStoryState(state, '第10章：真相大白，主角是主谋。', [], 9, createProvider())
    expect(report.requiresAuthorDecision.length).toBeGreaterThan(0)
    expect(report.requiresAuthorDecision[0].type).toBe('contradiction')
  })

  it('preserves canonical facts from input state and updates them', async () => {
    const state = baseState()
    state.canonicalFacts = [
      { id: 'f1', subject: '密信', attribute: '所在位置', value: '书桌抽屉', establishedIn: 8 },
    ]
    vi.mocked(contextJudge.batchExtractEntityChanges).mockResolvedValue([
      { skip: false, location: '官府仓库', state: null },
    ])

    const report = await reconcileStoryState(state, '第10章：密信被转移至官府仓库。', [], 9, createProvider())
    const fact = report.state.canonicalFacts?.find(f => f.subject === '密信')
    expect(fact).toBeDefined()
    expect(fact?.value).toBe('官府仓库')
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
          subject: '秘密退路',
          attribute: '限制',
          value: '不写在账册上、不托付任何人，仅主角自己知道',
          establishedIn: 11,
        },
      ],
    }

    const provider = {
      chat: vi.fn(async (): Promise<string> => JSON.stringify({
        conflicts: [
          {
            subject: '秘密退路',
            attribute: '限制',
            oldValue: '不托付任何人',
            newValue: '寄养于外姓友人',
            severity: 'warning',
            description: '大纲要求将幼子寄养于外姓友人，与权威事实存在张力',
          },
        ],
        constraints: [
          '若本章执行寄养，必须明确是前两条已建立退路的落实',
        ],
      })),
    } as unknown as ModelProvider

    const result = await detectOutlineStateConflicts(state, '主角被迫将幼子寄养于外姓友人家中', 16, provider)
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
    state.keyItemsLocation = { '密信': '书桌抽屉' }
    vi.mocked(contextJudge.batchExtractEntityChanges).mockResolvedValueOnce([
      { skip: false, location: '官府仓库', state: null },
    ])

    const conflicts = await detectItemLocationConflicts(state, '第10章：密信被转移至官府仓库。', createProvider())
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].subject).toBe('密信')
    expect(conflicts[0].newValue).toBe('官府仓库')
    expect(conflicts[0].type).toBe('retcon')
  })

  it('detects character status retcon', async () => {
    const state = emptyState()
    state.characterStatus = { '主角': '自由' }
    vi.mocked(contextJudge.batchExtractEntityChanges).mockResolvedValueOnce([
      { skip: false, location: null, state: '身受重伤' },
    ])

    const conflicts = await detectCharacterStatusConflicts(state, '第10章：主角已身受重伤。', createProvider())
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].subject).toBe('主角')
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


describe('applyAuthorOverrides', () => {
  it('applies author location overrides to characters and items', () => {
    const state: StoryState = {
      ...emptyState(),
      characterLocations: { '主角': '家中' },
      keyItemsLocation: { '钥匙': '口袋', '钥匙（箱用）': '口袋' },
    }
    const overrides: StateOverride[] = [
      {
        id: 'o1',
        subject: '主角',
        attribute: '所在位置',
        oldValue: '家中',
        newValue: '城外',
        reason: 'test',
        source: 'author',
        chapterIndex: 9,
        createdAt: 1,
      },
      {
        id: 'o2',
        subject: '钥匙',
        attribute: '所在位置',
        oldValue: '口袋',
        newValue: '箱内',
        reason: 'test',
        source: 'author',
        chapterIndex: 9,
        createdAt: 2,
      },
    ]

    const result = applyAuthorOverrides({ ...state, overrides })
    expect(result.characterLocations['主角']).toBe('城外')
    expect(result.keyItemsLocation['钥匙']).toBe('箱内')
    expect(result.keyItemsLocation['钥匙（箱用）']).toBe('箱内')
    expect(result.canonicalFacts?.some(f => f.subject === '主角' && f.value === '城外')).toBe(true)
    expect(result.canonicalFacts?.some(f => f.subject === '钥匙' && f.value === '箱内')).toBe(true)
  })

  it('applies author status overrides', () => {
    const state: StoryState = {
      ...emptyState(),
      characterStatus: { '主角': '健康' },
      keyItemsState: { '宝箱': '锁着' },
    }
    const overrides: StateOverride[] = [
      {
        id: 'o1',
        subject: '主角',
        attribute: '状态',
        oldValue: '健康',
        newValue: '负伤',
        reason: 'test',
        source: 'author',
        chapterIndex: 5,
        createdAt: 1,
      },
    ]

    const result = applyAuthorOverrides({ ...state, overrides })
    expect(result.characterStatus['主角']).toBe('负伤')
    expect(result.canonicalFacts?.[0].attribute).toBe('状态')
    expect(result.canonicalFacts?.[0].value).toBe('负伤')
  })
})

describe('formatStoryState', () => {
  it('deduplicates item aliases by canonical name', () => {
    const state: StoryState = {
      ...emptyState(),
      keyItemsLocation: {
        '长剑': '墙上',
        '《长剑》': '墙上',
        '长剑（祖传）': '墙上',
        '血书': '怀中',
      },
      keyItemsState: {
        '长剑': '锋利',
        '《长剑》': '锋利',
      },
    }
    const text = formatStoryState(state)
    expect(text).toContain('长剑')
    expect(text).toContain('亦称')
    expect(text).toContain('血书：怀中')
    expect(text).toContain('锋利')
    expect(text).not.toMatch(/^\s*《长剑》/m)
  })
})

describe('prepareStoryStateForChapter', () => {
  beforeEach(() => {
    vi.mocked(contextJudge.batchExtractEntityChanges).mockReset()
    vi.mocked(contextJudge.batchDetectTimeJumps).mockReset()
    vi.mocked(contextJudge.batchJudgeBlockingConflictDescriptions).mockReset()
    vi.mocked(contextJudge.batchExtractEntityChanges).mockResolvedValue([])
    vi.mocked(contextJudge.batchDetectTimeJumps).mockResolvedValue([false])
    vi.mocked(contextJudge.batchJudgeBlockingConflictDescriptions).mockResolvedValue([false])
  })

  function makeState(): ReducedGraphState {
    return {
      story: { id: 's1', title: 'Test', outputDir: '/tmp', createdAt: 1, updatedAt: 1, status: 'writing', genre: 'default', totalChapters: 3 } as ReducedGraphState['story'],
      idea: '',
      genre: 'default',
      totalChapters: 3,
      world: null,
      characters: [{ id: 'c1', storyId: 's1', name: '主角', description: '', createdAt: 1 }],
      outline: [{ id: 'o1', number: 1, title: 'Test', description: '主角秘密抵达京城。' }],
      chapters: [],
      currentChapterIndex: 0,
      foreshadowStack: [],
      timeline: undefined,
      chapterSummaries: [],
      pendingIssues: [],
      rewriteApproved: false,
      rewriteRequested: false,
      isWriting: false,
      writeOneChapterOnly: false,
      lastPrintedChapter: -1,
      lastTimelineSnapshot: null,
      chapterPlan: null,
      storyState: {
        ...emptyState(),
        characterLocations: { '主角': '家中' },
        canonicalFacts: [{ id: 'f1', subject: '主角', attribute: '所在位置', value: '家中', establishedIn: 1 }],
      },
      chapterTimeAnchor: undefined,
      autoFixAttempts: 0,
      verifiedConstraints: [],
      chapterReport: null,
      rewriteAttempts: 0,
      errorRewriteAttempts: 0,
      previousIssues: [],
      previousRawErrorCount: 0,
      forceStructuralRewrite: false,
      routingDecision: undefined,
      authorDecisions: {},
    }
  }

  it('throws BlockingConflictError when outline contradicts canonical fact at blocking severity', async () => {
    const state = makeState()
    const provider = {
      chat: vi.fn(async (): Promise<string> => JSON.stringify({
        conflicts: [
          {
            subject: '主角',
            attribute: '所在位置',
            oldValue: '家中',
            newValue: '京城',
            severity: 'blocking',
            description: '大纲要求主角抵达京城，与权威事实冲突',
          },
        ],
        constraints: [],
      })),
    } as unknown as ModelProvider
    vi.mocked(contextJudge.batchExtractEntityChanges).mockResolvedValue([])
    vi.mocked(registryCreateProvider).mockReturnValue(provider)
    vi.mocked(outlineRevision.generateOutlineRevisionProposal).mockResolvedValue(null)

    await expect(prepareStoryStateForChapter(state, 0)).rejects.toBeInstanceOf(BlockingConflictError)
  })

  it('attaches an outline revision proposal to BlockingConflictError when one is generated', async () => {
    const state = makeState()
    const provider = {
      chat: vi.fn(async (): Promise<string> => JSON.stringify({
        conflicts: [
          {
            subject: '主角',
            attribute: '所在位置',
            oldValue: '家中',
            newValue: '京城',
            severity: 'blocking',
            description: '大纲要求主角抵达京城，与权威事实冲突',
          },
        ],
        constraints: [],
      })),
    } as unknown as ModelProvider
    vi.mocked(contextJudge.batchExtractEntityChanges).mockResolvedValue([])
    vi.mocked(registryCreateProvider).mockReturnValue(provider)
    vi.mocked(outlineRevision.generateOutlineRevisionProposal).mockResolvedValue({
      revisedDescription: '主角在家中收到京城来信，决定暂缓出行。',
      explanation: '避免与主角仍在家的权威事实冲突。',
    })

    await expect(prepareStoryStateForChapter(state, 0)).rejects.toMatchObject({
      proposal: {
        revisedDescription: '主角在家中收到京城来信，决定暂缓出行。',
        explanation: '避免与主角仍在家的权威事实冲突。',
      },
    })
  })

  it('skips blocking conflicts that have an author decision', async () => {
    const state = makeState()
    state.authorDecisions = { 'outline-state:主角:所在位置:0': 'canonical' }
    const provider = {
      chat: vi.fn(async (): Promise<string> => JSON.stringify({
        conflicts: [
          {
            subject: '主角',
            attribute: '所在位置',
            oldValue: '家中',
            newValue: '京城',
            severity: 'blocking',
            description: '大纲要求主角抵达京城，与权威事实冲突',
          },
        ],
        constraints: [],
      })),
    } as unknown as ModelProvider
    vi.mocked(contextJudge.batchExtractEntityChanges).mockResolvedValue([])
    vi.mocked(registryCreateProvider).mockReturnValue(provider)

    const result = await prepareStoryStateForChapter(state, 0)
    expect(result).toBeDefined()
    expect(result.stateConflicts).toContain('大纲要求主角抵达京城')
  })

  it('authorizes new facts introduced by the outline', async () => {
    const state = makeState()
    const provider = {
      chat: vi.fn(async (): Promise<string> => JSON.stringify({
        conflicts: [],
        constraints: [],
      })),
    } as unknown as ModelProvider
    vi.mocked(contextJudge.batchExtractEntityChanges).mockResolvedValue([])
    vi.mocked(registryCreateProvider).mockReturnValue({
      chat: vi.fn(async (): Promise<string> => JSON.stringify({
        facts: [
          { subject: '密信', attribute: '来源', value: '旧友暗中递送', contradictsExisting: false },
          { subject: '暗桩', attribute: '关系', value: '主角旧部', contradictsExisting: false },
        ],
      })),
    } as unknown as ModelProvider)

    const result = await prepareStoryStateForChapter(state, 0)
    expect(result.reconciledState.canonicalFacts?.some(
      f => f.subject === '密信' && f.attribute === '来源' && f.value === '旧友暗中递送' && f.source === 'outline'
    )).toBe(true)
    expect(result.reconciledState.canonicalFacts?.some(
      f => f.subject === '暗桩' && f.attribute === '关系' && f.value === '主角旧部' && f.establishedIn === 1
    )).toBe(true)
  })

  it('does not authorize facts that contradict existing canonical facts', async () => {
    const state = makeState()
    const provider = {
      chat: vi.fn(async (): Promise<string> => JSON.stringify({
        conflicts: [],
        constraints: [],
      })),
    } as unknown as ModelProvider
    vi.mocked(contextJudge.batchExtractEntityChanges).mockResolvedValue([])
    vi.mocked(registryCreateProvider).mockReturnValue({
      chat: vi.fn(async (): Promise<string> => JSON.stringify({
        facts: [
          { subject: '主角', attribute: '所在位置', value: '京城', contradictsExisting: true },
        ],
      })),
    } as unknown as ModelProvider)

    const result = await prepareStoryStateForChapter(state, 0)
    expect(result.reconciledState.canonicalFacts?.some(
      f => f.subject === '主角' && f.value === '京城'
    )).toBe(false)
  })
})

describe('authorizeOutlineFacts', () => {
  it('returns empty array when provider is missing', async () => {
    const state = emptyState()
    const result = await authorizeOutlineFacts(state, '大纲描述', 0, undefined)
    expect(result).toHaveLength(0)
  })

  it('returns empty array when outline is empty', async () => {
    const provider = { chat: vi.fn() } as unknown as ModelProvider
    const result = await authorizeOutlineFacts(emptyState(), '', 0, provider)
    expect(result).toHaveLength(0)
    expect(provider.chat).not.toHaveBeenCalled()
  })

  it('extracts new facts from outline and marks them as outline source', async () => {
    const state = emptyState()
    const provider = {
      chat: vi.fn(async (): Promise<string> => JSON.stringify({
        facts: [
          { subject: '主角', attribute: '所在位置', value: '废弃仓库', contradictsExisting: false },
          { subject: '暗桩', attribute: '关系', value: '主角旧部', contradictsExisting: false },
        ],
      })),
    } as unknown as ModelProvider

    const result = await authorizeOutlineFacts(state, '主角秘密抵达废弃仓库，与旧部暗桩接头。', 4, provider)
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ subject: '主角', attribute: '所在位置', value: '废弃仓库', establishedIn: 5, source: 'outline' })
    expect(result[1]).toMatchObject({ subject: '暗桩', attribute: '关系', value: '主角旧部', establishedIn: 5, source: 'outline' })
  })

  it('skips facts already present in canonical facts', async () => {
    const state: StoryState = {
      ...emptyState(),
      canonicalFacts: [
        { id: 'f1', subject: '主角', attribute: '所在位置', value: '废弃仓库', establishedIn: 4 },
      ],
    }
    const provider = {
      chat: vi.fn(async (): Promise<string> => JSON.stringify({
        facts: [
          { subject: '主角', attribute: '所在位置', value: '废弃仓库', contradictsExisting: false },
        ],
      })),
    } as unknown as ModelProvider

    const result = await authorizeOutlineFacts(state, '主角在废弃仓库藏身。', 4, provider)
    expect(result).toHaveLength(0)
  })

  it('skips facts flagged as contradicting existing facts', async () => {
    const state: StoryState = {
      ...emptyState(),
      canonicalFacts: [
        { id: 'f1', subject: '主角', attribute: '所在位置', value: '家中', establishedIn: 1 },
      ],
    }
    const provider = {
      chat: vi.fn(async (): Promise<string> => JSON.stringify({
        facts: [
          { subject: '主角', attribute: '所在位置', value: '京城', contradictsExisting: true },
        ],
      })),
    } as unknown as ModelProvider

    const result = await authorizeOutlineFacts(state, '主角已抵达京城。', 4, provider)
    expect(result).toHaveLength(0)
  })

  it('falls back to empty array on model error', async () => {
    const provider = {
      chat: vi.fn(async (): Promise<string> => { throw new Error('模型调用失败') }),
    } as unknown as ModelProvider

    const result = await authorizeOutlineFacts(emptyState(), '大纲描述', 0, provider)
    expect(result).toHaveLength(0)
  })
})

describe('applyCanonicalFactsToState', () => {
  it('creates missing keyItemsLocation entry from canonical fact', () => {
    const state: StoryState = {
      ...emptyState(),
      canonicalFacts: [
        {
          id: 'f1',
          subject: '龙纹玉佩',
          attribute: '所在位置',
          value: '主角怀中',
          establishedIn: 2,
        },
      ],
    }
    const result = applyCanonicalFactsToState(state)
    expect(result.keyItemsLocation['龙纹玉佩']).toBe('主角怀中')
  })

  it('creates missing characterStatus entry from canonical fact when characters list provided', () => {
    const state: StoryState = {
      ...emptyState(),
      canonicalFacts: [
        {
          id: 'f2',
          subject: '顾承舟',
          attribute: '状态',
          value: '负伤',
          establishedIn: 3,
        },
      ],
    }
    const characters: Character[] = [{ id: 'c1', storyId: 's1', name: '顾承舟', description: '', dialogueStyle: '', createdAt: 0 }]
    const result = applyCanonicalFactsToState(state, characters)
    expect(result.characterStatus['顾承舟']).toBe('负伤')
  })
})


describe('detectSecretRevealConflicts', () => {
  it('does not flag re-reveal when only common words overlap', () => {
    const state: StoryState = {
      ...emptyState(),
      revealedSecrets: ['主角已经知道凶手是管家'],
    }
    const outline = '本章主角去了一个地方，发现了一些东西，和管家无关。'
    const conflicts = detectSecretRevealConflicts(state, outline)
    expect(conflicts).toHaveLength(0)
  })

  it('flags semantic re-reveal of a secret', () => {
    const state: StoryState = {
      ...emptyState(),
      revealedSecrets: ['真凶是管家'],
    }
    const outline = '本章继续调查，发现真凶就是管家。'
    const conflicts = detectSecretRevealConflicts(state, outline)
    expect(conflicts.length).toBeGreaterThan(0)
  })

  it('mergeStoryState keeps canonical facts with same subject-attribute but different values', () => {
    const base: StoryState = {
      ...emptyState(),
      canonicalFacts: [{ id: 'f1', subject: '玉佩', attribute: '所在位置', value: '桌上', establishedIn: 1 }],
    }
    const delta: StoryState = {
      ...emptyState(),
      canonicalFacts: [{ id: 'f2', subject: '玉佩', attribute: '所在位置', value: '主角怀中', establishedIn: 2 }],
    }
    const merged = mergeStoryState(base, delta)
    expect(merged.canonicalFacts?.length).toBe(2)
  })
})
