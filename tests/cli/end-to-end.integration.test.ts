import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { rmSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { start } from '../../src/cli/commands/start.ts'
import type { ModelProvider } from '../../src/model/provider.js'

let mockProvider: ModelProvider

vi.mock('../../src/model/registry.js', () => ({
  createProvider: vi.fn(() => mockProvider),
  AnthropicCompatibleProvider: class {},
}))

vi.mock('../../src/graph/agent-factory.js', () => ({
  getWorldbuilderAgent: () => ({
    run: vi.fn(async () => ({ success: true, data: { title: '测试故事', world: '测试世界观' } })),
    processOutput: vi.fn((output: { data: { world: string } }, storyId: string) => ({
      id: 'world-test',
      storyId,
      content: output.data.world,
    })),
    extractTitle: vi.fn((output: { data: { title: string } }) => output.data.title),
  }),
  getCharacterAgent: () => ({
    run: vi.fn(async () => ({
      success: true,
      data: [{ 姓名: '主角', 背景故事: '测试背景', 对话风格: '沉稳' }],
    })),
    processOutput: vi.fn((output: { data: Array<Record<string, string>> }, storyId: string) =>
      output.data.map((c, idx) => ({
        id: `char-test-${idx}`,
        storyId,
        name: String(c['姓名'] || c['name'] || '未命名'),
        description: (c['背景故事'] || c['description'] || null) as string | null,
        dialogueStyle: (c['对话风格'] || c['dialogueStyle'] || null) as string | null,
        createdAt: Date.now(),
      })),
    ),
  }),
  getHighLevelOutlineAgent: () => ({
    run: vi.fn(async (state: { totalChapters: number }) => ({
      success: true,
      data: {
        chapters: Array.from({ length: state.totalChapters }, (_, i) => ({
          number: i + 1,
          title: `第${i + 1}章`,
          description: `第${i + 1}章描述`,
          introducedCharacters: i === 0 ? ['主角'] : [],
        })),
      },
    })),
  }),
  getChapterAgent: vi.fn(),
  getChapterPlannerAgent: vi.fn(),
  getForeshadowingAgent: vi.fn(),
  getConsistencyAgent: vi.fn(),
  getFixAgent: vi.fn(),
  getSummaryAgent: vi.fn(),
}))

vi.mock('../../src/cli/utils/spinner.js', () => ({
  withSpinner: vi.fn(async (_msg: string, fn: () => Promise<unknown>) => fn()),
  startSpinner: vi.fn(),
  stopSpinner: vi.fn(),
  stopSpinnerQuiet: vi.fn(),
  stopStepProgress: vi.fn(),
  stopStepProgressQuiet: vi.fn(),
}))

function createMockProvider(): ModelProvider {
  return {
    chat: vi.fn(async () => '{}'),
    chatStructured: vi.fn(async <T>(_messages: unknown, _schema: unknown, _temperature?: number): Promise<T> => {
      return {
        options: [
          { title: '候选书名一', worldDirection: { coreConflict: '冲突一', worldFeatures: ['特征A', '特征B'] } },
          { title: '候选书名二', worldDirection: { coreConflict: '冲突二', worldFeatures: ['特征C', '特征D'] } },
          { title: '候选书名三', worldDirection: { coreConflict: '冲突三', worldFeatures: ['特征E', '特征F'] } },
          { title: '候选书名四', worldDirection: { coreConflict: '冲突四', worldFeatures: ['特征G', '特征H'] } },
        ],
      } as T
    }),
  }
}

describe('CLI end-to-end integration', () => {
  let preExistingDirs: string[]

  beforeEach(() => {
    mockProvider = createMockProvider()
    const booksDir = join(process.cwd(), 'books')
    preExistingDirs = existsSync(booksDir) ? readdirSync(booksDir) : []
  })

  afterEach(() => {
    const booksDir = join(process.cwd(), 'books')
    if (!existsSync(booksDir)) return
    for (const entry of readdirSync(booksDir)) {
      if (!preExistingDirs.includes(entry)) {
        rmSync(join(booksDir, entry), { recursive: true, force: true })
      }
    }
  })

  it('start command creates a story in non-interactive mode', { timeout: 60000 }, async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: number | string | null | undefined) => {
      throw new Error(`process.exit(${String(code)})`)
    })

    try {
      await start({
        idea: '一个测试用的长篇小说',
        chapters: 3,
        genre: 'default',
        yes: true,
      })

      const booksDir = join(process.cwd(), 'books')
      const dirs = readdirSync(booksDir).filter(d => !preExistingDirs.includes(d))
      expect(dirs.length).toBeGreaterThan(0)

      const metaPath = join(booksDir, dirs[0], 'meta.json')
      expect(existsSync(metaPath)).toBe(true)
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
      expect(meta.story.title).toBe('候选书名一')
      expect(meta.world).not.toBeNull()
      expect(meta.characters.length).toBeGreaterThanOrEqual(1)
      expect(meta.outline).toHaveLength(3)
    } finally {
      exitSpy.mockRestore()
    }
  })
})
