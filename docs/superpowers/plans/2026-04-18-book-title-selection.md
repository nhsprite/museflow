# 书名选择 TUI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `start` 流程中添加书名选择 TUI，AI 生成 3-5 个候选书名 + 世界观方向，用户通过箭头键选择后再继续完整规划流程。

**Architecture:** 新增 `title-selector.ts` 模块处理标题选项生成和 TUI 选择；修改 `worldbuilder.ts` agent 支持多选项生成；修改 `start.ts` 集成选择流程。

**Tech Stack:** TypeScript, inquirer (TUI), LangGraph agents

---

## File Structure

```
src/
├── cli/commands/
│   ├── title-selector.ts     # [新建] 标题选择器：生成选项 + TUI 选择
│   └── start.ts              # [修改] 集成标题选择流程
├── agents/
│   └── worldbuilder.ts       # [修改] 支持多书名选项生成
tests/
├── cli/
│   └── title-selector.test.ts  # [新建] 标题选择器测试
```

---

## Task 1: 添加 inquirer 依赖

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 添加 inquirer 依赖**

```bash
npm install inquirer
npm install -D @types/inquirer
```

- [ ] **Step 2: 验证安装**

Run: `npm list inquirer @types/inquirer`
Expected: 显示已安装版本号

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add inquirer for TUI title selection"
```

---

## Task 2: 创建 title-selector.ts 模块

**Files:**
- Create: `src/cli/commands/title-selector.ts`
- Create: `tests/cli/title-selector.test.ts`

### 2.1 定义类型

- [ ] **Step 1: 编写类型定义测试**

```typescript
// tests/cli/title-selector.test.ts
import { describe, expect, it } from 'vitest'

describe('TitleOption types', () => {
  it('has correct shape for title option', () => {
    const option = {
      title: '《逆天改命》',
      worldDirection: {
        cultivationSystem: '凡境→灵境→仙境',
        coreConflict: '资源争夺、宗门秘宝',
        worldFeatures: ['中土大陆', '灵气衰退'],
      },
    }
    expect(option.title).toBe('《逆天改命》')
    expect(option.worldDirection.cultivationSystem).toBe('凡境→灵境→仙境')
    expect(option.worldDirection.worldFeatures).toHaveLength(2)
  })
})
```

- [ ] **Step 2: 运行测试验证类型**

Run: `npm test -- tests/cli/title-selector.test.ts`
Expected: PASS

- [ ] **Step 3: 编写 title-selector.ts 骨架**

```typescript
// src/cli/commands/title-selector.ts

export interface WorldDirection {
  cultivationSystem: string
  coreConflict: string
  worldFeatures: string[]
}

export interface TitleOption {
  title: string
  worldDirection: WorldDirection
}

export async function generateTitleOptions(
  idea: string,
  genre: string,
  totalChapters: number
): Promise<TitleOption[]> {
  // TODO: 实现
}

export async function selectTitleOption(options: TitleOption[]): Promise<TitleOption> {
  // TODO: 实现
}
```

- [ ] **Step 4: 再次运行测试确保编译通过**

Run: `npm run typecheck`
Expected: 无错误（仅有 TODO 警告）

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/title-selector.ts tests/cli/title-selector.test.ts
git commit -m "feat: add title-selector module skeleton with types"
```

### 2.2 实现 generateTitleOptions

- [ ] **Step 1: 编写 mock 测试**

```typescript
// tests/cli/title-selector.test.ts 新增

it('generateTitleOptions returns array of TitleOption', async () => {
  const options = await generateTitleOptions(
    '一个少年获得修真能力后崛起为最强者的故事',
    'xianxia',
    10
  )
  expect(options).toBeInstanceOf(Array)
  expect(options.length).toBeGreaterThanOrEqual(3)
  expect(options.length).toBeLessThanOrEqual(5)
  expect(options[0]).toHaveProperty('title')
  expect(options[0]).toHaveProperty('worldDirection')
  expect(options[0].worldDirection).toHaveProperty('cultivationSystem')
  expect(options[0].worldDirection).toHaveProperty('coreConflict')
  expect(options[0].worldDirection).toHaveProperty('worldFeatures')
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npm test -- tests/cli/title-selector.test.ts`
Expected: FAIL（函数未实现）

- [ ] **Step 3: 实现 generateTitleOptions**

```typescript
// src/cli/commands/title-selector.ts

import { createProvider } from '../../model/registry.js'

const TITLE_SELECTION_PROMPT = `你是一位资深的书名策划师。根据以下故事概要，提供 3-5 个候选书名和对应的世界观方向。

故事概要：{idea}
总章节数：{totalChapters}
题材：{genre}

请以以下 JSON 格式返回：
[
  {
    "title": "书名1",
    "worldDirection": {
      "cultivationSystem": "修炼体系描述",
      "coreConflict": "核心冲突描述",
      "worldFeatures": ["特色1", "特色2", "特色3"]
    }
  },
  ...
]

要求：
- 书名要新颖、有吸引力、符合题材
- 世界观方向要各有特色，角度不同
- cultivationSystem 简明扼要，1-2 句话
- coreConflict 点出核心矛盾
- worldFeatures 列出 2-4 个独特的世界观元素
- 必须返回 3-5 个不同的候选方案`

export async function generateTitleOptions(
  idea: string,
  genre: string,
  totalChapters: number
): Promise<TitleOption[]> {
  const provider = createProvider()

  const userContent = TITLE_SELECTION_PROMPT
    .replace('{idea}', idea)
    .replace('{totalChapters}', String(totalChapters))
    .replace('{genre}', genre)

  const messages = [
    { role: 'system' as const, content: '你是一位资深的小说策划师，擅长起书名和构建世界观。' },
    { role: 'user' as const, content: userContent },
  ]

  const response = await provider.chat(messages, 0.8)

  // 解析 JSON 数组
  const jsonMatch = response.match(/\[[\s\S]*?\]/)
  if (!jsonMatch) {
    throw new Error('无法从 AI 响应中解析标题选项')
  }

  const parsed = JSON.parse(jsonMatch[0])

  if (!Array.isArray(parsed) || parsed.length < 3) {
    throw new Error('AI 返回的标题选项数量不足')
  }

  return parsed.map((item: Record<string, unknown>): TitleOption => ({
    title: String(item.title || '未命名'),
    worldDirection: {
      cultivationSystem: String(item.worldDirection?.cultivationSystem || ''),
      coreConflict: String(item.worldDirection?.coreConflict || ''),
      worldFeatures: Array.isArray(item.worldDirection?.worldFeatures)
        ? item.worldDirection.worldFeatures.map(String)
        : [],
    },
  }))
}
```

- [ ] **Step 4: 运行测试验证**

Run: `npm test -- tests/cli/title-selector.test.ts`
Expected: FAIL（需要 provider mock）

- [ ] **Step 5: 添加 provider mock 到测试**

```typescript
// tests/cli/title-selector.test.ts 顶部添加

vi.mock('../../src/model/registry.js', () => ({
  createProvider: () => ({
    chat: vi.fn().mockResolvedValue(JSON.stringify([
      {
        title: '《逆天改命》',
        worldDirection: {
          cultivationSystem: '凡境→灵境→仙境',
          coreConflict: '资源争夺',
          worldFeatures: ['中土大陆']
        }
      },
      {
        title: '《凡人之躯》',
        worldDirection: {
          cultivationSystem: '炼体三阶段',
          coreConflict: '人与天斗',
          worldFeatures: ['偏远山村']
        }
      },
      {
        title: '《破妄之剑》',
        worldDirection: {
          cultivationSystem: '剑修为尊',
          coreConflict: '正邪两道',
          worldFeatures: ['万剑山脉']
        }
      },
    ])),
  }),
}))
```

- [ ] **Step 6: 重新运行测试**

Run: `npm test -- tests/cli/title-selector.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/cli/commands/title-selector.ts tests/cli/title-selector.test.ts
git commit -m "feat: implement generateTitleOptions"
```

### 2.3 实现 selectTitleOption (TUI)

- [ ] **Step 1: 编写 selectTitleOption 测试骨架**

```typescript
// tests/cli/title-selector.test.ts 新增

it('selectTitleOption returns a TitleOption', async () => {
  const options: TitleOption[] = [
    {
      title: '《逆天改命》',
      worldDirection: {
        cultivationSystem: '凡境→灵境→仙境',
        coreConflict: '资源争夺',
        worldFeatures: ['中土大陆'],
      },
    },
  ]

  // Mock inquirer
  const inquirer = await import('inquirer')
  vi.spyOn(inquirer, 'prompt').mockResolvedValue({ selected: options[0] })

  const result = await selectTitleOption(options)
  expect(result.title).toBe('《逆天改命》')
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npm test -- tests/cli/title-selector.test.ts`
Expected: FAIL（函数未实现）

- [ ] **Step 3: 实现 selectTitleOption**

```typescript
// src/cli/commands/title-selector.ts 新增 import 和函数

import inquirer from 'inquirer'

export async function selectTitleOption(options: TitleOption[]): Promise<TitleOption> {
  const choices = [
    ...options.map((opt, index) => ({
      name: formatOptionForDisplay(opt, index + 1),
      value: index,
    })),
    new inquirer.Separator(),
    {
      name: '重新生成选项',
      value: -1,
    },
  ]

  const { selectedIndex } = await inquirer.prompt<{ selectedIndex: number }>([
    {
      type: 'list',
      name: 'selectedIndex',
      message: '请选择书名和世界观方向：',
      choices,
      pageSize: 10,
    },
  ])

  if (selectedIndex === -1) {
    // 用户选择重新生成，抛出特殊错误让调用方处理
    throw new Error('REGENERATE')
  }

  return options[selectedIndex]
}

function formatOptionForDisplay(option: TitleOption, number: number): string {
  const features = option.worldDirection.worldFeatures.join('、')
  return `${number}. ${option.title}
   修炼体系：${option.worldDirection.cultivationSystem}
   核心冲突：${option.worldDirection.coreConflict}
   世界观特色：${features}`
}
```

- [ ] **Step 4: 运行测试**

Run: `npm test -- tests/cli/title-selector.test.ts`
Expected: FAIL（inquirer prompt mock 需要调整）

- [ ] **Step 5: 修复测试 mock**

```typescript
// 更新 mock 方式
vi.mock('inquirer', () => ({
  default: {
    prompt: vi.fn().mockResolvedValue({ selectedIndex: 0 }),
    Separator: vi.fn().mockImplementation(() => '---'),
  },
}))
```

- [ ] **Step 6: 重新运行测试**

Run: `npm test -- tests/cli/title-selector.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/cli/commands/title-selector.ts tests/cli/title-selector.test.ts
git commit -m "feat: implement selectTitleOption with inquirer TUI"
```

---

## Task 3: 修改 WorldbuilderAgent 支持多书名选项

**Files:**
- Modify: `src/agents/worldbuilder.ts`

- [ ] **Step 1: 添加 extractTitleOptions 方法**

```typescript
// src/agents/worldbuilder.ts 新增

interface TitleOptionRaw {
  title: string
  worldDirection: {
    cultivationSystem: string
    coreConflict: string
    worldFeatures: string[]
  }
}

export function extractTitleOptions(output: AgentOutput): TitleOption[] {
  if (!output.data || typeof output.data !== 'object') {
    return []
  }

  const data = output.data as { title_options?: TitleOptionRaw[]; title?: string }
  const rawOptions = data.title_options

  if (!Array.isArray(rawOptions) || rawOptions.length === 0) {
    return []
  }

  return rawOptions.map((opt: TitleOptionRaw): TitleOption => ({
    title: opt.title || '未命名',
    worldDirection: {
      cultivationSystem: opt.worldDirection?.cultivationSystem || '',
      coreConflict: opt.worldDirection?.coreConflict || '',
      worldFeatures: Array.isArray(opt.worldDirection?.worldFeatures)
        ? opt.worldDirection.worldFeatures
        : [],
    },
  }))
}
```

- [ ] **Step 2: 修改 buildPrompt 支持 title_options 格式**

将原有的 single title prompt 改为可选的 title_options 格式。由于 WorldbuilderAgent 还用于后续完整世界观生成，需要保持向后兼容。

- [ ] **Step 3: 运行类型检查**

Run: `npm run typecheck`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add src/agents/worldbuilder.ts
git commit -m "feat: add extractTitleOptions to WorldbuilderAgent"
```

---

## Task 4: 修改 start.ts 集成标题选择流程

**Files:**
- Modify: `src/cli/commands/start.ts`

- [ ] **Step 1: 修改 start.ts 集成标题选择**

```typescript
// src/cli/commands/start.ts

import { createStory } from '../../storage/database/dao/story.js'
import { runStory } from '../../core/runner.js'
import { initStoryDb } from '../../storage/database/dao/story.js'
import { getGenreRegistry } from '../../genres/registry.js'
import { updateStoryStatus } from '../../storage/database/dao/story.js'
import { generateTitleOptions, selectTitleOption, type TitleOption } from './title-selector.js'

interface StartOptions {
  idea: string
  chapters: number
  genre: string
  title?: string
  provider?: string
}

const MAX_REGENERATE_ATTEMPTS = 3

export async function start(options: StartOptions): Promise<void> {
  const { idea, chapters, genre, provider } = options

  console.log('[MuseFlow] 开始创建故事...')
  console.log(`  简介: ${idea}`)
  console.log(`  章节数: ${chapters}`)
  console.log(`  题材: ${genre}`)

  // ... 验证代码保持不变 ...

  await initStoryDb()

  // 生成并选择书名
  let selectedOption: TitleOption | null = null
  let regenerateAttempts = 0

  while (!selectedOption && regenerateAttempts < MAX_REGENERATE_ATTEMPTS) {
    console.log('\n[MuseFlow] 正在生成书名和世界观方向选项...\n')

    try {
      const titleOptions = await generateTitleOptions(idea, genre, chapters)
      selectedOption = await selectTitleOption(titleOptions)
    } catch (err) {
      if (err instanceof Error && err.message === 'REGENERATE') {
        regenerateAttempts++
        console.log(`\n[MuseFlow] 重新生成选项... (${regenerateAttempts}/${MAX_REGENERATE_ATTEMPTS})\n`)
        continue
      }
      throw err
    }
  }

  if (!selectedOption) {
    // 达到最大重试次数，使用第一个选项
    console.warn('[MuseFlow] 警告: 达到最大重试次数，使用默认选项')
    const titleOptions = await generateTitleOptions(idea, genre, chapters)
    selectedOption = titleOptions[0]
  }

  console.log(`\n[MuseFlow] 已选择：${selectedOption.title}\n`)

  const story = createStory({
    idea,
    genre,
    totalChapters: chapters,
    provider: provider || 'openai',
    title: selectedOption.title,
    worldDirection: selectedOption.worldDirection,
  })

  console.log(`\n[MuseFlow] 故事已创建，ID: ${story.id}`)
  console.log('[MuseFlow] 开始生成世界观...\n')

  try {
    const updateStatus = (status: Parameters<typeof updateStoryStatus>[1]) => {
      updateStoryStatus(story.id, status)
    }

    updateStatus('worldbuilding')

    const result = await runStory({
      storyId: story.id,
      idea,
      genre,
      totalChapters: chapters,
      story,
      // worldDirection 会传递给 worldbuilder
    })

    // ... 后续代码保持不变 ...

  } catch (err) {
    // ... 错误处理保持不变 ...
  }
}
```

- [ ] **Step 2: 更新 createStory 类型定义**

检查 `src/storage/database/dao/story.ts` 中的 `createStory` 函数是否支持 `title` 和 `worldDirection` 参数。

- [ ] **Step 3: 运行类型检查**

Run: `npm run typecheck`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/start.ts
git commit -m "feat: integrate title selection TUI into start command"
```

---

## Task 5: 更新类型定义

**Files:**
- Modify: `src/types/story.ts` (如果存在)

- [ ] **Step 1: 检查 Story 类型定义**

查看 `src/types/story.ts` 确认 `Story` 类型是否包含 `title` 和 `worldDirection` 字段。

- [ ] **Step 2: 如需要，添加 worldDirection 字段**

```typescript
// src/types/story.ts

export interface WorldDirection {
  cultivationSystem: string
  coreConflict: string
  worldFeatures: string[]
}

export interface Story {
  id: string
  title?: string
  worldDirection?: WorldDirection
  // ... 其他字段
}
```

- [ ] **Step 3: Commit**

```bash
git add src/types/story.ts
git commit -m "feat: add worldDirection to Story type"
```

---

## Task 6: 端到端测试

- [ ] **Step 1: 运行完整测试套件**

Run: `npm test`
Expected: 所有测试 PASS

- [ ] **Step 2: 运行类型检查**

Run: `npm run typecheck`
Expected: 无错误

- [ ] **Step 3: 构建项目**

Run: `npm run build`
Expected: 编译成功

---

## Task 7: 更新文档

**Files:**
- Modify: `README.md` (如需要)

- [ ] **Step 1: 更新 README 中的 start 命令说明**

添加关于书名选择 TUI 的说明。

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update README with title selection TUI info"
```

---

## 验证清单

- [ ] `npm test` 全部通过
- [ ] `npm run typecheck` 无错误
- [ ] `npm run build` 编译成功
- [ ] README 文档已更新（如需要）
- [ ] 所有变更已提交

---

## 预估工作量

- Task 1: 添加依赖 (5 min)
- Task 2: title-selector 模块 (30 min)
- Task 3: WorldbuilderAgent 修改 (15 min)
- Task 4: start.ts 集成 (20 min)
- Task 5: 类型定义 (10 min)
- Task 6: 端到端测试 (15 min)
- Task 7: 文档 (5 min)

**总计: ~100 分钟**