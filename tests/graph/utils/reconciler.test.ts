import { describe, expect, it, vi, beforeEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
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
} from '../../../src/graph/utils/reconciler/index.js'
import { BlockingConflictError } from '../../../src/utils/errors.js'
import { createEmptyStoryMemory } from '../../../src/story-memory/projector.js'
import type { StoryState, Conflict, StateOverride } from '../../../src/types/story-state.js'
import type { StoryMemory } from '../../../src/types/story-memory.js'
import type { Character } from '../../../src/types/character.js'
import type { ModelProvider } from '../../../src/model/provider.js'
import type { ReducedGraphState } from '../../../src/graph/state.js'
import type { ChapterSession } from '../../../src/core/chapter-generation/routing/types.js'
import { mergeItemRecordsExact } from '../../../src/utils/items.js'

const testTempDir = join(tmpdir(), `museflow-reconciler-${randomUUID().slice(0, 8)}`)

vi.mock('../../../src/utils/context-judge.js', async (importOriginal) => {
  const actual = await importOriginal<typeof contextJudge>()
  return {
    ...actual,
    batchExtractEntityChanges: vi.fn(),
    batchDetectTimeJumps: vi.fn(),
    batchJudgeBlockingConflictDescriptions: vi.fn(),
  }
})

vi.mock(
  '../../../src/core/chapter-generation/outline-revision-proposal.js',
  async (importOriginal) => {
    const actual = await importOriginal<typeof outlineRevision>()
    return {
      ...actual,
      generateOutlineRevisionProposal: vi.fn(),
    }
  }
)

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

function createMockProvider(): ModelProvider {
  return { chat: vi.fn(), chatStructured: vi.fn().mockResolvedValue({}) }
}

function makeConflict(overrides: Partial<Conflict>): Conflict {
  return {
    id: 'test',
    type: 'retcon',
    subject: '密信',
    attribute: 'location',
    oldValue: '书桌抽屉',
    newValue: '官府仓库',
    outlineReference: '',
    severity: 'auto',
    description: '',
    ...overrides,
  }
}

const characters: Character[] = [
  {
    id: '1',
    storyId: 's',
    name: '主角',
    aliases: [],
    isProtagonist: true,
    description: '',
    dialogueStyle: null,
    createdAt: 1,
  },
  {
    id: '2',
    storyId: 's',
    name: '侍女',
    aliases: [],
    isProtagonist: false,
    description: '',
    dialogueStyle: null,
    createdAt: 2,
  },
]

describe('mergeStoryState', () => {
  it('keeps decorated and undecorated item subjects distinct', () => {
    expect(mergeItemRecordsExact({ item_plain: 'loc-a' }, { '《item_plain》': 'loc-b' })).toEqual({
      item_plain: 'loc-a',
      '《item_plain》': 'loc-b',
    })
  })

  it('keeps parenthetical qualified base items when delta does not mention them', () => {
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
    expect(merged.keyItemsLocation).toEqual({
      '密信（残片）': '书桌抽屉附近',
      '密信（副本）': '主卧暗屉',
    })
  })

  it('keeps parenthetical qualified entries when delta adds an unqualified entry', () => {
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
        密信: '口袋中',
      },
    }
    const merged = mergeStoryState(existing, delta)
    expect(Object.keys(merged.keyItemsLocation).length).toBe(3)
    expect(merged.keyItemsLocation['密信']).toBe('口袋中')
    expect(merged.keyItemsLocation['密信（残片）']).toBe('书桌抽屉附近')
    expect(merged.keyItemsLocation['密信（副本）']).toBe('主卧暗屉')
  })

  it('merges supersededFacts and canonicalFacts without duplicates', () => {
    const existing: StoryState = {
      ...emptyState(),
      supersededFacts: [
        { subject: '密信', oldFact: '书桌抽屉附近', reason: '冲突', chapterIndex: 1 },
      ],
      canonicalFacts: [
        { id: 'cf1', subject: '密信', attribute: 'location', value: '主卧暗屉', establishedIn: 1 },
      ],
    }
    const delta: StoryState = {
      ...emptyState(),
      supersededFacts: [
        { subject: '密信', oldFact: '书桌抽屉附近', reason: '冲突', chapterIndex: 1 },
      ],
      canonicalFacts: [
        { id: 'cf1', subject: '密信', attribute: 'location', value: '主卧暗屉', establishedIn: 1 },
      ],
    }
    const merged = mergeStoryState(existing, delta)
    expect(merged.supersededFacts?.length).toBe(1)
    expect(merged.canonicalFacts?.length).toBe(1)
  })

  it('keeps distinct canonical facts for different subjects', () => {
    const existing: StoryState = {
      ...emptyState(),
      canonicalFacts: [
        { id: 'cf1', subject: '密信', attribute: 'location', value: '主卧暗屉', establishedIn: 1 },
      ],
    }
    const delta: StoryState = {
      ...emptyState(),
      canonicalFacts: [
        { id: 'cf2', subject: '匕首', attribute: 'location', value: '口袋', establishedIn: 2 },
      ],
    }
    const merged = mergeStoryState(existing, delta)
    expect(merged.canonicalFacts?.length).toBe(2)
  })

  it('keeps the latest canonical fact when subject, attribute and value collide', () => {
    const existing: StoryState = {
      ...emptyState(),
      canonicalFacts: [
        { id: 'cf1', subject: '密信', attribute: 'location', value: '官府仓库', establishedIn: 1 },
      ],
    }
    const delta: StoryState = {
      ...emptyState(),
      canonicalFacts: [
        { id: 'cf2', subject: '密信', attribute: 'location', value: '官府仓库', establishedIn: 5 },
      ],
    }
    const merged = mergeStoryState(existing, delta)
    expect(merged.canonicalFacts?.length).toBe(1)
    expect(merged.canonicalFacts?.[0].value).toBe('官府仓库')
    expect(merged.canonicalFacts?.[0].establishedIn).toBe(5)
  })

  it('does not overwrite newer canonical facts with older delta facts when value matches', () => {
    const existing: StoryState = {
      ...emptyState(),
      canonicalFacts: [
        { id: 'cf1', subject: '密信', attribute: 'location', value: '官府仓库', establishedIn: 5 },
      ],
    }
    const delta: StoryState = {
      ...emptyState(),
      canonicalFacts: [
        { id: 'cf2', subject: '密信', attribute: 'location', value: '官府仓库', establishedIn: 1 },
      ],
    }
    const merged = mergeStoryState(existing, delta)
    expect(merged.canonicalFacts?.length).toBe(1)
    expect(merged.canonicalFacts?.[0].value).toBe('官府仓库')
    expect(merged.canonicalFacts?.[0].establishedIn).toBe(5)
  })
})

describe('sanitizeStoryState', () => {
  it('does not infer ambiguity or merge identity from item wrappers', () => {
    const state: StoryState = {
      ...emptyState(),
      keyItemsLocation: {
        item_plain: 'loc-a',
        '《item_plain》': 'loc-b',
      },
    }

    const report = sanitizeStoryState(state, characters)

    expect(report.state.keyItemsLocation).toEqual(state.keyItemsLocation)
    expect(report.itemLocationConflicts).toEqual([])
    expect(report.ambiguousItems).toEqual([])
  })

  it('writes exact character names and aliases as EntityId keys', () => {
    const state: StoryState = {
      ...emptyState(),
      characterLocations: { 主角: '正厅', 阿侍: '门外' },
      characterStatus: { 主角: '冷静', 侍女: '疲惫' },
    }
    const explicitCharacters: Character[] = [
      {
        id: 'char-lead',
        storyId: 's',
        name: '主角',
        aliases: [],
        isProtagonist: true,
        description: '',
        dialogueStyle: null,
        createdAt: 1,
      },
      {
        id: 'char-attendant',
        storyId: 's',
        name: '侍女',
        aliases: ['阿侍'],
        isProtagonist: false,
        description: '',
        dialogueStyle: null,
        createdAt: 2,
      },
    ]

    const report = sanitizeStoryState(state, explicitCharacters)

    expect(report.state.characterLocations).toEqual({
      'char-lead': '正厅',
      'char-attendant': '门外',
    })
    expect(report.state.characterStatus).toEqual({
      'char-lead': '冷静',
      'char-attendant': '疲惫',
    })
  })

  it('removes invented characters from locations/status', () => {
    const state: StoryState = {
      ...emptyState(),
      characterLocations: { 主角: '正厅', 配角甲: '门外', 配角乙: '大厅' },
      characterStatus: { 主角: '冷静', 配角甲: '疲惫' },
    }
    const report = sanitizeStoryState(state, characters)
    expect(report.state.characterLocations).toEqual({ '1': '正厅' })
    expect(report.state.characterStatus).toEqual({ '1': '冷静' })
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
    const report = sanitizeStoryState(state, characters, {
      preserveExisting: true,
      existingStoryState,
    })
    expect(report.state.characterLocations).toEqual({ '1': '正厅', 权贵: '王府' })
    expect(report.state.characterStatus).toEqual({ '1': '冷静', 权贵: '阴沉' })
    expect(report.removedCharacters).toContain('配角甲')
  })

  it('keeps wrapper-distinct item locations without inferring a conflict', () => {
    const state: StoryState = {
      ...emptyState(),
      keyItemsLocation: {
        手记: '书桌抽屉',
        '《手记》': '木箱暗格',
      },
    }
    const report = sanitizeStoryState(state, characters)
    expect(report.state.keyItemsLocation).toEqual(state.keyItemsLocation)
    expect(report.itemLocationConflicts).toEqual([])
  })

  it('keeps parenthetical qualified item locations without generating alias conflicts', () => {
    const state: StoryState = {
      ...emptyState(),
      keyItemsLocation: {
        '密信（残片）': '书桌抽屉附近',
        '密信（副本）': '主卧暗屉',
      },
    }
    const report = sanitizeStoryState(state, characters, { chapterIndex: 5 })
    expect(report.state.keyItemsLocation).toEqual({
      '密信（残片）': '书桌抽屉附近',
      '密信（副本）': '主卧暗屉',
    })
    expect(report.state.supersededFacts).toEqual([])
    expect(report.state.canonicalFacts).toEqual([])
  })

  it('keeps active plots and secrets without reading their prose for character names', () => {
    const state: StoryState = {
      ...emptyState(),
      activePlots: ['配角甲出门办事'],
      revealedSecrets: ['配角乙偷了东西'],
    }
    const report = sanitizeStoryState(state, characters)
    expect(report.state.activePlots).toEqual(['配角甲出门办事'])
    expect(report.state.revealedSecrets).toEqual(['配角乙偷了东西'])
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
  })

  it('does not infer ambiguous item names from display wrappers', () => {
    const state: StoryState = {
      ...emptyState(),
      keyItemsLocation: {
        手记: '书桌抽屉',
        '《手记》': '书桌抽屉',
      },
    }
    const report = sanitizeStoryState(state, characters)
    expect(report.ambiguousItems).toEqual([])
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

  it('does not format inferred item conflicts', () => {
    const state: StoryState = {
      ...emptyState(),
      keyItemsLocation: {
        手记: '书桌抽屉',
        '《手记》': '木箱暗格',
      },
    }
    const report = sanitizeStoryState(state, characters)
    const formatted = formatStateConflicts(report)
    expect(formatted).toBe('')
  })
})

describe('applyCanonicalFactsToState', () => {
  it('updates keyItemsLocation based on canonical fact', () => {
    const state = emptyState()
    state.keyItemsLocation = { 密信: '书桌抽屉', 另一物品: '书架' }
    state.canonicalFacts = [
      { id: 'f1', subject: '密信', attribute: 'location', value: '官府仓库', establishedIn: 9 },
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
      characterLocations: { 主角: '正厅' },
      characterStatus: { 主角: '自由' },
      keyItemsLocation: { 密信: '书桌抽屉' },
      keyItemsState: { 密信: '完整' },
      revealedSecrets: ['主角是主谋'],
      storyTime: '故事时间第一天',
    }
  }

  it('returns a report with reconciled state', async () => {
    const report = await reconcileStoryState(
      baseState(),
      '第10章：主角前往天津。',
      [],
      9,
      createMockProvider()
    )
    expect(report.state).toBeDefined()
    expect(report.conflicts).toBeDefined()
    expect(report.autoResolved).toBeDefined()
    expect(report.requiresAuthorDecision).toBeDefined()
    expect(report.suggestedOverrides).toBeDefined()
  })

  it('auto-resolves item location retcon', async () => {
    const state = baseState()
    vi.mocked(contextJudge.batchExtractEntityChanges).mockResolvedValue([
      { skip: false, location: '官府仓库', state: null, changeKind: 'explicit_change' },
    ])

    const report = await reconcileStoryState(
      state,
      '第10章：密信被转移至官府仓库。',
      [],
      9,
      createMockProvider()
    )
    expect(report.autoResolved.some((c) => c.subject === '密信')).toBe(true)
    expect(report.state.keyItemsLocation['密信']).toBe('官府仓库')
    const activeFact = report.state.canonicalFacts?.find(
      (f) => f.subject === '密信' && f.retiredIn === undefined
    )
    expect(activeFact).toBeDefined()
    expect(activeFact?.value).toBe('官府仓库')
  })

  it('does not surface repeated secret reveals from prose matching', async () => {
    const state = baseState()
    vi.mocked(contextJudge.batchExtractEntityChanges).mockResolvedValue([])

    const report = await reconcileStoryState(
      state,
      '第10章：真相大白，主角是主谋。',
      [],
      9,
      createMockProvider()
    )
    expect(report.requiresAuthorDecision).toEqual([])
  })

  it('preserves canonical facts from input state and updates them', async () => {
    const state = baseState()
    state.canonicalFacts = [
      { id: 'f1', subject: '密信', attribute: 'location', value: '书桌抽屉', establishedIn: 8 },
    ]
    vi.mocked(contextJudge.batchExtractEntityChanges).mockResolvedValue([
      { skip: false, location: '官府仓库', state: null, changeKind: 'explicit_change' },
    ])

    const report = await reconcileStoryState(
      state,
      '第10章：密信被转移至官府仓库。',
      [],
      9,
      createMockProvider()
    )
    const activeFact = report.state.canonicalFacts?.find(
      (f) => f.subject === '密信' && f.retiredIn === undefined
    )
    expect(activeFact).toBeDefined()
    expect(activeFact?.value).toBe('官府仓库')
    expect(activeFact?.establishedIn).toBe(9)
    expect(activeFact?.supersedes?.length).toBeGreaterThan(0)
    expect(activeFact?.supersedes?.[0].chapter).toBe(8)

    const retiredFact = report.state.canonicalFacts?.find(
      (f) => f.subject === '密信' && f.retiredIn === 9
    )
    expect(retiredFact).toBeDefined()
    expect(retiredFact?.value).toBe('书桌抽屉')
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

  it('does not send retired canonical facts to the conflict model', async () => {
    const state: StoryState = {
      ...emptyState(),
      canonicalFacts: [
        {
          id: 'retired-identity',
          subject: 'c-protagonist',
          attribute: 'identity',
          value: 'former-role',
          establishedIn: 2,
          retiredIn: 4,
          confidence: 'high',
          source: 'chapter_text',
        },
      ],
    }
    const provider = { chat: vi.fn() } as unknown as ModelProvider

    const result = await detectOutlineStateConflicts(state, 'new outline', 5, provider)

    expect(result).toEqual({ conflicts: [], constraints: [] })
    expect(provider.chat).not.toHaveBeenCalled()
  })

  it('leaves ordinary active status snapshots to the transition reconciler', async () => {
    const state: StoryState = {
      ...emptyState(),
      canonicalFacts: [
        {
          id: 'status-snapshot',
          subject: 'c-protagonist',
          attribute: 'status',
          value: 'waiting',
          establishedIn: 2,
          confidence: 'high',
          source: 'reconciliation',
        },
      ],
    }
    const provider = { chat: vi.fn() } as unknown as ModelProvider

    const result = await detectOutlineStateConflicts(state, 'new outline', 5, provider)

    expect(result).toEqual({ conflicts: [], constraints: [] })
    expect(provider.chat).not.toHaveBeenCalled()
  })

  it('keeps active author-overridden status facts eligible for blocking', async () => {
    const state: StoryState = {
      ...emptyState(),
      canonicalFacts: [
        {
          id: 'author-status',
          subject: 'c-protagonist',
          attribute: 'status',
          value: 'must-wait',
          establishedIn: 2,
          confidence: 'high',
          source: 'author_override',
        },
      ],
    }
    const provider = {
      chat: vi.fn(async (): Promise<string> =>
        JSON.stringify({
          conflicts: [
            {
              subject: 'c-protagonist',
              attribute: 'status',
              oldValue: 'must-wait',
              newValue: 'leave',
              severity: 'blocking',
              description: 'author override conflict',
            },
          ],
          constraints: [],
        })
      ),
    } as unknown as ModelProvider

    const result = await detectOutlineStateConflicts(state, 'new outline', 5, provider)

    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0]?.severity).toBe('blocking')
  })

  it('parses model response into conflicts and constraints', async () => {
    const state: StoryState = {
      ...emptyState(),
      canonicalFacts: [
        {
          id: 'cf1',
          subject: '秘密退路',
          attribute: 'plan',
          value: '不写在账册上、不托付任何人，仅主角自己知道',
          establishedIn: 11,
        },
      ],
    }

    const provider = {
      chat: vi.fn(async (): Promise<string> =>
        JSON.stringify({
          conflicts: [
            {
              subject: '秘密退路',
              attribute: 'plan',
              oldValue: '不托付任何人',
              newValue: '寄养于外姓友人',
              severity: 'warning',
              description: '大纲要求将幼子寄养于外姓友人，与权威事实存在张力',
            },
          ],
          constraints: ['若本章执行寄养，必须明确是前两条已建立退路的落实'],
        })
      ),
    } as unknown as ModelProvider

    const result = await detectOutlineStateConflicts(
      state,
      '主角被迫将幼子寄养于外姓友人家中',
      16,
      provider
    )
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0].severity).toBe('warning')
    expect(result.conflicts[0].type).toBe('contradiction')
    expect(result.constraints).toHaveLength(1)
    expect(result.constraints[0]).toContain('前两条已建立退路')
  })

  it('falls back to empty result on model error', async () => {
    const provider = {
      chat: vi.fn(async (): Promise<string> => {
        throw new Error('模型调用失败')
      }),
    } as unknown as ModelProvider

    const result = await detectOutlineStateConflicts(emptyState(), '大纲描述', 5, provider)
    expect(result.conflicts).toHaveLength(0)
    expect(result.constraints).toHaveLength(0)
  })

  it('falls back to chat when chatStructured cannot produce structured output', async () => {
    const state: StoryState = {
      ...emptyState(),
      canonicalFacts: [
        {
          id: 'cf-identity-plan',
          subject: '身份',
          attribute: 'plan',
          value: '等待听信',
          establishedIn: 24,
        },
      ],
    }
    const provider = {
      chatStructured: vi.fn(async () => {
        throw new Error('Anthropic API did not return structured output')
      }),
      chat: vi.fn(
        async (): Promise<string> =>
          '```json\n{"conflicts":[{"subject":"身份","attribute":"plan","oldValue":"等待听信","newValue":"已入府办差","severity":"warning","description":"大纲将听信结果提前，需要写作时交代时间衔接"}],"constraints":["必须交代听信结果为何已落定"]}\n```'
      ),
    } as unknown as ModelProvider

    const result = await detectOutlineStateConflicts(state, '主角已入府办差。', 25, provider)

    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0].description).toContain('时间衔接')
    expect(result.constraints).toEqual(['必须交代听信结果为何已落定'])
    expect(provider.chat).toHaveBeenCalledTimes(1)
  })

  it('runs canonical-fact alignment even when storyMemory is present', async () => {
    const state: StoryState & { storyMemory?: object } = {
      ...emptyState(),
      canonicalFacts: [
        {
          id: 'cf1',
          subject: '密信',
          attribute: 'location',
          value: '官府仓库',
          establishedIn: 5,
          source: 'author_override',
        },
      ],
      storyMemory: {
        version: '1',
        lastChapterIndex: 5,
        entities: { characters: {}, items: {}, locations: {}, factions: {}, plots: {} },
        events: [],
        foreshadows: {},
        beats: {},
        tasks: {},
      },
    }
    const storyArc = {
      totalChapters: 10,
      acts: [
        {
          index: 1,
          startChapter: 1,
          endChapter: 10,
          title: 'Act 1',
          theme: '',
          function: '',
          mandatoryBeats: [],
        },
      ],
      keyBeats: [],
    }

    const provider = {
      chat: vi.fn(async (): Promise<string> =>
        JSON.stringify({
          conflicts: [
            {
              subject: '密信',
              attribute: 'location',
              oldValue: '官府仓库',
              newValue: '王府',
              severity: 'warning',
              description: '大纲将密信位置改为王府',
            },
          ],
          constraints: [],
        })
      ),
    } as unknown as ModelProvider

    const result = await detectOutlineStateConflicts(
      state,
      '密信被转移至王府。',
      6,
      provider,
      storyArc
    )
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0].subject).toBe('密信')
  })

  it('only checks canonical facts whose subjects are in filterSubjects', async () => {
    const state: StoryState = {
      ...emptyState(),
      canonicalFacts: [
        {
          id: 'cf1',
          subject: '密信',
          attribute: 'identity',
          value: '官府密件',
          establishedIn: 5,
        },
        {
          id: 'cf2',
          subject: '匕首',
          attribute: 'identity',
          value: '身份信物',
          establishedIn: 5,
        },
      ],
    }

    const provider = {
      chat: vi.fn(async (): Promise<string> =>
        JSON.stringify({
          conflicts: [
            {
              subject: '密信',
              attribute: 'identity',
              oldValue: '官府密件',
              newValue: '王府私信',
              severity: 'warning',
              description: '大纲将密信位置改为王府',
            },
          ],
          constraints: [],
        })
      ),
    } as unknown as ModelProvider

    const result = await detectOutlineStateConflicts(
      state,
      '密信被转移至王府。',
      6,
      provider,
      undefined,
      new Set(['密信'])
    )
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0].subject).toBe('密信')
    const calls = vi.mocked(provider.chat).mock.calls[0]
    const messages = calls?.[0] as Array<{ role?: string; content?: string }> | undefined
    const userMessage = messages?.find((m) => m.role === 'user')
    const prompt = userMessage?.content ?? ''
    expect(prompt).toContain('密信')
    expect(prompt).not.toContain('匕首')
  })
})

describe('detectSecretRevealConflicts', () => {
  it('does not infer secret re-hiding from prose matching', () => {
    const state: StoryState = {
      ...emptyState(),
      revealedSecrets: ['主角是主谋'],
    }
    const conflicts = detectSecretRevealConflicts(state, '众人仍不知主角是主谋')
    expect(conflicts).toHaveLength(0)
  })

  it('ignores outline that simply reuses a revealed secret', () => {
    const state: StoryState = {
      ...emptyState(),
      revealedSecrets: ['主角是主谋'],
    }
    const conflicts = detectSecretRevealConflicts(state, '主角是主谋的事实震惊了所有人')
    expect(conflicts).toHaveLength(0)
  })

  it('returns empty array when no secrets are revealed', () => {
    const state = emptyState()
    const conflicts = detectSecretRevealConflicts(state, '众人仍不知真相')
    expect(conflicts).toHaveLength(0)
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
    state.keyItemsLocation = { 密信: '书桌抽屉' }
    vi.mocked(contextJudge.batchExtractEntityChanges).mockResolvedValueOnce([
      { skip: false, location: '官府仓库', state: null, changeKind: 'explicit_change' },
    ])

    const conflicts = await detectItemLocationConflicts(
      state,
      '第10章：密信被转移至官府仓库。',
      createMockProvider()
    )
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].subject).toBe('密信')
    expect(conflicts[0].newValue).toBe('官府仓库')
    expect(conflicts[0].type).toBe('retcon')
  })

  it('ignores item location extracted only from scene context', async () => {
    const state = emptyState()
    state.keyItemsLocation = {
      密信: '书桌抽屉',
      白玉牌: '赵管事腰间',
    }
    vi.mocked(contextJudge.batchExtractEntityChanges).mockResolvedValueOnce([
      { skip: false, location: '官府仓库', state: null, changeKind: 'explicit_change' },
      { skip: false, location: '官府仓库', state: null, changeKind: 'scene_context' },
    ])

    const conflicts = await detectItemLocationConflicts(
      state,
      '第10章：主角抵达官府仓库，密信被转移至官府仓库。',
      createMockProvider()
    )

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].subject).toBe('密信')
  })

  it('detects character status retcon', async () => {
    const state = emptyState()
    state.characterStatus = { 主角: '自由' }
    vi.mocked(contextJudge.batchExtractEntityChanges).mockResolvedValueOnce([
      { skip: false, location: null, state: '身受重伤', changeKind: 'explicit_change' },
    ])

    const conflicts = await detectCharacterStatusConflicts(
      state,
      '第10章：主角已身受重伤。',
      createMockProvider()
    )
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].subject).toBe('主角')
    expect(conflicts[0].attribute).toBe('status')
  })

  it('classifies location retcon as auto and status retcon as warning', async () => {
    const conflicts = [
      makeConflict({ id: '1', attribute: 'location' }),
      makeConflict({ id: '2', attribute: 'status' }),
    ]
    const results = await classifyConflicts(conflicts, createMockProvider())
    expect(results[0].severity).toBe('auto')
    expect(results[1].severity).toBe('warning')
  })

  it('does not elevate an ordinary location transition to blocking', async () => {
    const conflict = makeConflict({ type: 'retcon', description: 'location transition' })
    vi.mocked(contextJudge.batchJudgeBlockingConflictDescriptions).mockResolvedValueOnce([true])
    const result = await classifyConflicts([conflict], createMockProvider())
    expect(result[0].type).toBe('retcon')
    expect(result[0].severity).toBe('auto')
  })

  it('never elevates an advisory time jump to blocking', async () => {
    const conflict = makeConflict({
      type: 'time_jump',
      subject: '叙事时间',
      attribute: 'event',
      severity: 'auto',
    })
    vi.mocked(contextJudge.batchJudgeBlockingConflictDescriptions).mockResolvedValueOnce([true])

    const [result] = await classifyConflicts([conflict], createMockProvider())

    expect(result).toMatchObject({ type: 'time_jump', severity: 'auto' })
  })

  it('auto-resolves narrative time progression even when blocking classification returns true', async () => {
    vi.mocked(contextJudge.batchDetectTimeJumps).mockResolvedValueOnce([true])
    vi.mocked(contextJudge.batchJudgeBlockingConflictDescriptions).mockResolvedValueOnce([true])

    const report = await reconcileStoryState(
      { ...emptyState(), storyTime: '第一日丑时将至' },
      '夜色渐深，众人继续等候下一次鼓声。',
      [],
      9,
      createMockProvider()
    )

    expect(report.autoResolved).toEqual([
      expect.objectContaining({ type: 'time_jump', severity: 'auto' }),
    ])
    expect(report.requiresAuthorDecision).toEqual([])
  })

  it('excludes time jumps from blocking classification while preserving genuine conflicts', async () => {
    const conflicts = [
      makeConflict({
        id: 'time',
        type: 'time_jump',
        subject: '叙事时间',
        attribute: 'event',
        description: 'advisory time transition',
      }),
      makeConflict({
        id: 'hard',
        type: 'extension',
        attribute: 'event',
        description: 'established event reversal',
      }),
    ]
    vi.mocked(contextJudge.batchJudgeBlockingConflictDescriptions).mockResolvedValueOnce([true])

    const results = await classifyConflicts(conflicts, createMockProvider())

    expect(contextJudge.batchJudgeBlockingConflictDescriptions).toHaveBeenCalledWith(
      expect.anything(),
      ['established event reversal']
    )
    expect(results[0]).toMatchObject({ type: 'time_jump', severity: 'auto' })
    expect(results[1]).toMatchObject({ type: 'contradiction', severity: 'blocking' })
  })

  it('only checks item locations in filterSubjects when filter is provided', async () => {
    const state = emptyState()
    state.keyItemsLocation = { 密信: '书桌抽屉', 白玉牌: '赵管事腰间' }
    vi.mocked(contextJudge.batchExtractEntityChanges).mockResolvedValueOnce([
      { skip: false, location: '官府仓库', state: null, changeKind: 'explicit_change' },
      { skip: false, location: '官府仓库', state: null, changeKind: 'explicit_change' },
    ])

    const conflicts = await detectItemLocationConflicts(
      state,
      '第10章：密信与白玉牌都被转移至官府仓库。',
      createMockProvider(),
      new Set(['密信'])
    )

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].subject).toBe('密信')
  })

  it('only checks character status in filterSubjects when filter is provided', async () => {
    const state = emptyState()
    state.characterStatus = { 主角: '自由', 侍女: '自由' }
    vi.mocked(contextJudge.batchExtractEntityChanges).mockResolvedValueOnce([
      { skip: false, location: null, state: '身受重伤', changeKind: 'explicit_change' },
      { skip: false, location: null, state: '身亡', changeKind: 'explicit_change' },
    ])

    const conflicts = await detectCharacterStatusConflicts(
      state,
      '第10章：主角身受重伤，侍女身亡。',
      createMockProvider(),
      new Set(['主角'])
    )

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].subject).toBe('主角')
  })
})

describe('applyAuthorOverrides', () => {
  it('applies author location overrides to characters and items', () => {
    const state: StoryState = {
      ...emptyState(),
      characterLocations: { 主角: '家中' },
      keyItemsLocation: { 钥匙: '口袋', '钥匙（箱用）': '口袋' },
    }
    const overrides: StateOverride[] = [
      {
        id: 'o1',
        subject: '主角',
        attribute: 'location',
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
        attribute: 'location',
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
    expect(result.keyItemsLocation['钥匙（箱用）']).toBe('口袋')
    expect(result.canonicalFacts?.some((f) => f.subject === '主角' && f.value === '城外')).toBe(
      true
    )
    expect(result.canonicalFacts?.some((f) => f.subject === '钥匙' && f.value === '箱内')).toBe(
      true
    )
  })

  it('applies author status overrides', () => {
    const state: StoryState = {
      ...emptyState(),
      characterStatus: { 主角: '健康' },
      keyItemsState: { 宝箱: '锁着' },
    }
    const overrides: StateOverride[] = [
      {
        id: 'o1',
        subject: '主角',
        attribute: 'status',
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
    expect(result.canonicalFacts?.[0].attribute).toBe('status')
    expect(result.canonicalFacts?.[0].value).toBe('负伤')
  })
})

describe('formatStoryState', () => {
  it('renders exact item identities without grouping aliases', () => {
    const state: StoryState = {
      ...emptyState(),
      keyItemsLocation: {
        长剑: '墙上',
        '《长剑》': '墙上',
        '长剑（祖传）': '墙上',
        血书: '怀中',
      },
      keyItemsState: {
        长剑: '锋利',
        '《长剑》': '锋利',
      },
    }
    const text = formatStoryState(state)
    expect(text).toContain('长剑：墙上')
    expect(text).toContain('《长剑》：墙上')
    expect(text).toContain('长剑（祖传）：墙上')
    expect(text).not.toContain('亦称')
    expect(text).toContain('血书：怀中')
    expect(text).toContain('锋利')
  })

  function buildEntities(): StoryMemory['entities'] {
    return {
      characters: {
        'c-linxuan': {
          id: 'c-linxuan',
          name: '林玄',
          locationId: null,
          status: {},
          introducedIn: 0,
        },
      },
      items: {
        'i-jade': {
          id: 'i-jade',
          name: '通灵宝玉',
          holderId: null,
          locationId: null,
          state: {},
          introducedIn: 0,
        },
      },
      locations: {
        'l-temple': { id: 'l-temple', name: '破庙', introducedIn: 0 },
      },
      factions: {},
      plots: {},
    }
  }

  it('renders entity IDs as readable 名称（id） labels when entities are provided', () => {
    const state: StoryState = {
      ...emptyState(),
      characterLocations: { 'c-linxuan': 'l-temple' },
      characterStatus: { 'c-linxuan': '受伤' },
      keyItemsLocation: { 'i-jade': 'c-linxuan' },
      keyItemsState: { 'i-jade': '封印中' },
    }

    const text = formatStoryState(state, buildEntities())

    expect(text).toContain('林玄（c-linxuan）：破庙（l-temple）')
    expect(text).toContain('林玄（c-linxuan）：受伤')
    expect(text).toContain('通灵宝玉（i-jade）：林玄（c-linxuan）')
    expect(text).toContain('通灵宝玉（i-jade）：封印中')
  })

  it('keeps unknown IDs and natural-language values as-is', () => {
    const state: StoryState = {
      ...emptyState(),
      characterLocations: { 'c-stranger': '怀中' },
      keyItemsLocation: { 长剑: '墙上' },
    }

    const text = formatStoryState(state, buildEntities())

    expect(text).toContain('c-stranger：怀中')
    expect(text).toContain('长剑：墙上')
  })

  it('works without entities for backward compatibility', () => {
    const state: StoryState = {
      ...emptyState(),
      characterLocations: { 'c-linxuan': 'l-temple' },
    }

    const text = formatStoryState(state)

    expect(text).toContain('c-linxuan：l-temple')
  })

  it('caps revealedSecrets and supersededFacts to the most recent entries', () => {
    const state: StoryState = {
      ...emptyState(),
      revealedSecrets: Array.from({ length: 25 }, (_, i) => `秘密${i}`),
      supersededFacts: Array.from({ length: 25 }, (_, i) => ({
        subject: `主题${i}`,
        oldFact: `旧事实${i}`,
        reason: '测试',
        chapterIndex: i,
      })),
    }

    const text = formatStoryState(state)

    expect(text).toContain('秘密24')
    expect(text).toContain('秘密5')
    expect(text).not.toContain('秘密4')
    expect(text).toContain('旧事实24')
    expect(text).toContain('旧事实5')
    expect(text).not.toContain('旧事实4')
  })

  it('renders only active canonical facts and caps them to the most recent', () => {
    const facts = Array.from({ length: 25 }, (_, i) => ({
      id: `cf-${i}`,
      subject: `事实${i}`,
      attribute: 'status' as const,
      value: `值${i}`,
      establishedIn: i,
      confidence: 'high' as const,
      source: 'chapter_text' as const,
    }))
    facts[24] = { ...facts[24]!, retiredIn: 30 }
    const state: StoryState = {
      ...emptyState(),
      canonicalFacts: facts,
    }

    const text = formatStoryState(state)

    expect(text).toContain('[事实23]')
    expect(text).toContain('[事实4]')
    expect(text).not.toContain('[事实3]')
    // retired fact must not be rendered
    expect(text).not.toContain('[事实24]')
  })

  it('skips projection location entries overridden by an active canonical fact', () => {
    const state: StoryState = {
      ...emptyState(),
      characterLocations: { 'c-1': 'loc-old', 'c-2': 'loc-a' },
      keyItemsLocation: { 'item-1': 'deeper', 'item-2': 'loc-a' },
      canonicalFacts: [
        {
          id: 'fact-1',
          subject: 'item-1',
          attribute: 'location',
          value: 'loc-b',
          establishedIn: 24,
          confidence: 'high',
          source: 'state_repair',
        },
        {
          id: 'fact-2',
          subject: 'c-1',
          attribute: 'location',
          value: 'loc-c',
          establishedIn: 24,
          confidence: 'high',
          source: 'state_repair',
        },
      ],
    }

    const text = formatStoryState(state)

    // 有 active 权威位置事实的实体：投影条目跳过，位置由【权威事实】段呈现
    expect(text).not.toContain('item-1：deeper')
    expect(text).not.toContain('c-1：loc-old')
    expect(text).toContain('[item-1] location: loc-b')
    expect(text).toContain('[c-1] location: loc-c')
    // 没有权威事实的实体投影照常渲染
    expect(text).toContain('c-2：loc-a')
    expect(text).toContain('item-2：loc-a')
  })

  it('renders the projection again once the canonical location fact is retired', () => {
    const state: StoryState = {
      ...emptyState(),
      keyItemsLocation: { 'item-1': 'deeper' },
      canonicalFacts: [
        {
          id: 'fact-1',
          subject: 'item-1',
          attribute: 'location',
          value: 'loc-b',
          establishedIn: 24,
          retiredIn: 30,
          confidence: 'high',
          source: 'state_repair',
        },
      ],
    }

    const text = formatStoryState(state)

    expect(text).toContain('item-1：deeper')
    expect(text).not.toContain('[item-1] location: loc-b')
  })

  it('renders the 权威事实 section with exact formatting (snapshot)', () => {
    const state: StoryState = {
      ...emptyState(),
      canonicalFacts: [
        {
          id: 'fact-1',
          subject: 'item-1',
          attribute: 'location',
          value: 'loc-b',
          establishedIn: 2,
          confidence: 'high',
          source: 'chapter_text',
          supersedes: [{ chapter: 0, oldValue: 'loc-a' }],
        },
        {
          id: 'fact-2',
          subject: 'c-1',
          attribute: 'status',
          value: '受伤',
          establishedIn: 4,
          confidence: 'medium',
          source: 'outline_inference',
        },
        {
          id: 'fact-3',
          subject: 'c-2',
          attribute: 'location',
          value: 'loc-c',
          establishedIn: 6,
          retiredIn: 8,
          confidence: 'high',
          source: 'state_repair',
        },
      ],
    }

    expect(formatStoryState(state)).toMatchInlineSnapshot(`
      "【权威事实】
        - [item-1] location: loc-b (第3章确立)
          覆盖第1章: loc-a
        - [c-1] status: 受伤 (第5章确立)（大纲推断，提示级，正文优先）"
    `)
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
    vi.mocked(outlineRevision.generateOutlineRevisionProposal).mockReset()
    vi.mocked(outlineRevision.generateOutlineRevisionProposal).mockResolvedValue(null)
  })

  function buildBaseSession(overrides: Partial<ChapterSession> = {}): ChapterSession {
    return {
      chapterIndex: 0,
      rewriteAttempts: 0,
      errorRewriteAttempts: 0,
      autoFixAttempts: 0,
      previousIssues: [],
      previousRawErrorCount: 0,
      routingDecision: undefined,
      forceStructuralRewrite: false,
      rewriteApproved: false,
      ...overrides,
    }
  }

  function makeState(): ReducedGraphState {
    return {
      story: {
        id: 's1',
        title: 'Test',
        outputDir: testTempDir,
        createdAt: 1,
        updatedAt: 1,
        status: 'writing',
        genre: 'default',
        totalChapters: 3,
      } as ReducedGraphState['story'],
      idea: '',
      genre: 'default',
      totalChapters: 3,
      world: null,
      characters: [
        {
          id: 'c1',
          storyId: 's1',
          name: '主角',
          aliases: [],
          isProtagonist: true,
          description: '',
          dialogueStyle: null,
          createdAt: 1,
        },
      ],
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
        characterLocations: { 主角: '家中' },
        canonicalFacts: [
          {
            id: 'f1',
            subject: '主角',
            attribute: 'location',
            value: '家中',
            establishedIn: 1,
            source: 'author_override',
          },
        ],
      },
      chapterTimeAnchor: undefined,
      verifiedConstraints: [],
      chapterReport: null,
      session: buildBaseSession(),
      authorDecisions: {},
    }
  }

  it('throws BlockingConflictError when outline contradicts canonical fact at blocking severity', async () => {
    const state = makeState()
    const provider = {
      chat: vi.fn(async (): Promise<string> =>
        JSON.stringify({
          conflicts: [
            {
              subject: '主角',
              attribute: 'location',
              oldValue: '家中',
              newValue: '京城',
              severity: 'blocking',
              description: '大纲要求主角抵达京城，与权威事实冲突',
            },
          ],
          constraints: [],
        })
      ),
    } as unknown as ModelProvider
    vi.mocked(contextJudge.batchExtractEntityChanges).mockResolvedValue([])
    vi.mocked(outlineRevision.generateOutlineRevisionProposal).mockResolvedValue(null)

    await expect(prepareStoryStateForChapter(state, 0, provider)).rejects.toBeInstanceOf(
      BlockingConflictError
    )
  })

  it('attaches an outline revision proposal to BlockingConflictError when one is generated', async () => {
    const state = makeState()
    const provider = {
      chat: vi.fn(async (): Promise<string> =>
        JSON.stringify({
          conflicts: [
            {
              subject: '主角',
              attribute: 'location',
              oldValue: '家中',
              newValue: '京城',
              severity: 'blocking',
              description: '大纲要求主角抵达京城，与权威事实冲突',
            },
          ],
          constraints: [],
        })
      ),
    } as unknown as ModelProvider
    vi.mocked(contextJudge.batchExtractEntityChanges).mockResolvedValue([])
    vi.mocked(outlineRevision.generateOutlineRevisionProposal).mockResolvedValue({
      revisedDescription: '主角在家中收到京城来信，决定暂缓出行。',
      explanation: '避免与主角仍在家的权威事实冲突。',
    })

    await expect(prepareStoryStateForChapter(state, 0, provider)).rejects.toMatchObject({
      proposal: {
        revisedDescription: '主角在家中收到京城来信，决定暂缓出行。',
        explanation: '避免与主角仍在家的权威事实冲突。',
      },
    })
  })

  it('does not generate a nested proposal when proposalMode is omit', async () => {
    const state = makeState()
    const provider = {
      chat: vi.fn(async (): Promise<string> =>
        JSON.stringify({
          conflicts: [
            {
              subject: '主角',
              attribute: 'location',
              oldValue: '家中',
              newValue: '京城',
              severity: 'blocking',
              description: '大纲要求主角抵达京城，与权威事实冲突',
            },
          ],
          constraints: [],
        })
      ),
    } as unknown as ModelProvider

    await expect(
      prepareStoryStateForChapter(state, 0, provider, { proposalMode: 'omit' })
    ).rejects.toMatchObject({ proposal: undefined })
    expect(outlineRevision.generateOutlineRevisionProposal).not.toHaveBeenCalled()
  })

  it('skips blocking conflicts that have an author decision', async () => {
    const state = makeState()
    state.authorDecisions = { 'outline-state:主角:location:0': 'canonical' }
    const provider = {
      chat: vi.fn(async (): Promise<string> =>
        JSON.stringify({
          conflicts: [
            {
              subject: '主角',
              attribute: 'location',
              oldValue: '家中',
              newValue: '京城',
              severity: 'blocking',
              description: '大纲要求主角抵达京城，与权威事实冲突',
            },
          ],
          constraints: [],
        })
      ),
    } as unknown as ModelProvider
    vi.mocked(contextJudge.batchExtractEntityChanges).mockResolvedValue([])

    const result = await prepareStoryStateForChapter(state, 0, provider)
    expect(result).toBeDefined()
    expect(result.stateConflicts).toContain('大纲要求主角抵达京城')
  })

  it('authorizes new facts introduced by the outline', async () => {
    const state = makeState()
    const provider = {
      chat: vi
        .fn()
        .mockResolvedValueOnce(
          JSON.stringify({
            conflicts: [],
            constraints: [],
          })
        )
        .mockResolvedValueOnce(
          JSON.stringify({
            facts: [
              {
                subject: '密信',
                attribute: 'origin',
                value: '旧友暗中递送',
                contradictsExisting: false,
              },
              {
                subject: '暗桩',
                attribute: 'identity',
                value: '主角旧部',
                contradictsExisting: false,
              },
            ],
          })
        ),
    } as unknown as ModelProvider
    vi.mocked(contextJudge.batchExtractEntityChanges).mockResolvedValue([])

    const result = await prepareStoryStateForChapter(state, 0, provider)
    expect(
      result.reconciledState.canonicalFacts?.some(
        (f) =>
          f.subject === '密信' &&
          f.attribute === 'origin' &&
          f.value === '旧友暗中递送' &&
          f.source === 'outline_inference'
      )
    ).toBe(true)
    expect(
      result.reconciledState.canonicalFacts?.some(
        (f) =>
          f.subject === '暗桩' &&
          f.attribute === 'identity' &&
          f.value === '主角旧部' &&
          f.establishedIn === 0
      )
    ).toBe(true)
  })

  it('does not authorize facts that contradict existing canonical facts', async () => {
    const state = makeState()
    const provider = {
      chat: vi
        .fn()
        .mockResolvedValueOnce(
          JSON.stringify({
            conflicts: [],
            constraints: [],
          })
        )
        .mockResolvedValueOnce(
          JSON.stringify({
            facts: [
              { subject: '主角', attribute: 'location', value: '京城', contradictsExisting: true },
            ],
          })
        ),
    } as unknown as ModelProvider
    vi.mocked(contextJudge.batchExtractEntityChanges).mockResolvedValue([])

    const result = await prepareStoryStateForChapter(state, 0, provider)
    expect(
      result.reconciledState.canonicalFacts?.some((f) => f.subject === '主角' && f.value === '京城')
    ).toBe(false)
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
      chat: vi.fn(async (): Promise<string> =>
        JSON.stringify({
          facts: [
            {
              subject: '主角',
              attribute: 'status',
              value: '负伤',
              contradictsExisting: false,
            },
            {
              subject: '暗桩',
              attribute: 'identity',
              value: '主角旧部',
              contradictsExisting: false,
            },
          ],
        })
      ),
    } as unknown as ModelProvider

    const result = await authorizeOutlineFacts(state, '主角负伤后与旧部暗桩接头。', 4, provider)
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({
      subject: '主角',
      attribute: 'status',
      value: '负伤',
      establishedIn: 4,
      source: 'outline_inference',
    })
    expect(result[1]).toMatchObject({
      subject: '暗桩',
      attribute: 'identity',
      value: '主角旧部',
      establishedIn: 4,
      source: 'outline_inference',
    })
  })

  it('rejects location and holder attributes even when the model returns them', async () => {
    const state = emptyState()
    const provider = {
      chat: vi.fn(async (): Promise<string> =>
        JSON.stringify({
          facts: [
            {
              subject: '主角',
              attribute: 'location',
              value: '废弃仓库',
              contradictsExisting: false,
            },
            {
              subject: '密信',
              attribute: 'holder',
              value: '主角',
              contradictsExisting: false,
            },
            {
              subject: '暗桩',
              attribute: 'identity',
              value: '主角旧部',
              contradictsExisting: false,
            },
          ],
        })
      ),
    } as unknown as ModelProvider

    const result = await authorizeOutlineFacts(state, '大纲描述', 4, provider)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      subject: '暗桩',
      attribute: 'identity',
      value: '主角旧部',
    })
  })

  it('rejects facts whose subject is not a known entity id when storyMemory is present', async () => {
    const memory = createEmptyStoryMemory()
    memory.entities.characters['c-hero'] = {
      id: 'c-hero',
      name: '主角',
      locationId: null,
      status: {},
      introducedIn: 0,
    }
    const state: StoryState & { storyMemory: StoryMemory } = {
      ...emptyState(),
      storyMemory: memory,
    }
    const provider = {
      chat: vi.fn(async (): Promise<string> =>
        JSON.stringify({
          facts: [
            {
              subject: 'c-hero',
              attribute: 'status',
              value: '负伤',
              contradictsExisting: false,
            },
            {
              subject: 'c-stranger',
              attribute: 'identity',
              value: '旧部',
              contradictsExisting: false,
            },
          ],
        })
      ),
    } as unknown as ModelProvider

    const result = await authorizeOutlineFacts(state, '大纲描述', 4, provider)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      subject: 'c-hero',
      attribute: 'status',
      value: '负伤',
    })
  })

  it('rejects facts conflicting with structured state projections', async () => {
    const state: StoryState = {
      ...emptyState(),
      characterStatus: { 主角: '健康' },
    }
    const provider = {
      chat: vi.fn(async (): Promise<string> =>
        JSON.stringify({
          facts: [
            {
              subject: '主角',
              attribute: 'status',
              value: '负伤',
              contradictsExisting: false,
            },
            {
              subject: '暗桩',
              attribute: 'identity',
              value: '主角旧部',
              contradictsExisting: false,
            },
          ],
        })
      ),
    } as unknown as ModelProvider

    const result = await authorizeOutlineFacts(state, '大纲描述', 4, provider)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      subject: '暗桩',
      attribute: 'identity',
      value: '主角旧部',
    })
  })

  it('skips facts already present in canonical facts', async () => {
    const state: StoryState = {
      ...emptyState(),
      canonicalFacts: [
        { id: 'f1', subject: '主角', attribute: 'status', value: '负伤', establishedIn: 4 },
      ],
    }
    const provider = {
      chat: vi.fn(async (): Promise<string> =>
        JSON.stringify({
          facts: [
            {
              subject: '主角',
              attribute: 'status',
              value: '负伤',
              contradictsExisting: false,
            },
          ],
        })
      ),
    } as unknown as ModelProvider

    const result = await authorizeOutlineFacts(state, '主角负伤休养。', 4, provider)
    expect(result).toHaveLength(0)
  })

  it('skips facts flagged as contradicting existing facts', async () => {
    const state: StoryState = {
      ...emptyState(),
      canonicalFacts: [
        { id: 'f1', subject: '主角', attribute: 'status', value: '健康', establishedIn: 1 },
      ],
    }
    const provider = {
      chat: vi.fn(async (): Promise<string> =>
        JSON.stringify({
          facts: [
            { subject: '主角', attribute: 'status', value: '负伤', contradictsExisting: true },
          ],
        })
      ),
    } as unknown as ModelProvider

    const result = await authorizeOutlineFacts(state, '主角身受重伤。', 4, provider)
    expect(result).toHaveLength(0)
  })

  it('falls back to empty array on model error', async () => {
    const provider = {
      chat: vi.fn(async (): Promise<string> => {
        throw new Error('模型调用失败')
      }),
    } as unknown as ModelProvider

    const result = await authorizeOutlineFacts(emptyState(), '大纲描述', 0, provider)
    expect(result).toHaveLength(0)
  })

  it('falls back to chat when chatStructured returns markdown-wrapped JSON', async () => {
    const state = emptyState()
    const provider = {
      chatStructured: vi.fn(async () => {
        throw new Error('Anthropic API did not return structured output')
      }),
      chat: vi.fn(
        async (): Promise<string> =>
          '```json\n{"facts":[{"subject":"暗桩","attribute":"身份","value":"主角旧部","contradictsExisting":false}]}\n```'
      ),
    } as unknown as ModelProvider

    const result = await authorizeOutlineFacts(state, '主角与旧部暗桩接头。', 4, provider)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      subject: '暗桩',
      attribute: 'identity',
      value: '主角旧部',
      establishedIn: 4,
      source: 'outline_inference',
    })
    expect(provider.chat).toHaveBeenCalledTimes(1)
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
          attribute: 'location',
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
          attribute: 'status',
          value: '负伤',
          establishedIn: 3,
        },
      ],
    }
    const characters: Character[] = [
      {
        id: 'c1',
        storyId: 's1',
        name: '顾承舟',
        aliases: [],
        isProtagonist: true,
        description: '',
        dialogueStyle: '',
        createdAt: 0,
      },
    ]
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

  it('does not flag semantic re-reveal from prose similarity', () => {
    const state: StoryState = {
      ...emptyState(),
      revealedSecrets: ['真凶是管家'],
    }
    const outline = '本章继续调查，发现真凶就是管家。'
    const conflicts = detectSecretRevealConflicts(state, outline)
    expect(conflicts).toEqual([])
  })

  it('mergeStoryState keeps canonical facts with same subject-attribute but different values', () => {
    const base: StoryState = {
      ...emptyState(),
      canonicalFacts: [
        { id: 'f1', subject: '玉佩', attribute: 'location', value: '桌上', establishedIn: 1 },
      ],
    }
    const delta: StoryState = {
      ...emptyState(),
      canonicalFacts: [
        { id: 'f2', subject: '玉佩', attribute: 'location', value: '主角怀中', establishedIn: 2 },
      ],
    }
    const merged = mergeStoryState(base, delta)
    expect(merged.canonicalFacts?.length).toBe(2)
  })
})

describe('mergeStoryState outline_inference supersede semantics', () => {
  it('incoming fact supersedes a conflicting outline_inference fact and records the old value', () => {
    const base: StoryState = {
      ...emptyState(),
      canonicalFacts: [
        {
          id: 'f-inferred',
          subject: '玉佩',
          attribute: 'status',
          value: '完好',
          establishedIn: 1,
          confidence: 'medium',
          source: 'outline_inference',
        },
      ],
    }
    const delta: StoryState = {
      ...emptyState(),
      canonicalFacts: [
        {
          id: 'f-text',
          subject: '玉佩',
          attribute: 'status',
          value: '碎裂',
          establishedIn: 3,
          confidence: 'high',
          source: 'chapter_text',
        },
      ],
    }

    const merged = mergeStoryState(base, delta)

    const oldFact = merged.canonicalFacts?.find((f) => f.id === 'f-inferred')
    const newFact = merged.canonicalFacts?.find((f) => f.id === 'f-text')
    expect(oldFact?.retiredIn).toBe(3)
    expect(newFact?.retiredIn).toBeUndefined()
    expect(newFact?.supersedes).toEqual([{ chapter: 1, oldValue: '完好' }])
  })

  it('does not add supersedes when the conflicting existing fact is not outline_inference', () => {
    const base: StoryState = {
      ...emptyState(),
      canonicalFacts: [
        {
          id: 'f-old',
          subject: '玉佩',
          attribute: 'status',
          value: '完好',
          establishedIn: 1,
          confidence: 'high',
          source: 'chapter_text',
        },
      ],
    }
    const delta: StoryState = {
      ...emptyState(),
      canonicalFacts: [
        {
          id: 'f-new',
          subject: '玉佩',
          attribute: 'status',
          value: '碎裂',
          establishedIn: 3,
          confidence: 'high',
          source: 'chapter_text',
        },
      ],
    }

    const merged = mergeStoryState(base, delta)

    const oldFact = merged.canonicalFacts?.find((f) => f.id === 'f-old')
    const newFact = merged.canonicalFacts?.find((f) => f.id === 'f-new')
    expect(oldFact?.retiredIn).toBe(3)
    expect(newFact?.retiredIn).toBeUndefined()
    expect(newFact?.supersedes).toBeUndefined()
  })

  it('stays idempotent when the same delta is applied after a supersede was recorded', () => {
    const base: StoryState = {
      ...emptyState(),
      canonicalFacts: [
        {
          id: 'f-inferred',
          subject: '玉佩',
          attribute: 'status',
          value: '完好',
          establishedIn: 1,
          confidence: 'medium',
          source: 'outline_inference',
        },
      ],
    }
    const deltaFact = {
      id: 'f-text',
      subject: '玉佩',
      attribute: 'status' as const,
      value: '碎裂',
      establishedIn: 3,
      confidence: 'high' as const,
      source: 'chapter_text' as const,
    }
    const delta: StoryState = { ...emptyState(), canonicalFacts: [deltaFact] }

    const once = mergeStoryState(base, delta)
    const twice = mergeStoryState(once, delta)

    expect(twice.canonicalFacts).toEqual(once.canonicalFacts)
  })
})
