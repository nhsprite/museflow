import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { rmSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { start } from '../../src/cli/commands/start.ts'
import type { ModelProvider } from '../../src/model/provider.js'
import type { RuntimeContext } from '../../src/core/context.js'
import { JsonCheckpointer } from '../../src/graph/checkpointer.js'

const mockChat = vi.fn(async (): Promise<string> => '{}')
const mockChatStructured = vi.fn(async <T>(): Promise<T> => {
  return {
    options: [
      {
        title: '候选书名一',
        synopsis: '候选书名一的新书简介。',
        writingConstraints: {
          chapterOpening: {
            type: 'letter',
            required: true,
            instruction: '每章在章节标题后必须先写一封信，信后正文才进入案情叙述。',
          },
        },
        worldDirection: { coreConflict: '冲突一', worldFeatures: ['特征A', '特征B'] },
      },
      {
        title: '候选书名二',
        synopsis: '候选书名二的新书简介。',
        worldDirection: { coreConflict: '冲突二', worldFeatures: ['特征C', '特征D'] },
      },
      {
        title: '候选书名三',
        synopsis: '候选书名三的新书简介。',
        worldDirection: { coreConflict: '冲突三', worldFeatures: ['特征E', '特征F'] },
      },
      {
        title: '候选书名四',
        synopsis: '候选书名四的新书简介。',
        worldDirection: { coreConflict: '冲突四', worldFeatures: ['特征G', '特征H'] },
      },
    ],
  } as T
})

function createMockProvider(): ModelProvider {
  return { chat: mockChat, chatStructured: mockChatStructured }
}

function createMockContext(): RuntimeContext {
  return {
    provider: createMockProvider(),
    checkpointer: new JsonCheckpointer(),
    config: { model: { provider: 'openai', model: 'gpt-4o', temperature: 0.7, maxTokens: 8192 } },
  }
}

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
      }))
    ),
  }),
  getStoryArcAgent: () => ({
    run: vi.fn(async (state: { totalChapters: number }) => ({
      success: true,
      data: {
        totalChapters: state.totalChapters,
        acts: [
          {
            index: 1,
            startChapter: 1,
            endChapter: state.totalChapters,
            title: '第一幕',
            theme: '测试主题',
            function: '测试功能',
            mandatoryBeats: ['主角登场'],
          },
        ],
        keyBeats: [],
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
}))

describe('CLI end-to-end integration', () => {
  let preExistingDirs: string[]

  beforeEach(() => {
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
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((code?: number | string | null | undefined) => {
        throw new Error(`process.exit(${String(code)})`)
      })

    let createdStoryId: string | undefined
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      const msg = args.join(' ')
      const match = /故事已创建，ID:\s*(\S+)/.exec(msg)
      if (match) {
        createdStoryId = match[1]
      }
    })

    try {
      await start(
        {
          idea: '一个测试用的长篇小说',
          chapters: 3,
          genre: 'default',
          yes: true,
        },
        createMockContext()
      )

      const booksDir = join(process.cwd(), 'books')
      const dirs = readdirSync(booksDir).filter((d) => !preExistingDirs.includes(d))
      expect(dirs.length).toBeGreaterThan(0)
      expect(createdStoryId).toBeDefined()

      const matchedDir = dirs.find((d) => {
        const metaPath = join(booksDir, d, 'meta.json')
        if (!existsSync(metaPath)) return false
        const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
        return meta.story?.id === createdStoryId
      })
      expect(matchedDir).toBeDefined()

      const metaPath = join(booksDir, matchedDir!, 'meta.json')
      expect(existsSync(metaPath)).toBe(true)
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
      expect(meta.story.title).toBe('候选书名一')
      expect(meta.story.synopsis).toBe('候选书名一的新书简介。')
      expect(meta.story.writingConstraints).toEqual({
        chapterOpening: {
          type: 'letter',
          required: true,
          instruction: '每章在章节标题后必须先写一封信，信后正文才进入案情叙述。',
        },
      })
      expect(meta.world).not.toBeNull()
      expect(meta.characters.length).toBeGreaterThanOrEqual(1)
      expect(meta.outline).toHaveLength(3)
      expect(meta.storyArc).toBeDefined()
      expect(meta.storyArc.acts).toHaveLength(1)
    } finally {
      exitSpy.mockRestore()
      logSpy.mockRestore()
    }
  })
})
