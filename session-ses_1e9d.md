# 两次写入同一章的prompt参数是否相同

**Session ID:** ses_1e9da62ffffeujGd6QIe0jUBoj
**Created:** 5/11/2026, 4:27:04 PM
**Updated:** 5/11/2026, 5:42:25 PM

---

## User

第一次 write 与 第二次 write 同一章，prompt 参数是完全一样的吗

---

## Assistant (​Sisyphus - Ultraworker · Kimi K2.6 · 20.3s)

_Thinking:_

用户问的是关于 MuseFlow 这个项目的 write 命令的行为：第一次 write 和第二次 write 同一章时，prompt 参数是否完全一样。

这个问题涉及到：
1. `write` CLI 命令的实现
2. 章节写作的逻辑，特别是 prompt 的构建方式
3. 是否有状态/历史影响 prompt 的生成

我需要查看相关代码来回答这个问题。让我先探索一下代码库。

相关文件可能包括：
- `src/cli/` 下的命令定义
- `src/graph/` 下的图编排逻辑
- `src/agents/` 下的各个 agent，特别是 chapter agent
- `src/core/` 下的 runner 逻辑

让我先进行一些搜索和读取。

**Tool: read**

**Input:**
```json
{
  "filePath": "/Users/bytedance/workspace/museflow/README.md",
  "limit": 50
}
```

**Output:**
```
<path>/Users/bytedance/workspace/museflow/README.md</path>
<type>file</type>
<content>
1: # MuseFlow
2: 
3: > AI Native 长篇小说生成工具 — 端到端 AI 写作助手
4: 
5: MuseFlow 是一款本地运行的 CLI 工具，用户输入一句话故事简介，AI 自动完成从世界观构建、大纲生成到逐章正文撰写的全部工作，最终输出完整可读的长篇小说。
6: 
7: ## 核心特性
8: 
9: - **LangGraph 状态图编排**：多 Agent 协同，支持断点恢复和人工确认重写
10: - **8 类专业 Agent**：世界观、人物、大纲、章节、质量、伏笔检测、幻觉检测、逻辑一致性
11: - **题材 Skill 系统**：内置玄幻、仙侠、科幻、恐怖等题材包，支持用户自定义 Skill
12:   - **本地优先**：所有数据存储在本地，模型可配置（OpenAI 兼容 / Anthropic）
13: - **断点恢复**：写作过程中断后可随时恢复，无需从头开始
14: - **质量保障**：每章写完自动进行多维度质量检查，发现问题可针对性修复或重写
15: 
16: ## 系统要求
17: 
18: - **Node.js >= 20**
19: - **npm** 或 **pnpm**
20: - API Key（OpenAI / Claude / 其他兼容服务）
21: 
22: ## 安装
23: 
24: ### 通过 npm 安装（推荐）
25: 
26: ```bash
27: npm install -g museflow
28: ```
29: 
30: 安装后全局可用 `museflow` 命令。
31: 
32: ### 从源码运行（开发）
33: 
34: ```bash
35: # 克隆项目
36: git clone <repository-url>
37: cd museflow
38: 
39: # 安装依赖
40: npm install
41: 
42: # 编译 TypeScript
43: npm run build
44: 
45: # 开发时使用 npm start 代替 museflow
46: npm start -- <command> [args]
47: ```
48: 
49: ## 快速开始
50: 

(Showing lines 1-50 of 256. Use offset=51 to continue.)
</content>

[Project README: /Users/bytedance/workspace/museflow/README.md]
# MuseFlow

> AI Native 长篇小说生成工具 — 端到端 AI 写作助手

MuseFlow 是一款本地运行的 CLI 工具，用户输入一句话故事简介，AI 自动完成从世界观构建、大纲生成到逐章正文撰写的全部工作，最终输出完整可读的长篇小说。

## 核心特性

- **LangGraph 状态图编排**：多 Agent 协同，支持断点恢复和人工确认重写
- **8 类专业 Agent**：世界观、人物、大纲、章节、质量、伏笔检测、幻觉检测、逻辑一致性
- **题材 Skill 系统**：内置玄幻、仙侠、科幻、恐怖等题材包，支持用户自定义 Skill
  - **本地优先**：所有数据存储在本地，模型可配置（OpenAI 兼容 / Anthropic）
- **断点恢复**：写作过程中断后可随时恢复，无需从头开始
- **质量保障**：每章写完自动进行多维度质量检查，发现问题可针对性修复或重写

## 系统要求

- **Node.js >= 20**
- **npm** 或 **pnpm**
- API Key（OpenAI / Claude / 其他兼容服务）

## 安装

### 通过 npm 安装（推荐）

```bash
npm install -g museflow
```

安装后全局可用 `museflow` 命令。

### 从源码运行（开发）

```bash
# 克隆项目
git clone <repository-url>
cd museflow

# 安装依赖
npm install

# 编译 TypeScript
npm run build

# 开发时使用 npm start 代替 museflow
npm start -- <command> [args]
```

## 快速开始

### 1. 配置模型

首次使用前需要配置 AI 模型：

```bash
# 查看当前配置
museflow config show

# 配置 OpenAI
museflow config set --provider openai --api-key YOUR_API_KEY --model gpt-4o

# 配置 Claude (Anthropic)
museflow config set --provider anthropic --api-key YOUR_API_KEY --model claude-3-sonnet-20240229

# 配置其他 OpenAI 兼容服务（MiniMax、Ollama、DeepSeek 等）
museflow config set --provider openai --api-key YOUR_API_KEY --model MODEL_NAME --base-url https://api.example.com/v1
```

配置保存在项目目录下的 `.museflow/config.json`（项目级配置，优先于全局 `~/.museflow/config.json`）。

### 2. 创建故事

```bash
# 启动新故事（仅规划和创建，不写正文）
museflow start --idea "一个少年获得修真能力后崛起为最强者的故事" --chapters 30 --genre xianxia
```

此命令会：
1. 构建世界观
2. 生成人物设定
3. 生成章节大纲
4. 保存到 `./books/{story_id}/`

### 3. 撰写正文

```bash
# 撰写当前章节（写完一章后停止）
museflow write <story-id>

# 继续撰写下一章
museflow write <story-id>
```

### 4. 修复问题

如果质量检查发现错误，会提示修复：

```bash
# 针对性修复当前章节（保留大部分内容，修改问题段落）
museflow fix <story-id>

# 彻底重写当前章节（从头重新撰写）
museflow rewrite <story-id>
```

**修复策略**：
- **Fix**：适合局部问题（用词重复、描写不足、小逻辑矛盾）。保留 90%+ 内容，只修改相关段落。
- **Rewrite**：适合结构性问题（时间线混乱、人物性格前后矛盾、大纲偏离）。整章重写。

### 5. 查看进度

```bash
# 查看故事进度
museflow status <story-id>

# 查看故事详情
museflow info <story-id>
```

## 工作流程

```
start → 世界观 → 人物 → 大纲
              ↓
write → 草稿 → 质量检查 → 伏笔检测 → 幻觉检测 → 一致性检查 → 大纲合规
              ↓
        ┌─────┴─────┐
        ↓           ↓
    通过          发现问题
        ↓           ↓
    下一章      fix / rewrite
                    ↓
                重新检查
```

## 命令参考

| 命令 | 说明 |
|------|------|
| `start` | 创建新故事，完成世界观、人物、大纲 |
| `write <id>` | 撰写当前章节 |
| `continue <id>` | 从断点恢复继续撰写 |
| `rewrite <id>` | 重写有问题的章节 |
| `fix <id>` | 针对性修复章节问题 |
| `status <id>` | 查看故事进度 |
| `info <id>` | 查看故事详情 |
| `export <id>` | 导出故事为 txt 文件 |
| `config` | 管理模型配置 |
| `genres` | 查看可用题材 |

## 题材

内置以下题材，可通过 `--genre` 指定：

| 题材 | 参数值 | 说明 |
|------|--------|------|
| 玄幻 | `xianxia` | 修真、仙侠、武侠 |
| 科幻 | `scifi` | 未来科技、太空冒险 |
| 恐怖 | `horror` | 悬疑、惊悚、灵异 |
| 都市 | `urban` | 现代都市、职场 |
| 浪漫 | `romance` | 言情、爱情 |
| 默认 | `default` | 通用题材 |

## Agent 系统

MuseFlow 使用 8 类专业 Agent 协同工作：

| Agent | 职责 |
|-------|------|
| **WorldBuilder** | 构建世界观、历史背景、社会结构 |
| **Character** | 生成人物设定、性格、关系网 |
| **Outline** | 生成章节大纲，确保故事结构完整 |
| **Chapter** | 撰写章节正文，保持风格一致 |
| **Quality** | 检查用词重复、描写质量、节奏 |
| **Foreshadowing** | 检测伏笔回收，最后 15% 章节禁止埋新伏笔 |
| **Hallucination** | 检测与设定矛盾的内容 |
| **Consistency** | 检查跨章节逻辑一致性 |

## 数据存储

故事数据保存在本地 `./books/` 目录下：

| 路径 | 内容 |
|------|------|
| `./.museflow/config.json` | 项目级配置（API key、provider 等） |
| `./books/{story_id}/meta.json` | 故事元数据（世界观、人物、大纲） |
| `./books/{story_id}/checkpoints/` | LangGraph checkpoint JSON 文件 |
| `./books/{story_id}/chapters/chapter_{n}.md` | 各章正文 `.md` 文件 |

> **注意**：MuseFlow 使用 JSON + 文件系统存储，不依赖 SQLite。

## 项目结构

```
src/
├── cli/           # 命令行入口（所有命令的实现）
├── graph/         # LangGraph 图编排（状态、节点、边、检查点）
├── agents/        # 8 类 Agent 实现
├── core/          # 核心业务逻辑（Runner）
├── genres/        # 题材 Skill 系统
├── storage/       # JSON 元数据 + 文件系统存储
├── model/         # 模型抽象层（OpenAI 兼容 / Anthropic）
├── types/         # 共享 TypeScript 类型
└── utils/         # 工具函数
```

## 开发

```bash
# 监听模式运行测试
npm run test:watch

# 开发模式（tsx watch）
npm run dev

# 类型检查
npm run typecheck

# 运行测试
npm test

# 代码检查
npm run lint
```

## 常见问题

### `write` 没有反应
确保传入了 story-id：`museflow write <story-id>`

### API 调用报错
检查 config 中 api key 和 base url 是否正确，用 `museflow config show` 确认。

### 写完一章后提示"需要处理问题"
运行 `rewrite` 或 `fix` 命令处理当前章节：
```bash
museflow rewrite <story-id>  # 彻底重写
museflow fix <story-id>      # 针对性修复
```

### 故事写到一半中断了怎么办？
运行 `continue` 命令从断点恢复：
```bash
museflow continue <story-id>
```

### 为什么 fix 定位到很多段落？
Fix 命令会分析问题所在段落，只修改相关部分。如果问题描述涉及常见词汇（如"轻轻"、"缓缓"），可能会匹配到多个段落。这种情况建议用 `rewrite` 代替。

## 架构说明

详见 [设计文档](./docs/specs/2025-04-17-museflow-design.md) 和 [实施计划](./docs/specs/2025-04-17-museflow-implementation-plan.md)。

## License

MIT

```

**Tool: glob**

**Input:**
```json
{
  "pattern": "src/cli/**/*.ts"
}
```

**Output:**
```
Found 15 file(s)

/Users/bytedance/workspace/museflow/src/cli/utils/spinner.ts
/Users/bytedance/workspace/museflow/src/cli/commands/rewrite.ts
/Users/bytedance/workspace/museflow/src/cli/commands/write.ts
/Users/bytedance/workspace/museflow/src/cli/commands/config.ts
/Users/bytedance/workspace/museflow/src/cli/index.ts
/Users/bytedance/workspace/museflow/src/cli/commands/fix.ts
/Users/bytedance/workspace/museflow/src/cli/commands/continue.ts
/Users/bytedance/workspace/museflow/src/cli/commands/status.ts
/Users/bytedance/workspace/museflow/src/cli/commands/info.ts
/Users/bytedance/workspace/museflow/src/cli/commands/delete.ts
/Users/bytedance/workspace/museflow/src/cli/commands/list.ts
/Users/bytedance/workspace/museflow/src/cli/commands/export.ts
/Users/bytedance/workspace/museflow/src/cli/commands/start.ts
/Users/bytedance/workspace/museflow/src/cli/commands/title-selector.ts
/Users/bytedance/workspace/museflow/src/cli/commands/genres.ts
[Agent Usage Reminder]

You called a search/fetch tool directly without leveraging specialized agents.

RECOMMENDED: Use task with explore/librarian agents for better results:

```
// Parallel exploration - fire multiple agents simultaneously
task(subagent_type="explore", load_skills=[], prompt="Find all files matching pattern X")
task(subagent_type="explore", load_skills=[], prompt="Search for implementation of Y")
task(subagent_type="librarian", load_skills=[], prompt="Lookup documentation for Z")

// Then continue your work while they run in background
// System will notify you when each completes
```

WHY:
- Agents can perform deeper, more thorough searches
- Background tasks run in parallel, saving time
- Specialized agents have domain expertise
- Reduces context window usage in main session

ALWAYS prefer: Multiple parallel task calls > Direct tool calls

```

**Tool: glob**

**Input:**
```json
{
  "pattern": "src/core/**/*.ts"
}
```

**Output:**
```
Found 1 file(s)

/Users/bytedance/workspace/museflow/src/core/runner.ts
[Agent Usage Reminder]

You called a search/fetch tool directly without leveraging specialized agents.

RECOMMENDED: Use task with explore/librarian agents for better results:

```
// Parallel exploration - fire multiple agents simultaneously
task(subagent_type="explore", load_skills=[], prompt="Find all files matching pattern X")
task(subagent_type="explore", load_skills=[], prompt="Search for implementation of Y")
task(subagent_type="librarian", load_skills=[], prompt="Lookup documentation for Z")

// Then continue your work while they run in background
// System will notify you when each completes
```

WHY:
- Agents can perform deeper, more thorough searches
- Background tasks run in parallel, saving time
- Specialized agents have domain expertise
- Reduces context window usage in main session

ALWAYS prefer: Multiple parallel task calls > Direct tool calls

[Category+Skill Reminder]

**Built-in**: playwright, frontend-ui-ux, git-master, dev-browser, review-work, ai-slop-remover
**⚡ YOUR SKILLS (PRIORITY)**: hyperframes, website-to-hyperframes, hyperframes-cli, using-git-worktrees, mm-voice-maker, remotion-best-practices, test-driven-development, systematic-debugging (+44 more)

> User-installed skills OVERRIDE built-in defaults. ALWAYS prefer YOUR SKILLS when domain matches.

```typescript
task(category="visual-engineering", load_skills=["hyperframes"], run_in_background=true)
```

```

---

## Assistant (​Sisyphus - Ultraworker · Kimi K2.6 · 7.3s)

_Thinking:_

用户问的是：第一次 write 和第二次 write 同一章时，prompt 参数是否完全一样。

我需要查看 write 命令的实现，特别是：
1. `src/cli/commands/write.ts` - CLI 命令入口
2. `src/core/runner.ts` - 核心业务逻辑
3. 可能还需要查看 graph 和 agents 中 chapter 相关的实现

让我先读取这些关键文件。

**Tool: read**

**Input:**
```json
{
  "filePath": "/Users/bytedance/workspace/museflow/src/cli/commands/write.ts"
}
```

**Output:**
```
<path>/Users/bytedance/workspace/museflow/src/cli/commands/write.ts</path>
<type>file</type>
<content>
1: import { getStory, updateStoryStatus, initStoryDb } from '../../storage/database/dao/story.js'
2: import { continueStory, getState } from '../../core/runner.js'
3: import { getCheckpointer } from '../../graph/checkpointer.js'
4: import type { StoryStatus } from '../../types/story.js'
5: import { withSpinner } from '../utils/spinner.js'
6: import { toDisplayChapterNumber } from '../../utils/chapter-display.js'
7: import { getChapterFilePath, getOutputsDir } from '../../utils/paths.js'
8: import { existsSync, readdirSync } from 'node:fs'
9: import { join } from 'node:path'
10: import { readFile as readFileAsync } from 'node:fs/promises'
11: 
12: interface WriteOptions {
13:   storyId: string
14: }
15: 
16: export async function write(storyId: string, _options: WriteOptions): Promise<void> {
17:   await initStoryDb()
18:   const story = getStory(storyId)
19:   if (!story) {
20:     console.error(`[MuseFlow] 错误: 故事 "${storyId}" 不存在`)
21:     process.exit(1)
22:   }
23: 
24:   const state = await getState(storyId)
25:   if (!state) {
26:     console.error('[MuseFlow] 错误: 无法获取故事状态，请先运行 start')
27:     process.exit(1)
28:   }
29: 
30:   const hasChaptersOnDisk = checkExistingChapters(story.outputDir)
31: 
32:   let startChapterIndex = state.currentChapterIndex
33:   if (hasChaptersOnDisk && state.currentChapterIndex === 0) {
34:     const chaptersDir = join(story.outputDir, 'chapters')
35:     const files = readdirSync(chaptersDir).filter(f => f.startsWith('chapter_') && f.endsWith('.md'))
36:     startChapterIndex = files.length
37:   }
38: 
39:   const isResume = state.currentChapterIndex > 0 || hasChaptersOnDisk
40: 
41:   // If disk has more chapters than state.currentChapterIndex, use disk count
42:   if (hasChaptersOnDisk && startChapterIndex < state.currentChapterIndex) {
43:     startChapterIndex = state.currentChapterIndex
44:   }
45: 
46:   if (startChapterIndex >= state.totalChapters) {
47:     console.log(`[MuseFlow] 故事已完成: ${story.title}`)
48:     console.log(`  总章节: ${state.totalChapters}/${state.totalChapters} (100%)`)
49:     console.log('\n全部章节已撰写完成，无需继续。')
50:     console.log('使用以下命令查看或导出故事:')
51:     console.log(`   museflow status ${storyId}  # 查看进度`)
52:     console.log(`   museflow info ${storyId}     # 查看详情`)
53:     console.log(`   museflow export ${storyId}   # 导出为 txt 文件\n`)
54:     return
55:   }
56: 
57:   if (!isResume) {
58:     console.log(`[MuseFlow] 开始撰写: ${story.title}`)
59:     console.log(`  总章节: ${state.totalChapters}`)
60:     console.log(`  从第 1 章开始\n`)
61:   } else {
62:     console.log(`[MuseFlow] 继续撰写: ${story.title}`)
63:     console.log(`  总章节: ${state.totalChapters}`)
64:     console.log(`  当前章节: ${startChapterIndex + 1}/${state.totalChapters}\n`)
65:   }
66: 
67:   await handleWrite(storyId, state, startChapterIndex)
68: }
69: 
70: async function handleWrite(storyId: string, state: Awaited<ReturnType<typeof getState>>, startChapterIndex: number): Promise<void> {
71:   if (!state) return
72: 
73:   const unresolvedErrors = state.pendingIssues.filter(i => i.severity === 'error')
74:   if (state.rewriteRequested || unresolvedErrors.length > 0) {
75:     console.error('[MuseFlow] 当前章节存在问题，需要先修复')
76:     for (const issue of state.pendingIssues) {
77:       const icon = issue.severity === 'error' ? '❌' : issue.severity === 'warning' ? '⚠️' : 'ℹ️'
78:       console.error(`  ${icon} [${issue.type}] ${issue.description}`)
79:       if (issue.location) {
80:         console.error(`     位置: ${issue.location}`)
81:       }
82:     }
83:     const hasConsistencyErrors = state.pendingIssues.some(i => i.severity === 'error' && i.type === 'consistency')
84:     console.error(`\n请选择修复方式：`)
85:     if (hasConsistencyErrors) {
86:       console.error(`   museflow rewrite ${storyId}  # 彻底重写（推荐）`)
87:       console.error(`   museflow fix ${storyId}      # 针对性修复`)
88:       console.error(`\n  ⚠️  检测到跨章节一致性矛盾，rewrite 才能重新对齐前文事实\n`)
89:     } else {
90:       console.error(`   museflow fix ${storyId}      # 针对性修复（推荐）`)
91:       console.error(`   museflow rewrite ${storyId}  # 彻底重写\n`)
92:     }
93:     process.exit(1)
94:   }
95: 
96:   const chapterIndex = startChapterIndex
97:   const outlineItem = state.outline[chapterIndex]
98: 
99:   if (!outlineItem) {
100:     console.error('[MuseFlow] 错误: 未找到章节大纲')
101:     return
102:   }
103: 
104:   console.log('═'.repeat(60))
105:   console.log(`第 ${toDisplayChapterNumber(chapterIndex)} 章：${outlineItem.title}`)
106:   console.log('═'.repeat(60))
107:   console.log(`\n${outlineItem.description}\n`)
108: 
109:   await executeWrite(storyId, state, chapterIndex)
110: }
111: 
112: async function executeWrite(storyId: string, state: Awaited<ReturnType<typeof getState>>, startChapterIndex: number): Promise<void> {
113:   if (!state) return
114: 
115:   const checkpointer = getCheckpointer()
116: 
117:   const pendingWrites = await checkpointer.loadPendingWritesForThread(state.story.outputDir)
118:   const activeChapterWrites = pendingWrites.filter(w => w.channel === 'chapters')
119:   if (activeChapterWrites.length > 0) {
120:     console.warn('[MuseFlow] 检测到残留的 pending writes，将清除后继续')
121:     console.warn('[MuseFlow] 这通常是由于上一次执行被中断导致的\n')
122:     await checkpointer.clearPendingWrites(state.story.outputDir)
123:   }
124: 
125:   const updateStatus = (status: StoryStatus) => {
126:     updateStoryStatus(storyId, status)
127:   }
128: 
129:   const chapterIndex = startChapterIndex
130:   const outlineItem = state.outline[chapterIndex]
131:   const chapterNum = chapterIndex + 1
132:   const totalChapters = state.totalChapters
133: 
134:   try {
135:     const result = await withSpinner(
136:       `正在撰写第 ${chapterNum}/${totalChapters} 章...`,
137:       () => continueStory(storyId, undefined, chapterIndex),
138:       `✅ 第 ${chapterNum} 章撰写完成`
139:     )
140: 
141:     if (result.rewriteRequested) {
142:       const errors = result.pendingIssues.filter(i => i.severity === 'error')
143:       console.log(`\n[MuseFlow] 检测到 ${errors.length} 个严重问题，撰写已中断：`)
144:       for (const err of errors) {
145:         const icon = err.severity === 'error' ? '❌' : err.severity === 'warning' ? '⚠️' : 'ℹ️'
146:         console.log(`  ${icon} [${err.type}] ${err.description}`)
147:         if (err.location) {
148:           console.log(`     位置: ${err.location}`)
149:         }
150:       }
151:       const hasConsistencyErrors = errors.some(e => e.type === 'consistency')
152:       console.log(`\n请选择修复方式：`)
153:       if (hasConsistencyErrors) {
154:         console.log(`   museflow rewrite ${storyId}  # 彻底重写（推荐）`)
155:         console.log(`   museflow fix ${storyId}      # 针对性修复`)
156:         console.log(`\n  ⚠️  检测到跨章节一致性矛盾，rewrite 才能重新对齐前文事实`)
157:       } else {
158:         console.log(`   museflow fix ${storyId}      # 针对性修复（推荐）`)
159:         console.log(`   museflow rewrite ${storyId}  # 彻底重写`)
160:       }
161:       return
162:     }
163: 
164:     if (result.currentChapterIndex >= result.totalChapters) {
165:       updateStatus('done')
166:       return
167:     }
168: 
169:     updateStatus('writing')
170: 
171:     const writtenIndex = result.currentChapterIndex - 1
172:     const writtenOutlineItem = result.outline[writtenIndex]
173:     const errors = result.pendingIssues.filter(i => i.severity === 'error')
174: 
175:     // Show chapter completion info
176:     console.log('\n' + '═'.repeat(60))
177:     console.log(`✅ 第 ${writtenIndex + 1}/${result.totalChapters} 章撰写完成`)
178:     console.log('═'.repeat(60))
179: 
180:     if (writtenOutlineItem) {
181:       console.log(`\n📖 章节：${writtenOutlineItem.title}`)
182:     }
183: 
184:     // Show file path
185:     const story = getStory(storyId)
186:     if (story) {
187:       const chapterPath = getChapterFilePath(story.outputDir, writtenIndex + 1)
188:       console.log(`📁 文件：${chapterPath}`)
189: 
190:       // Show word count if file exists
191:       if (existsSync(chapterPath)) {
192:         const content = await readFileAsync(chapterPath, 'utf-8')
193:         const wordCount = countChineseWords(content)
194:         console.log(`📝 字数：约 ${wordCount} 字`)
195:       }
196:     }
197: 
198:     if (errors.length > 0) {
199:       const maxShow = 5
200:       const shown = errors.slice(0, maxShow)
201:       const remaining = errors.length - shown.length
202: 
203:       console.log(`\n⚠️  发现 ${errors.length} 个问题需要处理：`)
204:       for (const err of shown) {
205:         console.log(`   • ${err.description}`)
206:       }
207:       if (remaining > 0) {
208:         console.log(`   ... 还有 ${remaining} 个问题`)
209:       }
210:       const hasConsistencyErrors = errors.some(e => e.type === 'consistency')
211:       console.log(`\n请选择修复方式：`)
212:       if (hasConsistencyErrors) {
213:         console.log(`   museflow rewrite ${storyId} # 彻底重写（推荐）`)
214:         console.log(`   museflow fix ${storyId}    # 针对性修复`)
215:         console.log(`\n  ⚠️  检测到跨章节一致性矛盾，rewrite 才能重新对齐前文事实\n`)
216:       } else {
217:         console.log(`   museflow fix ${storyId}    # 针对性修复（推荐）`)
218:         console.log(`   museflow rewrite ${storyId} # 彻底重写\n`)
219:       }
220: 
221:       console.log('下一步：')
222:       console.log(`   先修复第 ${writtenIndex + 1} 章的问题，再运行 "museflow write" 继续撰写第 ${writtenIndex + 2} 章`)
223:       console.log(`   或运行 "museflow info" 查看故事进度\n`)
224:     } else {
225:       const warnings = result.pendingIssues.filter(i => i.severity === 'warning')
226:       if (warnings.length > 0) {
227:         const maxShow = 3
228:         const shown = warnings.slice(0, maxShow)
229:         const remaining = warnings.length - shown.length
230: 
231:         console.log('\n💡 质量提示：')
232:         for (const warn of shown) {
233:           console.log(`   • ${warn.description}`)
234:         }
235:         if (remaining > 0) {
236:           console.log(`   ... 还有 ${remaining} 条提示`)
237:         }
238:         console.log('')
239:       }
240:       console.log('✨ 质量检查通过\n')
241: 
242:       console.log('下一步：')
243:       console.log(`   输入 "museflow write" 继续撰写第 ${writtenIndex + 2} 章`)
244:       console.log(`   或运行 "museflow info" 查看故事进度\n`)
245:     }
246: 
247:   } catch (err) {
248:     const message = err instanceof Error ? err.message : String(err)
249:     if (message.includes('Branch condition returned unknown or null destination')) {
250:       console.error('[MuseFlow] 错误: 章节处理流程异常')
251:     } else {
252:       console.error('[MuseFlow] 错误:', message)
253:     }
254:     console.error('')
255:     console.error('可以运行以下命令重试：')
256:     console.error(`   museflow rewrite ${storyId}`)
257:     console.error('')
258:     updateStatus('error')
259:     process.exit(1)
260:   }
261: }
262: 
263: function countChineseWords(text: string): number {
264:   const chineseChars = (text.match(/[\u4e00-\u9fff]/g) ?? []).length
265:   const englishWords = (text.match(/[a-zA-Z]+/g) ?? []).length
266:   return chineseChars + englishWords
267: }
268: 
269: function checkExistingChapters(outputDir: string): boolean {
270:   const chaptersDir = join(outputDir, 'chapters')
271:   if (!existsSync(chaptersDir)) return false
272:   const files = readdirSync(chaptersDir).filter(f => f.startsWith('chapter_') && f.endsWith('.md'))
273:   return files.length > 0
274: }

(End of file - total 274 lines)
</content>
```

**Tool: read**

**Input:**
```json
{
  "filePath": "/Users/bytedance/workspace/museflow/src/core/runner.ts"
}
```

**Output:**
```
<path>/Users/bytedance/workspace/museflow/src/core/runner.ts</path>
<type>file</type>
<content>
1: import { buildNovelGraph } from '../graph/novel.graph.js'
2: import type { ReducedGraphState } from '../graph/state.js'
3: import type { RunnableConfig } from '@langchain/core/runnables'
4: import { getOutputsDir } from '../utils/paths.js'
5: import { existsSync, readdirSync, readFileSync } from 'node:fs'
6: import { join } from 'node:path'
7: import { getForeshadowStack } from '../storage/database/dao/timeline.js'
8: import { getCheckpointer } from '../graph/checkpointer.js'
9: import { startStepProgress, nextStep, stopStepProgress } from '../cli/utils/spinner.js'
10: import {
11:   plan_chapter,
12:   draft_chapter,
13:   fix_chapter,
14:   validate_chapter,
15:   quality_pass,
16:   detect_foreshadowing,
17:   detect_hallucination,
18:   detect_consistency,
19:   verify_outline_compliance,
20:   auto_fix_warnings,
21:   finalize_chapter,
22: } from '../graph/nodes.js'
23: 
24: let _graph: ReturnType<typeof buildNovelGraph> | null = null
25: 
26: function getGraph() {
27:   if (!_graph) {
28:     _graph = buildNovelGraph()
29:   }
30:   return _graph
31: }
32: 
33: function getOutputDirFromStoryId(storyId: string): string | undefined {
34:   const booksDir = getOutputsDir()
35:   if (!existsSync(booksDir)) return undefined
36: 
37:   const storyIdSuffix = storyId.split('_').pop() ?? storyId
38:   const shortId = storyIdSuffix.slice(0, 12).toLowerCase()
39: 
40:   try {
41:     const entries = readdirSync(booksDir)
42:     for (const entry of entries) {
43:       if (!entry.includes(`-${shortId}`) && !entry.includes(`_${shortId}`)) continue
44:       const metaPath = join(booksDir, entry, 'meta.json')
45:       if (existsSync(metaPath)) {
46:         const content = readFileSync(metaPath, 'utf-8')
47:         const meta = JSON.parse(content)
48:         if (meta.story?.id === storyId) {
49:           return join(booksDir, entry)
50:         }
51:       }
52:     }
53:   } catch {
54:   }
55:   return undefined
56: }
57: 
58: export async function runStory(input: {
59:   storyId: string
60:   idea: string
61:   genre: string
62:   totalChapters: number
63:   story: unknown
64: }): Promise<ReducedGraphState> {
65:   const graph = getGraph()
66:   const storyObj = input.story as { id: string; outputDir: string }
67:   const initialState: ReducedGraphState = {
68:     story: input.story as ReducedGraphState['story'],
69:     idea: input.idea,
70:     genre: input.genre,
71:     totalChapters: input.totalChapters,
72:     world: null,
73:     characters: [],
74:     outline: [],
75:     chapters: new Array(input.totalChapters).fill(null) as ReducedGraphState['chapters'],
76:     currentChapterIndex: 0,
77:     foreshadowStack: [],
78:     chapterSummaries: [],
79:     pendingIssues: [],
80:     rewriteApproved: false,
81:     rewriteRequested: false,
82:     isWriting: false,
83:     writeOneChapterOnly: false,
84:     lastPrintedChapter: -1,
85:     lastTimelineSnapshot: null,
86:     chapterPlan: null,
87:   }
88: 
89:   const config: RunnableConfig = {
90:     configurable: { thread_id: input.storyId, outputDir: storyObj.outputDir },
91:   }
92: 
93:   const result = await graph.invoke(initialState, config)
94:   return result as ReducedGraphState
95: }
96: 
97: export async function continueStory(
98:   storyId: string,
99:   userResponse?: boolean,
100:   currentChapterIndex?: number
101: ): Promise<ReducedGraphState> {
102:   const graph = getGraph()
103:   const outputDir = getOutputDirFromStoryId(storyId)
104:   if (!outputDir) {
105:     throw new Error(`Story ${storyId} not found`)
106:   }
107: 
108:   const checkpointer = getCheckpointer()
109:   await checkpointer.clearPendingWrites(outputDir)
110: 
111:   const config: RunnableConfig = {
112:     configurable: { thread_id: storyId, outputDir },
113:   }
114: 
115:   const snapshot = await graph.getState(config)
116:   const checkpointState = snapshot.values as ReducedGraphState
117: 
118:   const targetIndex = currentChapterIndex ?? checkpointState.currentChapterIndex
119: 
120:   const rewrittenChapters = new Array(checkpointState.totalChapters).fill(null) as ReducedGraphState['chapters']
121:   for (let i = 0; i < targetIndex; i++) {
122:     rewrittenChapters[i] = checkpointState.chapters[i] ?? null
123:   }
124: 
125:   let workingState: ReducedGraphState = {
126:     ...checkpointState,
127:     currentChapterIndex: targetIndex,
128:     chapters: rewrittenChapters,
129:     pendingIssues: checkpointState.pendingIssues,
130:     rewriteApproved: userResponse ?? false,
131:     rewriteRequested: false,
132:     isWriting: true,
133:     writeOneChapterOnly: true,
134:   }
135: 
136:   const MAX_REWRITE_ATTEMPTS = 3
137:   let rewriteAttempts = 0
138: 
139:   try {
140:     while (rewriteAttempts < MAX_REWRITE_ATTEMPTS) {
141:       rewriteAttempts++
142:       if (rewriteAttempts > 1) {
143:         console.log(`[MuseFlow] 第 ${rewriteAttempts}/${MAX_REWRITE_ATTEMPTS} 次尝试...`)
144:       }
145: 
146:       const structuralIssueTypes = ['outline_violation', 'outline_deviation', 'timeline_mismatch', 'logic_issue', 'consistency']
147:       const hasStructuralIssues = workingState.pendingIssues.some(
148:         i => i.severity === 'error' && structuralIssueTypes.includes(i.type)
149:       )
150:       const hasLocalIssues = workingState.pendingIssues.some(
151:         i => i.severity === 'error' && !structuralIssueTypes.includes(i.type)
152:       )
153: 
154:       const errorIssues = workingState.pendingIssues.filter(i => i.severity === 'error')
155: 
156:       if (workingState.rewriteApproved && hasStructuralIssues && !hasLocalIssues) {
157:         console.log('[MuseFlow] 检测到结构性问题，将重新规划并完整重写本章...')
158:         workingState = { ...workingState, chapterPlan: null, pendingIssues: errorIssues }
159:         const planResult = await plan_chapter(workingState)
160:         workingState = { ...workingState, ...planResult }
161:         const draftResult = await draft_chapter(workingState)
162:         workingState = { ...workingState, ...draftResult }
163:         workingState = { ...workingState, pendingIssues: [] }
164:       } else if (workingState.rewriteApproved && hasLocalIssues && !hasStructuralIssues) {
165:         console.log('[MuseFlow] 检测到局部问题，将使用段落修复模式...')
166:         workingState = { ...workingState, pendingIssues: errorIssues }
167:         const fixResult = await fix_chapter(workingState)
168:         workingState = { ...workingState, ...fixResult }
169:         // 修复后清除旧 issues，让下一轮验证从头检测
170:         workingState = { ...workingState, pendingIssues: [] }
171:       } else {
172:         if (workingState.rewriteApproved) {
173:           console.log('[MuseFlow] 同时存在结构性和局部问题，将重新规划并完整重写...')
174:           workingState = { ...workingState, chapterPlan: null, pendingIssues: errorIssues }
175:           const planResult = await plan_chapter(workingState)
176:           workingState = { ...workingState, ...planResult }
177:         } else {
178:           workingState = { ...workingState, pendingIssues: [] }
179:           const planResult = await plan_chapter(workingState)
180:           workingState = { ...workingState, ...planResult }
181:         }
182:         const draftResult = await draft_chapter(workingState)
183:         workingState = { ...workingState, ...draftResult }
184:         workingState = { ...workingState, pendingIssues: [] }
185:       }
186: 
187:       const checkNodes = [
188:         { node: validate_chapter, label: '检查字数' },
189:         { node: quality_pass, label: '质量检查' },
190:         { node: detect_foreshadowing, label: '检测伏笔' },
191:         { node: detect_hallucination, label: '检测幻觉' },
192:         { node: detect_consistency, label: '检测一致性' },
193:         { node: verify_outline_compliance, label: '校验大纲合规性' },
194:         { node: auto_fix_warnings, label: '自动修复警告' },
195:       ]
196: 
197:       startStepProgress(checkNodes.map(n => n.label))
198: 
199:       let hasErrors = false
200:       for (let i = 0; i < checkNodes.length; i++) {
201:         const { node } = checkNodes[i]!
202:         const partial = await node(workingState)
203:         workingState = {
204:           ...workingState,
205:           ...partial,
206:         }
207:         if (node === auto_fix_warnings) {
208:           const errors = workingState.pendingIssues.filter((i: { severity: string }) => i.severity === 'error')
209:           if (errors.length > 0) {
210:             stopStepProgress(`检测到 ${errors.length} 个错误`)
211:             for (const err of errors) {
212:               const icon = err.severity === 'error' ? '❌' : err.severity === 'warning' ? '⚠️' : 'ℹ️'
213:               console.error(`  ${icon} [${err.type}] ${err.description}`)
214:               if (err.location) {
215:                 console.error(`     位置: ${err.location}`)
216:               }
217:             }
218:             hasErrors = true
219:           }
220:         }
221:         if (i < checkNodes.length - 1) {
222:           nextStep(checkNodes[i + 1]!.label)
223:         }
224:       }
225: 
226:       if (!hasErrors) {
227:         stopStepProgress('质量检查通过')
228:       }
229: 
230:       if (!hasErrors) {
231:         break
232:       }
233: 
234:       if (rewriteAttempts < MAX_REWRITE_ATTEMPTS) {
235:         console.log(`[MuseFlow] 将在第 ${rewriteAttempts + 1} 次尝试中修复上述问题...`)
236:         workingState.rewriteApproved = true
237:       } else {
238:         const remainingErrors = workingState.pendingIssues.filter(i => i.severity === 'error')
239:         console.error(`[MuseFlow] 已达到最大重写次数 (${MAX_REWRITE_ATTEMPTS})，仍有 ${remainingErrors.length} 个未修复的严重问题：`)
240:         for (const err of remainingErrors) {
241:           const icon = err.severity === 'error' ? '❌' : err.severity === 'warning' ? '⚠️' : 'ℹ️'
242:           console.error(`  ${icon} [${err.type}] ${err.description}`)
243:           if (err.location) {
244:             console.error(`     位置: ${err.location}`)
245:           }
246:         }
247:         const hasConsistencyErrors = remainingErrors.some(e => e.type === 'consistency')
248:         console.error(`\n[MuseFlow] 撰写已中断，请手动修复后再继续：`)
249:         if (hasConsistencyErrors) {
250:           console.error(`   museflow rewrite ${storyId}  # 彻底重写（推荐）`)
251:           console.error(`   museflow fix ${storyId}      # 针对性修复`)
252:           console.error(`\n  ⚠️  检测到跨章节一致性矛盾，rewrite 才能重新对齐前文事实\n`)
253:         } else {
254:           console.error(`   museflow fix ${storyId}      # 针对性修复（推荐）`)
255:           console.error(`   museflow rewrite ${storyId}  # 彻底重写\n`)
256:         }
257:         break
258:       }
259:     }
260: 
261:     const remainingErrors = workingState.pendingIssues.filter(i => i.severity === 'error')
262:     if (remainingErrors.length > 0) {
263:       workingState = {
264:         ...workingState,
265:         rewriteRequested: true,
266:         rewriteApproved: false,
267:       }
268:       await graph.updateState(
269:         { configurable: { thread_id: storyId, outputDir } },
270:         {
271:           rewriteApproved: false,
272:           rewriteRequested: true,
273:           pendingIssues: workingState.pendingIssues,
274:           currentChapterIndex: workingState.currentChapterIndex,
275:           chapters: workingState.chapters,
276:           chapterSummaries: workingState.chapterSummaries,
277:         }
278:       )
279:       return workingState
280:     }
281: 
282:     const finalizeResult = await finalize_chapter(workingState)
283:     workingState = { ...workingState, ...finalizeResult }
284: 
285:     workingState = {
286:       ...workingState,
287:       rewriteApproved: false,
288:       rewriteRequested: false,
289:     }
290:     await graph.updateState(
291:       { configurable: { thread_id: storyId, outputDir } },
292:       {
293:         rewriteApproved: false,
294:         rewriteRequested: false,
295:         pendingIssues: workingState.pendingIssues,
296:         currentChapterIndex: workingState.currentChapterIndex,
297:         chapters: workingState.chapters,
298:         chapterSummaries: workingState.chapterSummaries,
299:       }
300:     )
301:     await checkpointer.saveChapterCheckpoint(outputDir, targetIndex + 1)
302: 
303:     return workingState
304:   } catch (err) {
305:     // 当 draft_chapter 等节点抛出异常时，先保存当前的 pendingIssues
306:     // 这样 rewrite/fix 命令才能识别到已检测但尚未修复的问题
307:     if (workingState.pendingIssues.length > 0) {
308:       await graph.updateState(
309:         { configurable: { thread_id: storyId, outputDir } },
310:         {
311:           rewriteRequested: true,
312:           pendingIssues: workingState.pendingIssues,
313:           currentChapterIndex: workingState.currentChapterIndex,
314:           chapters: workingState.chapters,
315:           chapterSummaries: workingState.chapterSummaries,
316:         }
317:       )
318:     }
319:     throw err
320:   }
321: }
322: 
323: export async function getState(storyId: string): Promise<ReducedGraphState | null> {
324:   const graph = getGraph()
325:   const outputDir = getOutputDirFromStoryId(storyId)
326:   if (!outputDir) {
327:     return null
328:   }
329:   const config: RunnableConfig = {
330:     configurable: { thread_id: storyId, outputDir },
331:   }
332:   try {
333:     const state = await graph.getState(config)
334:     const graphState = state.values as unknown as ReducedGraphState
335: 
336:     const persistedForeshadowStack = getForeshadowStack(storyId)
337:     if (persistedForeshadowStack.length > 0) {
338:       graphState.foreshadowStack = persistedForeshadowStack
339:     }
340: 
341:     return graphState
342:   } catch {
343:     return null
344:   }
345: }

(End of file - total 345 lines)
</content>
```

---

## Assistant (​Sisyphus - Ultraworker · Kimi K2.6 · 6.7s)

_Thinking:_

让我继续查看 graph nodes 中 `plan_chapter` 和 `draft_chapter` 的实现，因为 prompt 的构建应该在这两个函数中。

**Tool: grep**

**Input:**
```json
{
  "pattern": "export (async )?function (plan_chapter|draft_chapter)",
  "path": "/Users/bytedance/workspace/museflow/src",
  "output_mode": "files_with_matches"
}
```

**Output:**
```
Found 1 match(es) in 1 file(s)

/Users/bytedance/workspace/museflow/src/graph/nodes.ts

[Agent Usage Reminder]

You called a search/fetch tool directly without leveraging specialized agents.

RECOMMENDED: Use task with explore/librarian agents for better results:

```
// Parallel exploration - fire multiple agents simultaneously
task(subagent_type="explore", load_skills=[], prompt="Find all files matching pattern X")
task(subagent_type="explore", load_skills=[], prompt="Search for implementation of Y")
task(subagent_type="librarian", load_skills=[], prompt="Lookup documentation for Z")

// Then continue your work while they run in background
// System will notify you when each completes
```

WHY:
- Agents can perform deeper, more thorough searches
- Background tasks run in parallel, saving time
- Specialized agents have domain expertise
- Reduces context window usage in main session

ALWAYS prefer: Multiple parallel task calls > Direct tool calls

```

---

## Assistant (​Sisyphus - Ultraworker · Kimi K2.6 · 4.2s)

_Thinking:_

用户询问的是 MuseFlow 项目中 write 命令的行为。让我查看 nodes.ts 文件来找到 plan_chapter 和 draft_chapter 的实现，特别是 prompt 的构建方式。

**Tool: read**

**Input:**
```json
{
  "filePath": "/Users/bytedance/workspace/museflow/src/graph/nodes.ts"
}
```

**Output:**
```
<path>/Users/bytedance/workspace/museflow/src/graph/nodes.ts</path>
<type>file</type>
<content>
1: import type { ReducedGraphState } from './state.js'
2: import type { ChapterMeta } from '../types/chapter.js'
3: import type { Character } from '../types/character.js'
4: import {
5:   WorldbuilderAgent,
6:   CharacterAgent,
7:   OutlineAgent,
8:   ChapterAgent,
9:   ChapterPlannerAgent,
10:   QualityAgent,
11:   ForeshadowingAgent,
12:   HallucinationAgent,
13:   ConsistencyAgent,
14:   OutlineComplianceAgent,
15:   FixAgent,
16:   SummaryAgent,
17:   processSummaryOutput,
18: } from '../agents/index.js'
19: import { generateId } from '../utils/id.js'
20: import type { AgentState } from '../agents/base.js'
21: import { writeChapterContent, readChapterContent, writeOutlineContent, writeStoryBible } from '../storage/filesystem/writer.js'
22: import { saveOutline } from '../storage/database/dao/chapter.js'
23: import { saveCharacters } from '../storage/database/dao/character.js'
24: import { saveWorld } from '../storage/database/dao/world.js'
25: import { appendTimelineSnapshot, getLatestSnapshot, saveForeshadowStack, saveForeshadowAlerts } from '../storage/database/dao/timeline.js'
26: import { getForeshadowAlerts } from './state.js'
27: import {
28:   buildLayeredSummaries,
29:   filterCharacterFactsByImportance,
30:   filterKeyEventsByImportance,
31:   getImportanceThreshold,
32:   getCompressionLevel,
33:   type ImportanceLevel,
34: } from '../utils/summary-compressor.js'
35: import { updateStoryTitle, renameStoryOutputDir } from '../storage/database/dao/story.js'
36: import { getGenreSkill } from '../genres/registry.js'
37: import { getStoryOutputDirWithTitle } from '../utils/paths.js'
38: import { toDisplayChapterNumber } from '../utils/chapter-display.js'
39: import { getCheckpointer } from './checkpointer.js'
40: 
41: let worldbuilderAgent: WorldbuilderAgent | null = null
42: let characterAgent: CharacterAgent | null = null
43: let outlineAgent: OutlineAgent | null = null
44: let chapterAgent: ChapterAgent | null = null
45: let chapterPlannerAgent: ChapterPlannerAgent | null = null
46: let qualityAgent: QualityAgent | null = null
47: let foreshadowingAgent: ForeshadowingAgent | null = null
48: let hallucinationAgent: HallucinationAgent | null = null
49: let consistencyAgent: ConsistencyAgent | null = null
50: let summaryAgent: SummaryAgent | null = null
51: 
52: function getWorldbuilderAgent(): WorldbuilderAgent {
53:   if (!worldbuilderAgent) worldbuilderAgent = new WorldbuilderAgent()
54:   return worldbuilderAgent
55: }
56: 
57: function getCharacterAgent(): CharacterAgent {
58:   if (!characterAgent) characterAgent = new CharacterAgent()
59:   return characterAgent
60: }
61: 
62: function getOutlineAgent(): OutlineAgent {
63:   if (!outlineAgent) outlineAgent = new OutlineAgent()
64:   return outlineAgent
65: }
66: 
67: function getChapterAgent(): ChapterAgent {
68:   if (!chapterAgent) chapterAgent = new ChapterAgent()
69:   return chapterAgent
70: }
71: 
72: function getChapterPlannerAgent(): ChapterPlannerAgent {
73:   if (!chapterPlannerAgent) chapterPlannerAgent = new ChapterPlannerAgent()
74:   return chapterPlannerAgent
75: }
76: 
77: function getQualityAgent(): QualityAgent {
78:   if (!qualityAgent) qualityAgent = new QualityAgent()
79:   return qualityAgent
80: }
81: 
82: function getForeshadowingAgent(): ForeshadowingAgent {
83:   if (!foreshadowingAgent) foreshadowingAgent = new ForeshadowingAgent()
84:   return foreshadowingAgent
85: }
86: 
87: function getHallucinationAgent(): HallucinationAgent {
88:   if (!hallucinationAgent) hallucinationAgent = new HallucinationAgent()
89:   return hallucinationAgent
90: }
91: 
92: function getConsistencyAgent(): ConsistencyAgent {
93:   if (!consistencyAgent) consistencyAgent = new ConsistencyAgent()
94:   return consistencyAgent
95: }
96: 
97: function getSummaryAgent(): SummaryAgent {
98:   if (!summaryAgent) summaryAgent = new SummaryAgent()
99:   return summaryAgent
100: }
101: 
102: function getOutlineComplianceAgent(): OutlineComplianceAgent {
103:   if (!outlineComplianceAgent) outlineComplianceAgent = new OutlineComplianceAgent()
104:   return outlineComplianceAgent
105: }
106: 
107: function getFixAgent(): FixAgent {
108:   if (!fixAgent) fixAgent = new FixAgent()
109:   return fixAgent
110: }
111: 
112: let outlineComplianceAgent: OutlineComplianceAgent | null = null
113: let fixAgent: FixAgent | null = null
114: 
115: function charactersToString(characters: Character[]): string {
116:   return characters.map(c => {
117:     const parts = [`【${c.name}】`]
118:     if (c.description) parts.push(c.description)
119:     if (c.dialogueStyle) parts.push(`对话风格：${c.dialogueStyle}`)
120:     return parts.join('\n')
121:   }).join('\n')
122: }
123: 
124: export async function build_world(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
125:   const agent = getWorldbuilderAgent()
126:   const agentState: AgentState = {
127:     idea: state.idea,
128:     genre: state.genre,
129:     totalChapters: state.totalChapters,
130:   }
131: 
132:   const output = await agent.run(agentState)
133:   const world = agent.processOutput(output, state.story.id)
134: 
135:   if (!world) {
136:     console.error('[MuseFlow] 错误: 世界观生成失败，请检查 AI 输出或重试')
137:     return { world: null, story: state.story }
138:   }
139: 
140:   saveWorld(state.story.id, world.content)
141: 
142:   // 如果用户已经选择了标题，保留用户的选择，不使用 AI 生成的标题
143:   const existingTitle = state.story.title
144:   const aiGeneratedTitle = agent.extractTitle(output)
145: 
146:   if (!existingTitle || existingTitle.trim() === '') {
147:     // 用户没有选择标题（旧的调用方式），使用 AI 生成的标题
148:     if (!aiGeneratedTitle) {
149:       return { world, story: { ...state.story, title: state.story.title } }
150:     }
151: 
152:     updateStoryTitle(state.story.id, aiGeneratedTitle)
153:     const newOutputDir = getStoryOutputDirWithTitle(aiGeneratedTitle, state.story.id)
154:     renameStoryOutputDir(state.story.id, newOutputDir)
155: 
156:     return { world, story: { ...state.story, outputDir: newOutputDir, title: aiGeneratedTitle } }
157:   }
158: 
159:   // 用户已经选择了标题，保留用户的选择
160:   console.log(`[MuseFlow] 使用用户选择的书名：${existingTitle}`)
161:   return { world, story: { ...state.story, title: existingTitle } }
162: }
163: 
164: export async function create_characters(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
165:   const agent = getCharacterAgent()
166:   const worldContent = state.world?.content
167:   const agentState: AgentState = {
168:     idea: state.idea,
169:     genre: state.genre,
170:     totalChapters: state.totalChapters,
171:     title: state.story.title,
172:     ...(state.story.worldDirection ? { worldDirection: state.story.worldDirection } : {}),
173:     ...(worldContent ? { world: worldContent } : {}),
174:   }
175: 
176:   const maxRetries = 2
177:   let lastOutput: import('../agents/base.js').AgentOutput | null = null
178: 
179:   for (let attempt = 0; attempt <= maxRetries; attempt++) {
180:     if (attempt > 0) {
181:       console.warn(`[MuseFlow] 角色生成解析失败，第 ${attempt}/${maxRetries} 次重试...`)
182:     }
183: 
184:     const output = await agent.run(agentState)
185:     lastOutput = output
186:     const characters = agent.processOutput(output, state.story.id)
187: 
188:     if (characters.length > 0) {
189:       if (attempt > 0) {
190:         console.log(`[MuseFlow] 角色生成重试成功，共创建 ${characters.length} 个人物`)
191:       }
192:       saveCharacters(state.story.id, characters)
193:       return { characters }
194:     }
195: 
196:     if (!output.success && output.content) {
197:       console.warn(`[MuseFlow] 第 ${attempt + 1} 次角色生成原始输出（前 500 字符）：`)
198:       console.warn(output.content.slice(0, 500))
199:     }
200:   }
201: 
202:   console.error('[MuseFlow] 错误：角色生成失败，已达到最大重试次数')
203:   if (lastOutput?.content) {
204:     console.error('[MuseFlow] 最后一次原始输出（前 1000 字符）：')
205:     console.error(lastOutput.content.slice(0, 1000))
206:   }
207:   throw new Error('[MuseFlow] 错误：角色生成失败，请检查 AI 输出或重试')
208: }
209: 
210: export async function create_outline(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
211:   const agent = getOutlineAgent()
212:   const worldContent = state.world?.content
213:   const agentState: AgentState = {
214:     idea: state.idea,
215:     genre: state.genre,
216:     totalChapters: state.totalChapters,
217:     title: state.story.title,
218:     ...(state.story.worldDirection ? { worldDirection: state.story.worldDirection } : {}),
219:     ...(worldContent ? { world: worldContent } : {}),
220:     characters: charactersToString(state.characters),
221:   }
222: 
223:   const output = await agent.run(agentState)
224:   const outline = agent.processOutput(output)
225: 
226:   if (outline.length === 0) {
227:     throw new Error('[MuseFlow] 错误：大纲解析失败，AI 输出格式无法识别，请重试')
228:   }
229: 
230:   saveOutline(state.story.id, outline)
231:   await writeOutlineContent(state.story.outputDir, state.story.title, outline)
232: 
233:   await writeStoryBible(
234:     state.story.outputDir,
235:     state.story,
236:     worldContent || '',
237:     state.characters,
238:     outline,
239:   )
240: 
241:   return { outline }
242: }
243: 
244: export async function plan_chapter(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
245:   const agent = getChapterPlannerAgent()
246:   const chapterIndex = state.currentChapterIndex
247:   const outlineItem = state.outline[chapterIndex]
248:   const worldContent = state.world?.content
249: 
250:   const previousChapters = buildLayeredSummaries(state.chapterSummaries, chapterIndex)
251:   const timelineSnapshot = buildCharacterFactTimeline(state, chapterIndex)
252: 
253:   const agentState: AgentState = {
254:     idea: state.idea,
255:     genre: state.genre,
256:     totalChapters: state.totalChapters,
257:     ...(worldContent ? { world: worldContent } : {}),
258:     characters: charactersToString(state.characters),
259:     outline: outlineItem ? `第${toDisplayChapterNumber(chapterIndex)}章：${outlineItem.title}\n${outlineItem.description}` : state.outline.map((o, i) => `第${toDisplayChapterNumber(i)}章：${o.title}`).join('\n'),
260:     previousChapters,
261:     chapterIndex,
262:     chapterSummaries: state.chapterSummaries,
263:     timelineSnapshot,
264:     foreshadowStack: state.foreshadowStack,
265:   }
266: 
267:   const output = await agent.run(agentState)
268: 
269:   if (!output.success || !output.data) {
270:     console.warn('[MuseFlow] 章节规划失败，将跳过规划直接写作')
271:     return {}
272:   }
273: 
274:   return { chapterPlan: output.data as import('../agents/chapter-planner.js').ChapterPlan }
275: }
276: 
277: export async function draft_chapter(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
278:   const agent = getChapterAgent()
279:   const chapterIndex = state.currentChapterIndex
280:   const outlineItem = state.outline[chapterIndex]
281:   const worldContent = state.world?.content
282: 
283:   const previousChapters = buildLayeredSummaries(state.chapterSummaries, chapterIndex)
284:   const timelineSnapshot = buildCharacterFactTimeline(state, chapterIndex)
285:   const keyEventsTimeline = buildKeyEventsTimeline(state, chapterIndex)
286: 
287:   const existingContent = state.rewriteApproved
288:     ? await readChapterContent(state.story.outputDir, chapterIndex + 1)
289:     : null
290: 
291:   const agentState: AgentState = {
292:     idea: state.idea,
293:     genre: state.genre,
294:     totalChapters: state.totalChapters,
295:     ...(worldContent ? { world: worldContent } : {}),
296:     characters: charactersToString(state.characters),
297:     outline: outlineItem ? `第${toDisplayChapterNumber(chapterIndex)}章：${outlineItem.title}\n${outlineItem.description}` : state.outline.map((o, i) => `第${toDisplayChapterNumber(i)}章：${o.title}`).join('\n'),
298:     previousChapters,
299:     chapterIndex,
300:     chapterSummaries: state.chapterSummaries,
301:     timelineSnapshot,
302:     keyEventsTimeline,
303:     foreshadowStack: state.foreshadowStack,
304:     ...(state.rewriteApproved ? { issues: state.pendingIssues } : {}),
305:     ...(existingContent ? { chapterContent: existingContent } : {}),
306:     ...(state.chapterPlan ? { chapterPlan: state.chapterPlan } : {}),
307:   }
308: 
309:   const output = await agent.run(agentState)
310: 
311:   let content = output.content ?? ''
312:   if (!content || content.trim().length === 0) {
313:     throw new Error(
314:       `第 ${chapterIndex + 1} 章内容为空，AI 生成失败。请重试。`
315:     )
316:   }
317: 
318:   const preWriteCheck = (output.data as { preWriteCheck?: string } | undefined)?.preWriteCheck
319:   if (!preWriteCheck) {
320:     console.warn(`[MuseFlow] 第 ${chapterIndex + 1} 章未输出预写检查表，可能遗漏大纲要求`)
321:   }
322: 
323:   const trimmedContent = content.trim()
324:   const firstLine = trimmedContent.split('\n').map(l => l.trim()).find(l => l.length > 0)
325:   const hasTitle = firstLine && (
326:     /^#{1,2}\s/.test(firstLine) ||
327:     firstLine.includes(`第${chapterIndex + 1}章`) ||
328:     firstLine.includes(`第 ${chapterIndex + 1} 章`)
329:   )
330: 
331:   if (!hasTitle && outlineItem) {
332:     content = `# 第${chapterIndex + 1}章 ${outlineItem.title}\n\n${trimmedContent}`
333:   }
334: 
335:   await writeChapterContent(state.story.outputDir, chapterIndex + 1, content)
336: 
337:   const now = Date.now()
338:   const newChapter: ChapterMeta = {
339:     id: generateId(),
340:     storyId: state.story.id,
341:     number: toDisplayChapterNumber(chapterIndex),
342:     title: null,
343:     outline: outlineItem?.description || null,
344:     summary: null,
345:     foreshadows: null,
346:     status: 'drafting',
347:     createdAt: now,
348:     updatedAt: now,
349:   }
350: 
351:   const newChapters = [...state.chapters]
352: 
353:   newChapters[chapterIndex] = newChapter
354: 
355:   return {
356:     chapters: newChapters,
357:   }
358: }
359: 
360: export async function fix_chapter(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
361:   const agent = getFixAgent()
362:   const chapterIndex = state.currentChapterIndex
363:   const outlineItem = state.outline[chapterIndex]
364: 
365:   const existingContent = await readChapterContent(state.story.outputDir, chapterIndex + 1)
366:   if (!existingContent) {
367:     throw new Error(
368:       `第 ${chapterIndex + 1} 章文件不存在，无法修复。请运行 write 或 rewrite。`
369:     )
370:   }
371: 
372:   const paragraphs = splitIntoParagraphs(existingContent)
373:   const affectedIndices = findAffectedParagraphs(paragraphs, state.pendingIssues)
374: 
375:   if (affectedIndices.length === 0) {
376:     console.log('[MuseFlow] 未能定位到问题所在段落，将使用全文修复模式')
377:     return await runLegacyFix(agent, state, existingContent, chapterIndex, outlineItem)
378:   }
379: 
380:   const sentenceFixes = buildSentenceFixes(paragraphs, affectedIndices, state.pendingIssues)
381: 
382:   if (sentenceFixes.length > 0 && sentenceFixes.length <= 5) {
383:     console.log(`[MuseFlow] 定位到 ${sentenceFixes.length} 个需修改的句子，使用句子级精准修复`)
384:     return await runSentenceFix(agent, state, existingContent, paragraphs, sentenceFixes, chapterIndex, outlineItem)
385:   }
386: 
387:   console.log(`[MuseFlow] 定位到 ${affectedIndices.length} 个需修改的段落，使用段落级修复`)
388:   return await runParagraphFix(agent, state, existingContent, paragraphs, affectedIndices, chapterIndex, outlineItem)
389: }
390: 
391: function buildSentenceFixes(
392:   paragraphs: string[],
393:   affectedIndices: number[],
394:   issues: Array<import('../types/agent.js').Issue>
395: ): import('../agents/base.js').SentenceFix[] {
396:   const sentenceFixes: import('../agents/base.js').SentenceFix[] = []
397: 
398:   for (const idx of affectedIndices) {
399:     const paragraph = paragraphs[idx]
400:     if (!paragraph) continue
401: 
402:     for (const issue of issues) {
403:       const affectedSentences = findAffectedSentences(paragraph, issue)
404:       for (const sentenceIdx of affectedSentences) {
405:         const sentences = splitParagraphIntoSentences(paragraph)
406:         const original = sentences[sentenceIdx]
407:         if (original) {
408:           sentenceFixes.push({
409:             paragraphIndex: idx,
410:             sentenceIndex: sentenceIdx,
411:             original,
412:             issue,
413:           })
414:         }
415:       }
416:     }
417:   }
418: 
419:   return sentenceFixes
420: }
421: 
422: async function runSentenceFix(
423:   agent: FixAgent,
424:   state: ReducedGraphState,
425:   existingContent: string,
426:   paragraphs: string[],
427:   sentenceFixes: import('../agents/base.js').SentenceFix[],
428:   chapterIndex: number,
429:   outlineItem: { description?: string } | undefined
430: ): Promise<Partial<ReducedGraphState>> {
431:   const affectedParagraphs = new Set(sentenceFixes.map(s => s.paragraphIndex))
432:   const contextIndices = new Set<number>()
433:   for (const idx of affectedParagraphs) {
434:     if (idx > 0) contextIndices.add(idx - 1)
435:     if (idx < paragraphs.length - 1) contextIndices.add(idx + 1)
436:   }
437:   for (const idx of affectedParagraphs) {
438:     contextIndices.delete(idx)
439:   }
440: 
441:   const contextParagraphs = Array.from(contextIndices).sort((a, b) => a - b).map(idx => paragraphs[idx])
442:   const context = contextParagraphs.join('\n\n')
443: 
444:   const agentState: AgentState = {
445:     idea: state.idea,
446:     genre: state.genre,
447:     totalChapters: state.totalChapters,
448:     chapterIndex,
449:     issues: state.pendingIssues,
450:     chapterContent: existingContent,
451:     sentenceFix: {
452:       sentences: sentenceFixes,
453:       context,
454:     },
455:   }
456: 
457:   const output = await agent.run(agentState)
458: 
459:   let content = existingContent
460:   if (output.data && (output.data as { modifiedSentences?: Array<{ paragraphIndex: number; sentenceIndex: number; content: string }> }).modifiedSentences) {
461:     const modifiedSentences = (output.data as { modifiedSentences: Array<{ paragraphIndex: number; sentenceIndex: number; content: string }> }).modifiedSentences
462:     const modifiedParagraphs = new Map<number, Array<{ index: number; content: string }>>()
463: 
464:     for (const s of modifiedSentences) {
465:       if (!modifiedParagraphs.has(s.paragraphIndex)) {
466:         modifiedParagraphs.set(s.paragraphIndex, [])
467:       }
468:       modifiedParagraphs.get(s.paragraphIndex)!.push({ index: s.sentenceIndex, content: s.content })
469:     }
470: 
471:     const resultParagraphs = [...paragraphs]
472:     for (const [pIdx, sentences] of modifiedParagraphs) {
473:       const originalParagraph = paragraphs[pIdx]
474:       if (originalParagraph) {
475:         resultParagraphs[pIdx] = mergeSentenceFixes(originalParagraph, sentences)
476:       }
477:     }
478:     content = resultParagraphs.join('\n\n')
479:   } else {
480:     content = output.content ?? ''
481:     if (!content || content.trim().length === 0) {
482:       throw new Error(`第 ${chapterIndex + 1} 章修复后内容为空，AI 生成失败。请重试。`)
483:     }
484:     const affectedIndices = Array.from(new Set(sentenceFixes.map(s => s.paragraphIndex)))
485:     content = applyParagraphDiffProtection(existingContent, content, affectedIndices)
486:   }
487: 
488:   content = deduplicateSentences(content)
489:   await writeChapterContent(state.story.outputDir, chapterIndex + 1, content)
490: 
491:   const now = Date.now()
492:   const updatedChapter: ChapterMeta = {
493:     id: generateId(),
494:     storyId: state.story.id,
495:     number: toDisplayChapterNumber(chapterIndex),
496:     title: null,
497:     outline: outlineItem?.description || null,
498:     summary: null,
499:     foreshadows: null,
500:     status: 'drafting',
501:     createdAt: now,
502:     updatedAt: now,
503:   }
504: 
505:   const newChapters = [...state.chapters]
506:   newChapters[chapterIndex] = updatedChapter
507: 
508:   return { chapters: newChapters }
509: }
510: 
511: async function runParagraphFix(
512:   agent: FixAgent,
513:   state: ReducedGraphState,
514:   existingContent: string,
515:   paragraphs: string[],
516:   affectedIndices: number[],
517:   chapterIndex: number,
518:   outlineItem: { description?: string } | undefined
519: ): Promise<Partial<ReducedGraphState>> {
520:   const paragraphFixes = affectedIndices.map(idx => {
521:     const paragraphContent = paragraphs[idx]
522:     if (!paragraphContent) {
523:       throw new Error(`段落索引 ${idx} 超出范围`)
524:     }
525:     return {
526:       index: idx,
527:       content: paragraphContent,
528:       issues: state.pendingIssues.filter(issue => {
529:         const keywords = extractIssueKeywords(issue)
530:         return keywords.some(kw => paragraphContent.includes(kw))
531:       }),
532:     }
533:   })
534: 
535:   const contextIndices = new Set<number>()
536:   for (const idx of affectedIndices) {
537:     if (idx > 0) contextIndices.add(idx - 1)
538:     if (idx < paragraphs.length - 1) contextIndices.add(idx + 1)
539:   }
540:   for (const idx of affectedIndices) {
541:     contextIndices.delete(idx)
542:   }
543: 
544:   const contextParagraphs = Array.from(contextIndices).sort((a, b) => a - b).map(idx => paragraphs[idx])
545:   const context = contextParagraphs.join('\n\n')
546: 
547:   const agentState: AgentState = {
548:     idea: state.idea,
549:     genre: state.genre,
550:     totalChapters: state.totalChapters,
551:     chapterIndex,
552:     issues: state.pendingIssues,
553:     chapterContent: existingContent,
554:     paragraphFix: {
555:       paragraphs: paragraphFixes,
556:       context,
557:     },
558:   }
559: 
560:   const output = await agent.run(agentState)
561: 
562:   let content: string
563:   if (output.data && (output.data as { modifiedParagraphs?: Array<{ index: number; content: string }> }).modifiedParagraphs) {
564:     const modifiedParagraphs = (output.data as { modifiedParagraphs: Array<{ index: number; content: string }> }).modifiedParagraphs
565:     content = mergeParagraphFixes(paragraphs, modifiedParagraphs, affectedIndices)
566:   } else {
567:     content = output.content ?? ''
568:     if (!content || content.trim().length === 0) {
569:       throw new Error(`第 ${chapterIndex + 1} 章修复后内容为空，AI 生成失败。请重试。`)
570:     }
571:     content = applyParagraphDiffProtection(existingContent, content, affectedIndices)
572:   }
573: 
574:   content = deduplicateSentences(content)
575:   await writeChapterContent(state.story.outputDir, chapterIndex + 1, content)
576: 
577:   const now = Date.now()
578:   const updatedChapter: ChapterMeta = {
579:     id: generateId(),
580:     storyId: state.story.id,
581:     number: toDisplayChapterNumber(chapterIndex),
582:     title: null,
583:     outline: outlineItem?.description || null,
584:     summary: null,
585:     foreshadows: null,
586:     status: 'drafting',
587:     createdAt: now,
588:     updatedAt: now,
589:   }
590: 
591:   const newChapters = [...state.chapters]
592:   newChapters[chapterIndex] = updatedChapter
593: 
594:   return {
595:     chapters: newChapters,
596:   }
597: }
598: 
599: async function runLegacyFix(
600:   agent: FixAgent,
601:   state: ReducedGraphState,
602:   existingContent: string,
603:   chapterIndex: number,
604:   outlineItem: { description?: string } | undefined
605: ): Promise<Partial<ReducedGraphState>> {
606:   const agentState: AgentState = {
607:     idea: state.idea,
608:     genre: state.genre,
609:     totalChapters: state.totalChapters,
610:     chapterIndex,
611:     issues: state.pendingIssues,
612:     chapterContent: existingContent,
613:   }
614: 
615:   const output = await agent.run(agentState)
616: 
617:   let content = output.content ?? ''
618:   if (!content || content.trim().length === 0) {
619:     throw new Error(`第 ${chapterIndex + 1} 章修复后内容为空，AI 生成失败。请重试。`)
620:   }
621:   content = deduplicateSentences(content)
622:   await writeChapterContent(state.story.outputDir, chapterIndex + 1, content)
623: 
624:   const now = Date.now()
625:   const updatedChapter: ChapterMeta = {
626:     id: generateId(),
627:     storyId: state.story.id,
628:     number: toDisplayChapterNumber(chapterIndex),
629:     title: null,
630:     outline: outlineItem?.description || null,
631:     summary: null,
632:     foreshadows: null,
633:     status: 'drafting',
634:     createdAt: now,
635:     updatedAt: now,
636:   }
637: 
638:   const newChapters = [...state.chapters]
639:   newChapters[chapterIndex] = updatedChapter
640: 
641:   return {
642:     chapters: newChapters,
643:   }
644: }
645: 
646: export function splitIntoParagraphs(text: string): string[] {
647:   return text.split(/\n\n+/).filter(p => p.trim().length > 0)
648: }
649: 
650: export interface LocationInfo {
651:   paragraphIndex?: number
652:   sentenceIndex?: number
653: }
654: 
655: export function extractLocationInfo(issue: { description: string; location?: string }): LocationInfo[] {
656:   const locations: LocationInfo[] = []
657:   const text = issue.description + ' ' + (issue.location || '')
658: 
659:   const paragraphPatterns = [
660:     /第\s*(\d+)\s*段/g,
661:     /第\s*([一二三四五六七八九十百]+)\s*段/g,
662:     /段落?\s*(\d+)/g,
663:   ]
664: 
665:   for (const pattern of paragraphPatterns) {
666:     let match
667:     while ((match = pattern.exec(text)) !== null) {
668:       const group = match[1]
669:       if (!group) continue
670:       const num = parseLocationNumber(group)
671:       if (num !== null) {
672:         locations.push({ paragraphIndex: num - 1 })
673:       }
674:     }
675:   }
676: 
677:   const sentencePatterns = [
678:     /第\s*(\d+)\s*句/g,
679:     /第\s*([一二三四五六七八九十百]+)\s*句/g,
680:   ]
681: 
682:   for (const pattern of sentencePatterns) {
683:     let match
684:     while ((match = pattern.exec(text)) !== null) {
685:       const group = match[1]
686:       if (!group) continue
687:       const num = parseLocationNumber(group)
688:       if (num !== null) {
689:         locations.push({ sentenceIndex: num - 1 })
690:       }
691:     }
692:   }
693: 
694:   return locations
695: }
696: 
697: function parseLocationNumber(str: string): number | null {
698:   const num = parseInt(str, 10)
699:   if (!isNaN(num)) return num
700: 
701:   const chineseMap: Record<string, number> = {
702:     '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
703:     '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
704:   }
705: 
706:   let result = 0
707:   for (const char of str) {
708:     const val = chineseMap[char]
709:     if (val === undefined) return null
710:     result = result * 10 + val
711:   }
712:   return result > 0 ? result : null
713: }
714: 
715: const STOP_WORDS = new Set([
716:   '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这', '那', '这些', '那些', '这个', '那个', '这样', '那样', '这里', '那里', '这边', '那边', '这时', '那时', '之后', '之前', '然后', '接着', '后来', '于是', '因此', '所以', '因为', '由于', '虽然', '但是', '然而', '不过', '而且', '并且', '或者', '还是', '要么', '不仅', '不但', '只要', '只有', '无论', '不管', '尽管', '即使', '即便', '除非', '除了', '此外', '另外', '而且', '并且', '然后', '接着', '后来', '于是', '因此', '因而', '从而', '总之', '综上所述', '例如', '比如', '譬如', '像是', '好像', '仿佛', '似乎', '大概', '大约', '也许', '可能', '或许', '应该', '应当', '需要', '必须', '一定', '肯定', '当然', '自然', '其实', '实际上', '事实上', '本来', '原来', '原先', '最初', '开始', '最后', '最终', '终于', '结果', '可以', '能够', '可能', '应该', '得', '地', '着', '过', '把', '被', '让', '给', '向', '往', '从', '自', '由', '把', '将', '把', '被', '让', '给', '跟', '同', '与', '及', '以及', '还有', '或者', '还是', '既', '又', '也', '还', '再', '才', '就', '便', '即', '则', '却', '可', '但', '而', '因', '为', '以', '于', '对', '关于', '对于', '至于', '鉴于', '根据', '按照', '依照', '遵循', '遵守', '符合', '满足', '达到', '实现', '完成', '结束', '停止', '终止', '中断', '继续', '恢复', '重复', '重新', '再次', '一再', '屡次', '多次',
717: ])
718: 
719: export function extractIssueKeywords(issue: { description: string; location?: string }): string[] {
720:   const keywords: string[] = []
721: 
722:   const text = issue.description + ' ' + (issue.location || '')
723: 
724:   const quotes = text.match(/"([^"]+)"/g)
725:   if (quotes) {
726:     keywords.push(...quotes.map(q => q.slice(1, -1)))
727:   }
728: 
729:   const chineseSequences = text.match(/[\u4e00-\u9fff]+/g)
730:   if (chineseSequences) {
731:     for (const sequence of chineseSequences) {
732:       const maxLen = Math.min(6, sequence.length)
733:       for (let len = 2; len <= maxLen; len++) {
734:         for (let i = 0; i <= sequence.length - len; i++) {
735:           const substr = sequence.slice(i, i + len)
736:           if (substr.length >= 2 && !STOP_WORDS.has(substr)) {
737:             keywords.push(substr)
738:           }
739:         }
740:       }
741:     }
742:   }
743: 
744:   const unique = [...new Set(keywords)]
745:   return unique.slice(0, 50)
746: }
747: 
748: export function findAffectedParagraphs(paragraphs: string[], issues: Array<{ description: string; location?: string }>): number[] {
749:   const affected = new Set<number>()
750: 
751:   for (const issue of issues) {
752:     const locations = extractLocationInfo(issue)
753:     const hasExplicitLocation = locations.some(l => l.paragraphIndex !== undefined)
754: 
755:     if (hasExplicitLocation) {
756:       for (const loc of locations) {
757:         if (loc.paragraphIndex !== undefined && loc.paragraphIndex >= 0 && loc.paragraphIndex < paragraphs.length) {
758:           affected.add(loc.paragraphIndex)
759:         }
760:       }
761:       continue
762:     }
763: 
764:     const keywords = extractIssueKeywords(issue)
765:     if (keywords.length === 0) continue
766: 
767:     for (let i = 0; i < paragraphs.length; i++) {
768:       const paragraph = paragraphs[i]
769:       if (paragraph && keywords.some(kw => paragraph.includes(kw))) {
770:         affected.add(i)
771:       }
772:     }
773:   }
774: 
775:   return Array.from(affected).sort((a, b) => a - b)
776: }
777: 
778: export function splitParagraphIntoSentences(paragraph: string): string[] {
779:   const matches = [...paragraph.matchAll(/[^。！？\n]+[。！？\n]?/g)]
780:   if (matches.length === 0) return [paragraph]
781:   return matches.map(m => m[0]).filter(s => s.trim().length > 0)
782: }
783: 
784: export function findAffectedSentences(paragraph: string, issue: { description: string; location?: string }): number[] {
785:   const sentences = splitParagraphIntoSentences(paragraph)
786:   const affected = new Set<number>()
787: 
788:   const locations = extractLocationInfo(issue)
789:   const hasSentenceLocation = locations.some(l => l.sentenceIndex !== undefined)
790: 
791:   if (hasSentenceLocation) {
792:     for (const loc of locations) {
793:       if (loc.sentenceIndex !== undefined && loc.sentenceIndex >= 0 && loc.sentenceIndex < sentences.length) {
794:         affected.add(loc.sentenceIndex)
795:       }
796:     }
797:     return Array.from(affected).sort((a, b) => a - b)
798:   }
799: 
800:   const keywords = extractIssueKeywords(issue)
801:   if (keywords.length === 0) return []
802: 
803:   for (let i = 0; i < sentences.length; i++) {
804:     const sentence = sentences[i]
805:     if (sentence && keywords.some(kw => sentence.includes(kw))) {
806:       affected.add(i)
807:     }
808:   }
809: 
810:   return Array.from(affected).sort((a, b) => a - b)
811: }
812: 
813: export function mergeSentenceFixes(
814:   originalParagraph: string,
815:   modifiedSentences: Array<{ index: number; content: string }>
816: ): string {
817:   const sentences = splitParagraphIntoSentences(originalParagraph)
818:   const modifiedMap = new Map(modifiedSentences.map(s => [s.index, s.content]))
819: 
820:   const result = sentences.map((s, i) => modifiedMap.has(i) ? modifiedMap.get(i)! : s)
821:   return result.join('')
822: }
823: 
824: export function mergeParagraphFixes(
825:   originalParagraphs: string[],
826:   modifiedParagraphs: Array<{ index: number; content: string }>,
827:   affectedIndices: number[]
828: ): string {
829:   const result = [...originalParagraphs]
830:   const modifiedMap = new Map(modifiedParagraphs.map(p => [p.index, p.content]))
831: 
832:   for (const idx of affectedIndices) {
833:     if (modifiedMap.has(idx)) {
834:       result[idx] = modifiedMap.get(idx)!
835:     }
836:   }
837: 
838:   return result.join('\n\n')
839: }
840: 
841: export function applyParagraphDiffProtection(
842:   original: string,
843:   fixed: string,
844:   allowedIndices: number[]
845: ): string {
846:   const originalParagraphs = splitIntoParagraphs(original)
847:   const fixedParagraphs = splitIntoParagraphs(fixed)
848: 
849:   if (originalParagraphs.length !== fixedParagraphs.length) {
850:     console.warn('[MuseFlow] 修复后段落数量变化，跳过段落保护')
851:     return fixed
852:   }
853: 
854:   const allowedSet = new Set(allowedIndices)
855:   let revertedCount = 0
856:   const result: string[] = []
857: 
858:   for (let i = 0; i < originalParagraphs.length; i++) {
859:     const originalParagraph = originalParagraphs[i]
860:     const fixedParagraph = fixedParagraphs[i]
861:     if (!originalParagraph || !fixedParagraph) {
862:       continue
863:     }
864:     if (!allowedSet.has(i) && originalParagraph !== fixedParagraph) {
865:       console.log(`[MuseFlow] 检测到无关段落 ${i} 被修改，已自动回退`)
866:       result.push(originalParagraph)
867:       revertedCount++
868:     } else {
869:       result.push(fixedParagraph)
870:     }
871:   }
872: 
873:   if (revertedCount > 0) {
874:     console.log(`[MuseFlow] 共回退 ${revertedCount} 个无关段落的修改`)
875:   }
876: 
877:   return result.join('\n\n')
878: }
879: 
880: export function deduplicateSentences(text: string): string {
881:   const MIN_SENTENCE_LENGTH = 10
882:   const SENTENCE_PATTERN = /[^。？！\n]+[。？！\n]/g
883: 
884:   const matches = [...text.matchAll(SENTENCE_PATTERN)]
885:   if (matches.length === 0) return text
886: 
887:   const seen = new Set<string>()
888:   let removedCount = 0
889:   const rebuilt: string[] = []
890:   let pos = 0
891: 
892:   for (const match of matches) {
893:     rebuilt.push(text.slice(pos, match.index))
894:     const sentence = match[0]
895:     const trimmed = sentence.trim()
896: 
897:     const isDuplicate = trimmed.length >= MIN_SENTENCE_LENGTH && seen.has(trimmed)
898:     if (isDuplicate) {
899:       removedCount++
900:     } else {
901:       seen.add(trimmed)
902:       rebuilt.push(sentence)
903:     }
904: 
905:     pos = (match.index ?? 0) + sentence.length
906:   }
907:   rebuilt.push(text.slice(pos))
908: 
909:   const finalText = rebuilt.join('')
910:   if (removedCount > 0) {
911:     console.log(`[MuseFlow] 自动清理 ${removedCount} 个重复句子`)
912:   }
913:   return finalText
914: }
915: 
916: function countChineseWords(text: string): number {
917:   const chineseChars = (text.match(/[\u4e00-\u9fff]/g) ?? []).length
918:   const englishWords = (text.match(/[a-zA-Z]+/g) ?? []).length
919:   return chineseChars + englishWords
920: }
921: 
922: export async function validate_chapter(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
923:   const chapterIndex = state.currentChapterIndex
924:   const content = await readChapterContent(state.story.outputDir, chapterIndex + 1)
925: 
926:   if (content === null) {
927:     return {
928:       pendingIssues: [
929:         ...state.pendingIssues,
930:         {
931:           id: generateId(),
932:           type: 'word_count' as const,
933:           severity: 'error' as const,
934:           description: `第 ${chapterIndex + 1} 章正文文件未找到`,
935:         },
936:       ],
937:     }
938:   }
939: 
940:   const wordCount = countChineseWords(content)
941:   const genre = getGenreSkill(state.genre)
942:   const min = genre?.chapterWordCountMin ?? 1500
943:   const max = genre?.chapterWordCountMax ?? 8000
944: 
945:   const newIssues = [...state.pendingIssues]
946: 
947:   if (wordCount < min) {
948:     newIssues.push({
949:       id: generateId(),
950:       type: 'word_count' as const,
951:       severity: 'error',
952:       description: `第 ${chapterIndex + 1} 章字数 ${wordCount} 低于最低要求 ${min} 字`,
953:     })
954:   } else if (wordCount > max) {
955:     newIssues.push({
956:       id: generateId(),
957:       type: 'word_count' as const,
958:       severity: 'warning',
959:       description: `第 ${chapterIndex + 1} 章字数 ${wordCount} 超过建议上限 ${max} 字`,
960:     })
961:   }
962: 
963:   return {}
964: }
965: 
966: export async function quality_pass(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
967:   const agent = getQualityAgent()
968:   const chapterIndex = state.currentChapterIndex
969:   const chapter = state.chapters[chapterIndex]
970: 
971:   if (!chapter) return {}
972: 
973:   const content = await readChapterContent(state.story.outputDir, chapterIndex + 1)
974:   const agentState: AgentState = {
975:     idea: state.idea,
976:     genre: state.genre,
977:     totalChapters: state.totalChapters,
978:     ...(content ? { chapterContent: content } : {}),
979:   }
980: 
981:   const output = await agent.run(agentState)
982:   const { issues } = agent.processOutput(output)
983: 
984:   const updatedChapter: ChapterMeta = {
985:     ...chapter,
986:     updatedAt: Date.now(),
987:   }
988: 
989:   const newChapters = [...state.chapters]
990:   newChapters[chapterIndex] = updatedChapter
991: 
992:   // Quality issues are added to pendingIssues for the rewrite loop to address
993:   return issues.length > 0 ? { pendingIssues: [...state.pendingIssues, ...issues] } : {}
994: }
995: 
996: export async function detect_foreshadowing(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
997:   const agent = getForeshadowingAgent()
998:   const chapterIndex = state.currentChapterIndex
999:   const chapter = state.chapters[chapterIndex]
1000: 
1001:   if (!chapter) return {}
1002: 
1003:   const content = await readChapterContent(state.story.outputDir, chapterIndex + 1)
1004:   const agentState: AgentState = {
1005:     idea: state.idea,
1006:     genre: state.genre,
1007:     totalChapters: state.totalChapters,
1008:     ...(content ? { chapterContent: content } : {}),
1009:     foreshadowStack: state.foreshadowStack,
1010:   }
1011: 
1012:   const output = await agent.run(agentState)
1013:   const foreshadowStack = agent.processOutput(output, chapterIndex, state.foreshadowStack)
1014: 
1015:   return { foreshadowStack }
1016: }
1017: 
1018: export async function detect_hallucination(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
1019:   const agent = getHallucinationAgent()
1020:   const chapterIndex = state.currentChapterIndex
1021:   const chapter = state.chapters[chapterIndex]
1022: 
1023:   if (!chapter) return {}
1024: 
1025:   const worldContent = state.world?.content
1026:   const content = await readChapterContent(state.story.outputDir, chapterIndex + 1)
1027:   const agentState: AgentState = {
1028:     idea: state.idea,
1029:     genre: state.genre,
1030:     totalChapters: state.totalChapters,
1031:     ...(worldContent ? { world: worldContent } : {}),
1032:     characters: charactersToString(state.characters),
1033:     ...(content ? { chapterContent: content } : {}),
1034:   }
1035: 
1036:   const output = await agent.run(agentState)
1037:   const issues = agent.processOutput(output)
1038: 
1039:   // Hallucination issues are added to pendingIssues for the rewrite loop to address
1040:   return issues.length > 0 ? { pendingIssues: [...state.pendingIssues, ...issues] } : {}
1041: }
1042: 
1043: export async function detect_consistency(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
1044:   const agent = getConsistencyAgent()
1045:   const chapterIndex = state.currentChapterIndex
1046:   const chapter = state.chapters[chapterIndex]
1047: 
1048:   if (!chapter) return {}
1049: 
1050:   const content = await readChapterContent(state.story.outputDir, chapterIndex + 1)
1051:   const timelineSnapshot = buildCharacterFactTimeline(state, chapterIndex)
1052: 
1053:   const agentState: AgentState = {
1054:     idea: state.idea,
1055:     genre: state.genre,
1056:     totalChapters: state.totalChapters,
1057:     ...(state.world?.content ? { world: state.world.content } : {}),
1058:     characters: charactersToString(state.characters),
1059:     outline: state.outline.map((o, i) => `第${i + 1}章：${o.title}\n${o.description}`).join('\n\n'),
1060:     ...(content ? { chapterContent: content } : {}),
1061:     chapterSummaries: state.chapterSummaries,
1062:     chapterIndex,
1063:     timelineSnapshot,
1064:   }
1065: 
1066:   const output = await agent.run(agentState)
1067:   const issues = agent.processOutput(output)
1068: 
1069:   // Consistency issues are added to pendingIssues for the rewrite loop to address
1070:   return issues.length > 0 ? { pendingIssues: [...state.pendingIssues, ...issues] } : {}
1071: }
1072: 
1073: export async function verify_outline_compliance(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
1074:   const agent = getOutlineComplianceAgent()
1075:   const chapterIndex = state.currentChapterIndex
1076:   const outlineItem = state.outline[chapterIndex]
1077:   const chapter = state.chapters[chapterIndex]
1078: 
1079:   if (!chapter || !outlineItem) {
1080:     return {}
1081:   }
1082: 
1083:   const content = await readChapterContent(state.story.outputDir, chapterIndex + 1)
1084: 
1085:   const agentState: AgentState = {
1086:     idea: state.idea,
1087:     genre: state.genre,
1088:     totalChapters: state.totalChapters,
1089:     chapterIndex,
1090:     outline: `第${toDisplayChapterNumber(chapterIndex)}章：${outlineItem.title}\n${outlineItem.description}`,
1091:     ...(content ? { chapterContent: content } : {}),
1092:   }
1093: 
1094:   const output = await agent.run(agentState)
1095:   const { issues, isCompliant } = agent.processOutput(output)
1096: 
1097:   if (!isCompliant) {
1098:     return {
1099:       pendingIssues: [...state.pendingIssues, ...issues],
1100:       rewriteApproved: true,
1101:     }
1102:   }
1103: 
1104:   return {}
1105: }
1106: 
1107: export async function request_rewrite(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
1108:   const issues = state.pendingIssues.filter(i => i.severity === 'error')
1109:   if (issues.length > 0) {
1110:     console.error('[MuseFlow] 严重问题需要重写:', issues)
1111:   }
1112:   return { rewriteRequested: true }
1113: }
1114: 
1115: export async function finalize_chapter(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
1116:   const chapterIndex = state.currentChapterIndex
1117:   const chapter = state.chapters[chapterIndex]
1118: 
1119:   // Guard: Verify chapter file has content before marking as complete
1120:   const chapterContent = await readChapterContent(state.story.outputDir, chapterIndex + 1)
1121:   if (chapterContent === null || chapterContent.trim().length === 0) {
1122:     throw new Error(
1123:       `第 ${chapterIndex + 1} 章文件为空或不存在，无法标记为完成。请重试撰写。`
1124:     )
1125:   }
1126: 
1127:   if (chapter) {
1128:     let summary = chapter.summary || ''
1129:     const needsSummary = !summary && chapterContent
1130:     if (needsSummary) {
1131:       const summaryAgent = getSummaryAgent()
1132:       const summaryState: AgentState = {
1133:         idea: state.idea,
1134:         genre: state.genre,
1135:         totalChapters: state.totalChapters,
1136:         chapterContent,
1137:         ...(state.outline[chapterIndex]?.title ? { chapterTitle: state.outline[chapterIndex].title } : {}),
1138:         chapterIndex,
1139:       }
1140:       try {
1141:         const summaryOutput = await summaryAgent.run(summaryState)
1142:         const processed = processSummaryOutput(summaryOutput)
1143:         if (processed) {
1144:           summary = processed
1145:           chapter.summary = summary
1146:         }
1147:       } catch (err) {
1148:         console.warn(`[MuseFlow] 生成第 ${chapterIndex + 1} 章摘要失败:`, err)
1149:       }
1150:     }
1151: 
1152:     if (summary && !state.chapterSummaries.includes(summary)) {
1153:       state.chapterSummaries.push(summary)
1154:     }
1155:   }
1156: 
1157:   const snapshot = appendTimelineSnapshot(state.story.id, {
1158:     chapterNumber: chapterIndex + 1,
1159:     snapshotType: 'chapter_complete',
1160:     currentChapterIndex: chapterIndex,
1161:     chapterTitle: state.outline[chapterIndex]?.title ?? null,
1162:     chapterSummary: chapter?.summary ?? null,
1163:     wordCount: null,
1164:     stateSummary: null,
1165:     issuesResolved: state.pendingIssues.filter(i => i.severity !== 'error').length,
1166:     issuesPending: state.pendingIssues.filter(i => i.severity === 'error').length,
1167:     stateJson: null,
1168:   })
1169: 
1170:   saveForeshadowStack(state.story.id, state.foreshadowStack)
1171: 
1172:   const alerts = getForeshadowAlerts(state.foreshadowStack, chapterIndex + 1)
1173:   saveForeshadowAlerts(state.story.id, alerts)
1174: 
1175:   const nextIndex = state.currentChapterIndex + 1
1176:   const isLastChapter = nextIndex >= state.totalChapters
1177: 
1178:   const checkpointer = getCheckpointer()
1179:   await checkpointer.saveChapterCheckpoint(
1180:     state.story.outputDir,
1181:     chapterIndex + 1
1182:   ).catch(() => {})
1183:   await checkpointer.pruneIntermediateCheckpoints(state.story.outputDir).catch(() => {})
1184:   await checkpointer.clearPendingWrites(state.story.outputDir).catch(() => {})
1185: 
1186:   return {
1187:     currentChapterIndex: nextIndex,
1188:     chapterSummaries: state.chapterSummaries,
1189:   }
1190: }
1191: 
1192: export async function finalize_story(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
1193:   return {}
1194: }
1195: 
1196: export async function auto_fix_warnings(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
1197:   const errors = state.pendingIssues.filter(i => i.severity === 'error')
1198:   const warnings = state.pendingIssues.filter(i => i.severity === 'warning')
1199: 
1200:   if (errors.length > 0) {
1201:     return {}
1202:   }
1203: 
1204:   if (warnings.length === 0) {
1205:     return {}
1206:   }
1207: 
1208:   return {}
1209: }
1210: 
1211: function formatCharacterFactEntries(
1212:   entries: Array<{ character: string; facts: string[] }>,
1213:   chapterNum: number
1214: ): string {
1215:   if (entries.length === 0) return ''
1216: 
1217:   const lines = [`第${chapterNum}章角色事实：`]
1218:   for (const entry of entries) {
1219:     lines.push(`  ${entry.character}：`)
1220:     for (const fact of entry.facts) {
1221:       lines.push(`    - ${fact}`)
1222:     }
1223:   }
1224:   return lines.join('\n')
1225: }
1226: 
1227: function buildCharacterFactTimeline(
1228:   state: ReducedGraphState,
1229:   upToChapterIndex: number
1230: ): string {
1231:   const summaries = state.chapterSummaries.slice(0, upToChapterIndex)
1232:   if (!summaries.length) return '（暂无历史记录）'
1233: 
1234:   const result: string[] = []
1235: 
1236:   for (let i = 0; i < summaries.length; i++) {
1237:     const summary = summaries[i]
1238:     if (!summary) continue
1239: 
1240:     const chapterNum = i + 1
1241:     const distance = upToChapterIndex - chapterNum
1242:     const level = getCompressionLevel(chapterNum - 1, upToChapterIndex)
1243:     const threshold = getImportanceThreshold(level)
1244: 
1245:     const filtered = filterCharacterFactsByImportance(summary, threshold)
1246:     const formatted = formatCharacterFactEntries(filtered, chapterNum)
1247: 
1248:     if (formatted) {
1249:       result.push(formatted)
1250:     }
1251:   }
1252: 
1253:   return result.length > 0 ? result.join('\n\n') : '（暂无历史记录）'
1254: }
1255: 
1256: function buildKeyEventsTimeline(
1257:   state: ReducedGraphState,
1258:   upToChapterIndex: number
1259: ): string {
1260:   const summaries = state.chapterSummaries.slice(0, upToChapterIndex)
1261:   if (!summaries.length) return '（暂无历史记录）'
1262: 
1263:   const result: string[] = []
1264: 
1265:   for (let i = 0; i < summaries.length; i++) {
1266:     const summary = summaries[i]
1267:     if (!summary) continue
1268: 
1269:     const chapterNum = i + 1
1270:     const distance = upToChapterIndex - chapterNum
1271:     const level = getCompressionLevel(chapterNum - 1, upToChapterIndex)
1272:     const threshold = getImportanceThreshold(level)
1273: 
1274:     const events = filterKeyEventsByImportance(summary, threshold)
1275:     if (events.length > 0) {
1276:       result.push(`第${chapterNum}章关键事件：\n${events.map(e => `  - ${e}`).join('\n')}`)
1277:     }
1278:   }
1279: 
1280:   return result.length > 0 ? result.join('\n\n') : '（暂无历史记录）'
1281: }

(End of file - total 1281 lines)
</content>
```

---

## Assistant (​Sisyphus - Ultraworker · Kimi K2.6 · 9.3s)

_Thinking:_

现在我需要查看 ChapterAgent 的实现，特别是它如何构建 prompt。让我查找 ChapterAgent 和 ChapterPlannerAgent。

**Tool: grep**

**Input:**
```json
{
  "pattern": "class ChapterAgent|class ChapterPlannerAgent",
  "path": "/Users/bytedance/workspace/museflow/src/agents",
  "output_mode": "files_with_matches"
}
```

**Output:**
```
Found 2 match(es) in 2 file(s)

/Users/bytedance/workspace/museflow/src/agents/chapter.ts

/Users/bytedance/workspace/museflow/src/agents/chapter-planner.ts

[Agent Usage Reminder]

You called a search/fetch tool directly without leveraging specialized agents.

RECOMMENDED: Use task with explore/librarian agents for better results:

```
// Parallel exploration - fire multiple agents simultaneously
task(subagent_type="explore", load_skills=[], prompt="Find all files matching pattern X")
task(subagent_type="explore", load_skills=[], prompt="Search for implementation of Y")
task(subagent_type="librarian", load_skills=[], prompt="Lookup documentation for Z")

// Then continue your work while they run in background
// System will notify you when each completes
```

WHY:
- Agents can perform deeper, more thorough searches
- Background tasks run in parallel, saving time
- Specialized agents have domain expertise
- Reduces context window usage in main session

ALWAYS prefer: Multiple parallel task calls > Direct tool calls

```

---

## Assistant (​Sisyphus - Ultraworker · Kimi K2.6 · 5.6s)

_Thinking:_

让我继续查看 chapter.ts 和 chapter-planner.ts 的实现，了解它们如何构建 prompt。

**Tool: read**

**Input:**
```json
{
  "filePath": "/Users/bytedance/workspace/museflow/src/agents/chapter.ts"
}
```

**Output:**
```
<path>/Users/bytedance/workspace/museflow/src/agents/chapter.ts</path>
<type>file</type>
<content>
1: import { BaseAgent, type AgentState, type AgentOutput } from './base.js'
2: import type { ChapterMeta } from '../types/chapter.js'
3: import type { ForeshadowItem } from '../graph/state.js'
4: import { generateId } from '../utils/id.js'
5: import { toDisplayChapterNumber } from '../utils/chapter-display.js'
6: import type { ChapterPlan } from './chapter-planner.js'
7: 
8: export class ChapterAgent extends BaseAgent {
9:   constructor() {
10:     super(undefined, 0.7)
11:   }
12:   protected buildPrompt(state: Required<AgentState>): import('../model/provider.js').Message[] {
13:     const genre = this.getGenre(state.genre)
14:     const chapterSupplement = genre?.chapterPromptSupplement ?? ''
15:     const chapterIndex = state.chapterIndex ?? 0
16:     const displayChapterNumber = toDisplayChapterNumber(chapterIndex)
17: 
18:     const outline = state.outline || ''
19:     const chapterInfo = this.extractChapterOutline(outline, displayChapterNumber)
20: 
21:     const previousSummary = state.previousChapters || '（这是第一章）'
22: 
23:     const timelineSection = state.timelineSnapshot
24:       ? `上一章结束时的状态：
25: ${state.timelineSnapshot}
26: 
27: 请在继续写作时保持与上述状态的一致性。`
28:       : ''
29: 
30:     const keyEventsSection = state.keyEventsTimeline
31:       ? `【重要 - 已发生的关键事件】以下事件已在前面章节中发生，后续章节必须承认并遵循这些事实，不可遗漏、遗忘或矛盾：
32: ${state.keyEventsTimeline}
33: 
34: 【强制要求】以上关键事件是已确立的叙事事实，本章写作时必须保持一致。如果本章涉及这些事件的后续发展，必须给出合理的因果衔接，不可凭空改变事件结果。`
35:       : ''
36: 
37:     const issuesSection = state.issues && state.issues.length > 0
38:       ? `【重要】本章需要修复的问题：
39: ${state.issues.map((issue, i) => `${i + 1}. [${issue.type}] ${issue.description}${issue.location ? `\n   位置: ${issue.location}` : ''}`).join('\n')}
40: 
41: 【重要】请务必按照上述问题描述修复本章内容，严格遵循大纲设定。`
42:       : ''
43: 
44:     const currentChapterIndex = (state.chapterIndex ?? 0) + 1
45:     const activeForeshadows = state.foreshadowStack?.filter(f => !f.fulfilledChapter) ?? []
46:     
47:     const overdueForeshadows = activeForeshadows.filter(
48:       f => currentChapterIndex > f.expectedFulfillChapter + 1
49:     )
50:     const urgentForeshadows = activeForeshadows.filter(
51:       f => currentChapterIndex >= f.expectedFulfillChapter - 1 && currentChapterIndex <= f.expectedFulfillChapter + 1
52:     )
53:     const normalForeshadows = activeForeshadows.filter(
54:       f => currentChapterIndex < f.expectedFulfillChapter - 1
55:     )
56: 
57:     const foreshadowSection = activeForeshadows.length > 0
58:       ? `【伏笔回收提醒】
59: ${overdueForeshadows.length > 0 ? `⚠️ 已逾期伏笔（必须在本章回收）：
60: ${overdueForeshadows.map((f, i) => `  ${i + 1}. "${f.text}"（预期第${f.expectedFulfillChapter}章，已逾期${currentChapterIndex - f.expectedFulfillChapter}章）`).join('\n')}
61: 
62: 【强制要求】以上逾期伏笔已严重超期，必须在本章明确回收。如果本章无法自然回收，请通过角色回忆、对话揭示或场景呼应的方式处理，绝不可继续拖延。\n\n` : ''}${urgentForeshadows.length > 0 ? `🔔 即将到期伏笔（建议在本章回收）：
63: ${urgentForeshadows.map((f, i) => `  ${i + 1}. "${f.text}"（预期第${f.expectedFulfillChapter}章）`).join('\n')}
64: 
65: ` : ''}${normalForeshadows.length > 0 ? `⏳ 正常伏笔（后续章节回收）：
66: ${normalForeshadows.map((f, i) => `  ${i + 1}. "${f.text}"（预期第${f.expectedFulfillChapter}章）`).join('\n')}\n\n` : ''}请注意在写作时自然地呼应或揭示需要回收的伏笔。`
67:       : ''
68: 
69:     const existingChapterSection = state.chapterContent
70:       ? `【当前章节正文】（请在原文基础上修改，保留好的部分，修正问题）：
71: ${state.chapterContent}`
72:       : ''
73: 
74:     const mainCharacterName = state.characters
75:       ? (state.characters.match(/^【([^】]+)】/m)?.[1] || '（未设定主角）')
76:       : '（未设定主角）'
77: 
78:     const planSection = state.chapterPlan
79:       ? `【章节写作规划】（必须严格遵循以下结构）：
80: ${JSON.stringify(state.chapterPlan, null, 2)}`
81:       : ''
82: 
83:     const outlineKeyPoints = this.extractOutlineKeyPoints(chapterInfo.description)
84:     const planSections = state.chapterPlan?.sections ?? []
85: 
86:     const remainingChapters = state.totalChapters - chapterIndex - 1
87:     const closingReminder = remainingChapters === 0
88:       ? `【完结期提示】这是最后一章，必须完成以下任务：
89: - 回收所有主要伏笔，不得遗留未解决的悬念
90: - 给出明确的结局（人物命运、冲突结果、世界状态）
91: - 避免仓促收尾，给读者完整的收束感`
92:       : remainingChapters === 1
93:         ? `【冲突期提示】还有最后一章就完结了，本章必须：
94: - 推进最终对决/高潮冲突到临界点
95: - 回收至少 60% 的主要伏笔
96: - 为结局做好所有铺垫，不要在最后一章引入新线索`
97:         : remainingChapters <= 3
98:           ? `【铺垫期提示】还有 ${remainingChapters + 1} 章完结，请注意：
99: - 开始加速主线节奏，减少无关支线
100: - 为主要冲突的最终爆发积蓄张力
101: - 有选择地回收部分伏笔，保留核心悬念到结局`
102:           : ''
103: 
104:     const userContent = `请撰写第 ${displayChapterNumber} 章的正文内容。
105: 
106: 【重要】本章主角姓名是"${mainCharacterName}"，主角的姓名在整章中必须保持一致，不得擅自更改为主角起其他名字！
107: 
108: 【必须严格遵循】本章大纲：
109: 标题：${chapterInfo.title}
110: 核心事件：${chapterInfo.description}
111: 
112: 【重要】大纲中的每个情节点都必须完整呈现！如果大纲中提到"与此同时"、"另外"、"并且"等连接的多个事件，必须在章节中呈现所有事件，不可遗漏任何情节点！
113: 
114: 【必须严格遵循】世界观设定：
115: ${state.world || '（尚未构建）'}
116: 
117: 【必须严格遵循】人物设定：
118: ${state.characters || '（尚未创建）'}
119: 
120: 前几章摘要：
121: ${previousSummary}
122: 
123: ${chapterSupplement}
124: 
125: ${timelineSection}
126: 
127: ${keyEventsSection}
128: 
129: ${planSection}
130: 
131: ${issuesSection}
132: 
133: ${foreshadowSection}
134: 
135: ${closingReminder ? closingReminder + '\n\n' : ''}${existingChapterSection}
136: 
137: 【输出格式要求 - 必须严格遵守】
138: 你的输出必须分为两个部分，用以下标记分隔：
139: 
140: === PRE_WRITE_CHECK ===
141: （预写对齐检查表，见下方说明）
142: 
143: === CHAPTER_CONTENT ===
144: （正文内容，从这里开始写小说正文）
145: 
146: 【第一部分：PRE_WRITE_CHECK - 写正文前必须先完成】
147: 在写正文之前，请先输出预写对齐检查表，逐条确认本章如何落实大纲要求。
148: 
149: 必须包含以下检查项（以 Markdown 表格形式输出）：
150: 
151: | 检查项 | 来源 | 具体要求 | 本章执行计划 | 对应段落 |
152: |--------|------|----------|-------------|----------|
153: ${outlineKeyPoints.map((point, i) => `| 大纲情节点${i + 1} | 大纲 | ${point} | （请填写：本章如何呈现该情节点） | （请填写：第几段） |`).join('\n')}
154: ${planSections.map((section, i) => `| 规划段落${i + 1} | 章节规划 | ${section.title}: ${section.summary} | （请填写：如何展开） | 第${i + 1}段 |`).join('\n')}
155: | 关键台词 | 大纲 | （如有大纲要求的台词，请列出） | （请填写：由谁说、在什么场景说） | （请填写） |
156: | 时间线 | 大纲/规划 | （如有时间要求，请列出） | （请填写：时间如何推进） | （请填写） |
157: | 人物出场 | 大纲/规划 | （列出必须出场的人物） | （请填写：各自承担什么功能） | （请填写） |
158: 
159: 在表格之后，必须输出以下自检清单：
160: - [ ] 大纲中的每个情节点都已在本章找到对应呈现方式
161: - [ ] 章节规划中的每个段落都有明确的展开计划
162: - [ ] 关键台词已标注说话人和场景
163: - [ ] 时间线跨度符合大纲要求
164: - [ ] 没有遗漏任何大纲要求
165: - [ ] 没有发现与大纲矛盾的执行计划
166: 
167: 【重要】PRE_WRITE_CHECK 完成后，才能开始写正文。PRE_WRITE_CHECK 中的计划必须与正文完全一致，正文必须严格遵循 PRE_WRITE_CHECK 中确认的执行计划。
168: 
169: 【第二部分：CHAPTER_CONTENT - 正文写作要求】
170: 0. 【必须】正文开头必须包含章节标题，格式为：
171:    # 第X章 章节标题
172:    或
173:    ## 第X章：章节标题
174:    标题必须与大纲中的章节标题一致，不得省略。
175: 1. 【必须】严格按照大纲的每一个情节点展开剧情，大纲中提到的所有事件都必须完整呈现
176: 2. 【必须】主角姓名必须保持为"${mainCharacterName}"，不得擅自为主角起其他名字
177: 3. 【必须】物品名称、功法名称等必须与大纲完全一致
178: 4. 【必须】时间线必须清晰连贯：
179:    - 时间跨度必须符合大纲要求（如"高烧持续三日"必须描写三日，不能只写一夜）
180:    - 时间跳跃必须明确标注（如"三日后""次日清晨""又过了两天"）
181:    - 不能出现时间回退或逻辑矛盾（如先写"烧退了"，后又写"仍在发烧"）
182: 5. 【必须】关键台词必须原样出现：
183:    - 大纲中明确要求的台词（如"你终于来了"）必须一字不差地出现
184:    - 不能擅自改写为意思相近但措辞不同的句子
185: 6. 【必须】叙述视角保持一致（第三人称限制性视角），避免出现视角跳跃
186: 7. 【必须】因果关系明确：前一事件的结果必须自然导致后一事件，不能生硬跳转
187: 8. 【必须】信息一致性：本章内所有描述必须自洽，不能前后矛盾
188: 9. 【必须】禁止 AI 惯用腔调，具体包括：
189:    - 禁止总结性开头：不得以"值得一提的是"、"不难发现"、"众所周知"、"值得注意的是"等句式开头段落
190:    - 禁止机械过渡：不得使用"让我们回到"、"接下来"、"与此同时"等说教性过渡
191:    - 禁止抽象概括：不得用"这个故事告诉我们"、"从这件事可以看出"等作者跳出来总结的句式
192:    - 必须用具体的人物动作、感官细节或场景变化来推动叙事，替代抽象的概括和评价
193: 10. 注重人物对话和心理描写
194: 11. 适时埋下伏笔，为后续章节留下悬念
195: 12. 每章字数建议 2000-5000 字
196: 13. 以自然流畅的段落叙述为主
197: 
198: 请严格按照上述格式输出：先输出 === PRE_WRITE_CHECK === 部分，再输出 === CHAPTER_CONTENT === 部分。`
199: 
200:     return [
201:       this.systemMessage('你是一位专业的小说作家，擅长细腻的描写、丰富的人物刻画和扣人心弦的情节推进。在动笔前，你必须先完成预写对齐检查，确认每个大纲要求都有明确的执行计划，然后严格按照该计划撰写正文。'),
202:       this.userMessage(userContent),
203:     ]
204:   }
205: 
206:   private extractOutlineKeyPoints(description: string): string[] {
207:     if (!description || description.trim().length === 0) {
208:       return ['（大纲未提供具体情节点）']
209:     }
210:     const sentences = description
211:       .split(/[。；!！?？]|\n/)
212:       .map(s => s.trim())
213:       .filter(s => s.length > 0)
214:     if (sentences.length === 0) {
215:       return [description.trim()]
216:     }
217:     return sentences
218:   }
219: 
220:   private extractChapterOutline(outline: string, chapterIndex: number): { title: string; description: string } {
221:     const lines = outline.split('\n').filter(l => l.trim())
222:     const chapterPatterns = [
223:       new RegExp(`第\\s*${chapterIndex}\\s*章?[:：]?\\s*(.+)`),
224:       new RegExp(`第\\s*${chapterIndex}\\s*节?[:：]?\\s*(.+)`),
225:       new RegExp(`chapter\\s*${chapterIndex}[:：]?\\s*(.+)`),
226:     ]
227: 
228:     for (const pattern of chapterPatterns) {
229:       const match = outline.match(pattern)
230:       if (match && match[1]) {
231:         return { title: match[1].trim(), description: '' }
232:       }
233:     }
234: 
235:     const chapterBlocks = outline.split(/(?=第\s*\d+\s*[章节])/i)
236:     for (const block of chapterBlocks) {
237:       const numMatch = block.match(/第\s*(\d+)\s*[章节]/)
238:       if (numMatch && numMatch[1] && parseInt(numMatch[1]) === chapterIndex) {
239:         const blockLines = block.split('\n').filter(l => l.trim())
240:         const firstLine = blockLines[0]
241:         const title = firstLine ? firstLine.replace(/^第\s*\d+\s*[章节][:：]?\s*/, '').trim() : `第${chapterIndex}章`
242:         const description = blockLines.slice(1).join('\n').trim()
243:         return { title, description }
244:       }
245:     }
246: 
247:     return { title: `第${chapterIndex}章`, description: outline.substring(0, 200) }
248:   }
249: 
250:   protected parse(content: string): AgentOutput {
251:     const preWriteMatch = content.match(/===\s*PRE_WRITE_CHECK\s*===([\s\S]*?)(?:===\s*CHAPTER_CONTENT\s*===|$)/i)
252:     const preWriteCheck = preWriteMatch && preWriteMatch[1] ? preWriteMatch[1].trim() : ''
253: 
254:     const contentMatch = content.match(/===\s*CHAPTER_CONTENT\s*===([\s\S]*)/i)
255:     let chapterContent: string
256:     if (contentMatch && contentMatch[1]) {
257:       chapterContent = contentMatch[1].trim()
258:     } else {
259:       chapterContent = content.replace(/===\s*PRE_WRITE_CHECK\s*===[\s\S]*?(?:===\s*CHAPTER_CONTENT\s*===|$)/i, '').trim()
260:       if (!chapterContent) {
261:         chapterContent = content.trim()
262:       }
263:     }
264: 
265:     const chapterHeadingPattern = /^(#{1,2}\s+第\s*\d+\s*章[\s:：]|#{1,2}\s+第\s*\d+\s*部分[\s:：]|#{1,2}\s+\d+[\.、]\s+|#{1,2}\s+章节?\s*\d+)/m
266:     const headingMatch = chapterContent.match(chapterHeadingPattern)
267:     if (headingMatch && headingMatch.index !== undefined && headingMatch.index > 0) {
268:       const detectedPreWrite = chapterContent.slice(0, headingMatch.index).trim()
269:       chapterContent = chapterContent.slice(headingMatch.index).trim()
270:       if (detectedPreWrite && !preWriteCheck) {
271:         return {
272:           success: true,
273:           content: chapterContent,
274:           data: { preWriteCheck: detectedPreWrite },
275:         }
276:       }
277:     }
278: 
279:     const cleaned = chapterContent.replace(/<!--[\s\S]*?-->/g, '').trim()
280: 
281:     return {
282:       success: true,
283:       content: cleaned || chapterContent || content,
284:       data: { preWriteCheck: preWriteCheck || undefined },
285:     }
286:   }
287: 
288:   processOutput(output: AgentOutput, storyId: string, chapterIndex: number): ChapterMeta {
289:     const now = Date.now()
290:     return {
291:       id: generateId(),
292:       storyId,
293:       number: chapterIndex,
294:       title: null,
295:       outline: null,
296:       summary: null,
297:       foreshadows: null,
298:       status: 'drafting',
299:       createdAt: now,
300:       updatedAt: now,
301:     }
302:   }
303: 
304:   extractTitle(content: string): string | null {
305:     const lines = content.split('\n').filter(l => l.trim())
306:     if (lines.length === 0) return null
307:     const firstLine = lines[0]
308:     if (firstLine && firstLine.length > 3 && firstLine.length < 50) {
309:       return firstLine.trim()
310:     }
311:     return null
312:   }
313: 
314:   extractSummary(content: string): string {
315:     const paragraphs = content.split(/\n\n+/).filter(p => p.trim().length > 50)
316:     if (paragraphs.length <= 3) {
317:       return content.substring(0, 200)
318:     }
319:     const middle = paragraphs.slice(1, -1)
320:     return middle.join(' ').substring(0, 300) + '...'
321:   }
322: 
323:   extractForeshadows(content: string, chapterIndex: number): ForeshadowItem[] {
324:     const foreshadowPatterns = [
325:       /(?:注意到?|发现|觉察到?|预感到?|感觉到?)(.+)（为(.+)埋下伏笔）/gi,
326:       /(.+)似乎暗示着(.+)/gi,
327:       /(?:他|她|它|他们)(?:似乎?|仿佛)?(.+)（这为(.+)留下了悬念）/gi,
328:     ]
329: 
330:     const foreshadows: ForeshadowItem[] = []
331:     const seen = new Set<string>()
332: 
333:     for (const pattern of foreshadowPatterns) {
334:       let match
335:       while ((match = pattern.exec(content)) !== null) {
336:         const text = match[1]?.trim() || match[0]
337:         const futureChapter = match[3] ? parseInt(match[3]) : chapterIndex + 5
338:         if (!seen.has(text) && text.length > 5) {
339:           seen.add(text)
340:           foreshadows.push({
341:             id: generateId(),
342:             text,
343:             expectedFulfillChapter: Math.min(futureChapter, chapterIndex + 10),
344:             createdAt: Date.now(),
345:             createdAtChapter: chapterIndex + 1,
346:           })
347:         }
348:       }
349:     }
350: 
351:     return foreshadows.slice(0, 5)
352:   }
353: }

(End of file - total 353 lines)
</content>
```

**Tool: read**

**Input:**
```json
{
  "filePath": "/Users/bytedance/workspace/museflow/src/agents/chapter-planner.ts"
}
```

**Output:**
```
<path>/Users/bytedance/workspace/museflow/src/agents/chapter-planner.ts</path>
<type>file</type>
<content>
1: import { BaseAgent, type AgentState, type AgentOutput } from './base.js'
2: import { toDisplayChapterNumber } from '../utils/chapter-display.js'
3: 
4: export interface ChapterPlan {
5:   sections: Array<{
6:     title: string
7:     summary: string
8:     wordCount: number
9:     events: string[]
10:     characters: string[]
11:     timeMark?: string
12:   }>
13:   timeline: Array<{
14:     event: string
15:     time: string
16:     notes: string
17:   }>
18:   outlineCheck: Array<{
19:     requirement: string
20:     fulfilled: boolean
21:     section: string
22:   }>
23: }
24: 
25: export class ChapterPlannerAgent extends BaseAgent {
26:   constructor() {
27:     super(undefined, 0.3)
28:   }
29: 
30:   protected buildPrompt(state: Required<AgentState>): import('../model/provider.js').Message[] {
31:     const chapterIndex = state.chapterIndex ?? 0
32:     const displayChapterNumber = toDisplayChapterNumber(chapterIndex)
33:     const outline = state.outline || ''
34: 
35:     const previousSummary = state.previousChapters || '（这是第一章）'
36: 
37:     const userContent = `请为第 ${displayChapterNumber} 章生成详细的写作规划。
38: 
39: 【必须严格遵循】本章大纲：
40: ${outline}
41: 
42: 【必须严格遵循】世界观设定：
43: ${state.world || '（尚未构建）'}
44: 
45: 【必须严格遵循】人物设定：
46: ${state.characters || '（尚未创建）'}
47: 
48: 前几章摘要：
49: ${previousSummary}
50: 
51: 【规划要求】
52: 1. 将本章拆分为 3-6 个段落/场景
53: 2. 对每个段落，明确：
54:    - 段落标题（简短）
55:    - 内容摘要（1-2句话）
56:    - 预计字数
57:    - 涉及的事件（必须对应大纲中的情节点）
58:    - 出场人物
59:    - 时间标记（如"当天夜晚""三日后""凌晨寅时"等，必须明确）
60: 3. 列出完整的时间线，确保：
61:    - 时间顺序正确，不能出现时间回退或跳跃未交代的情况
62:    - 每个关键事件都有明确的时间标记
63:    - 时间间隔符合大纲要求（如"高烧持续三日"必须真的跨越三日）
64: 4. 逐条检查大纲要求，确保：
65:    - 大纲中的每个情节点都出现在规划中
66:    - 大纲中提到的所有事件都有对应的段落
67:    - 大纲中提到的关键台词必须原样保留
68:    - 大纲中的时间要求（如"三日后""次日"）必须在时间线中体现
69: 5. 【重要】检查前面章节中是否有遗留的未解决状态：
70:    - 扫描前面章节摘要，识别哪些角色处于特殊状态（被囚禁、失忆、失踪、受伤等）
71:    - 如果本章大纲涉及这些状态的改变，请确保在规划中包含"衔接段落"
72:    - 衔接段落位置：放在本章最前面或相关情节之前
73:    - 衔接段落内容：通过角色对话、简短回忆或旁白，解释关键状态的变化过程
74:    - 示例：某角色被囚禁多章后在本章出现 → 增加一段回忆说明营救过程
75: 
76: 【输出格式】
77: 请输出 JSON 格式：
78: {
79:   "sections": [
80:     {
81:       "title": "段落标题",
82:       "summary": "内容摘要",
83:       "wordCount": 预计字数,
84:       "events": ["涉及事件1", "涉及事件2"],
85:       "characters": ["人物1", "人物2"],
86:       "timeMark": "时间标记"
87:     }
88:   ],
89:   "timeline": [
90:     {
91:       "event": "事件描述",
92:       "time": "具体时间",
93:       "notes": "注意事项"
94:     }
95:   ],
96:   "outlineCheck": [
97:     {
98:       "requirement": "大纲要求的具体内容",
99:       "fulfilled": true或false,
100:       "section": "对应段落标题"
101:     }
102:   ]
103: }
104: 
105: 【重要】
106: - 如果大纲要求"高烧持续三日后才退"，时间线必须显示三日，不能只写"过了一夜"
107: - 如果大纲要求某人说特定台词，规划中必须标注该台词原样出现
108: - 如果大纲要求"次日"发生某事，时间线必须显示"第一日→第二日"的过渡
109: - 所有大纲情节点必须在 outlineCheck 中标记为 fulfilled: true`
110: 
111:     return [
112:       this.systemMessage('你是一位严谨的小说结构规划师。你的任务是在写作前生成详细的章节规划，确保每个大纲要求都被精确落实。你对时间线和情节顺序的准确性有零容忍态度。'),
113:       this.userMessage(userContent),
114:     ]
115:   }
116: 
117:   protected parse(content: string): AgentOutput {
118:     const trimmed = content.trim()
119:     const jsonMatch = trimmed.match(/\{[\s\S]*\}/)
120:     if (!jsonMatch) {
121:       return { success: false, error: '无法解析规划数据：未找到 JSON 格式' }
122:     }
123:     try {
124:       const data = JSON.parse(jsonMatch[0]) as ChapterPlan
125:       if (!data.sections || !Array.isArray(data.sections)) {
126:         return { success: false, error: '规划数据缺少 sections 字段' }
127:       }
128:       if (!data.timeline || !Array.isArray(data.timeline)) {
129:         return { success: false, error: '规划数据缺少 timeline 字段' }
130:       }
131:       if (!data.outlineCheck || !Array.isArray(data.outlineCheck)) {
132:         return { success: false, error: '规划数据缺少 outlineCheck 字段' }
133:       }
134:       const unfulfilled = data.outlineCheck.filter(c => !c.fulfilled)
135:       if (unfulfilled.length > 0) {
136:         return {
137:           success: false,
138:           error: `大纲检查未通过，以下要求未落实：${unfulfilled.map(u => u.requirement).join('、')}`,
139:         }
140:       }
141:       return { success: true, data }
142:     } catch {
143:       return { success: false, error: '无法解析规划数据：JSON 格式错误' }
144:     }
145:   }
146: }

(End of file - total 146 lines)
</content>
```

---

## Assistant (​Sisyphus - Ultraworker · Kimi K2.6 · 115.5s)

_Thinking:_

现在我已经理解了代码的关键部分。让我分析一下第一次 write 和第二次 write 同一章时 prompt 是否完全一样。

首先，我需要理解流程：

1. `write` 命令调用 `continueStory`
2. `continueStory` 从 graph.getState(config) 获取 checkpoint state
3. 然后构建 workingState，包含 `chapterSummaries`, `chapters`, `currentChapterIndex`, `foreshadowStack` 等
4. 然后调用 `plan_chapter` 和 `draft_chapter`

关键区别在于：
- 第一次 write 某一章时，这章还没有被写过，state.chapters[chapterIndex] 可能是 null
- 第二次 write 同一章时（通过 rewrite 或 fix 后重新 write），这章可能已经被写过了

但用户问的是"第一次 write 与第二次 write 同一章"——这里的关键是：
- 第一次 write：全新撰写，没有现有内容
- 第二次 write：这章已经存在，但可能是在 checkpoint 恢复后重新 write

让我仔细看看 `continueStory` 的逻辑：

```typescript
const targetIndex = currentChapterIndex ?? checkpointState.currentChapterIndex

const rewrittenChapters = new Array(checkpointState.totalChapters).fill(null) as ReducedGraphState['chapters']
for (let i = 0; i < targetIndex; i++) {
  rewrittenChapters[i] = checkpointState.chapters[i] ?? null
}

let workingState: ReducedGraphState = {
  ...checkpointState,
  currentChapterIndex: targetIndex,
  chapters: rewrittenChapters,
  pendingIssues: checkpointState.pendingIssues,
  rewriteApproved: userResponse ?? false,
  rewriteRequested: false,
  isWriting: true,
  writeOneChapterOnly: true,
}
```

注意：
1. `rewrittenChapters` 只保留了 targetIndex 之前的章节，当前章节（targetIndex）被设为 null
2. 但 `checkpointState.chapterSummaries` 保留了下来
3. `checkpointState.foreshadowStack` 也保留了下来
4. `pendingIssues` 也保留了（从 checkpoint）

在 `plan_chapter` 中：
```typescript
const previousChapters = buildLayeredSummaries(state.chapterSummaries, chapterIndex)
const timelineSnapshot = buildCharacterFactTimeline(state, chapterIndex)

const agentState: AgentState = {
  idea: state.idea,
  genre: state.genre,
  totalChapters: state.totalChapters,
  ...(worldContent ? { world: worldContent } : {}),
  characters: charactersToString(state.characters),
  outline: outlineItem ? `第${toDisplayChapterNumber(chapterIndex)}章：${outlineItem.title}\n${outlineItem.description}` : state.outline.map((o, i) => `第${toDisplayChapterNumber(i)}章：${o.title}`).join('\n'),
  previousChapters,
  chapterIndex,
  chapterSummaries: state.chapterSummaries,
  timelineSnapshot,
  foreshadowStack: state.foreshadowStack,
}
```

在 `draft_chapter` 中：
```typescript
const previousChapters = buildLayeredSummaries(state.chapterSummaries, chapterIndex)
const timelineSnapshot = buildCharacterFactTimeline(state, chapterIndex)
const keyEventsTimeline = buildKeyEventsTimeline(state, chapterIndex)

const existingContent = state.rewriteApproved
  ? await readChapterContent(state.story.outputDir, chapterIndex + 1)
  : null

const agentState: AgentState = {
  idea: state.idea,
  genre: state.genre,
  totalChapters: state.totalChapters,
  ...(worldContent ? { world: worldContent } : {}),
  characters: charactersToString(state.characters),
  outline: outlineItem ? `第${toDisplayChapterNumber(chapterIndex)}章：${outlineItem.title}\n${outlineItem.description}` : state.outline.map((o, i) => `第${toDisplayChapterNumber(i)}章：${o.title}`).join('\n'),
  previousChapters,
  chapterIndex,
  chapterSummaries: state.chapterSummaries,
  timelineSnapshot,
  keyEventsTimeline,
  foreshadowStack: state.foreshadowStack,
  ...(state.rewriteApproved ? { issues: state.pendingIssues } : {}),
  ...(existingContent ? { chapterContent: existingContent } : {}),
  ...(state.chapterPlan ? { chapterPlan: state.chapterPlan } : {}),
}
```

所以关键差异在于：

**第一次 write（全新撰写）：**
- `rewriteApproved` 是 false（用户没有要求重写）
- `existingContent` 为 null
- `issues` 不会传入（因为 `rewriteApproved` 为 false）
- `chapterContent` 不会传入
- `chapterPlan` 可能是 null（第一次规划）

**第二次 write 同一章（通过 rewrite 命令）：**
- 用户运行 `museflow rewrite <story-id>`，这会调用 `continueStory` 并设置 `rewriteApproved: true`
- `existingContent` 会读取已写好的章节内容
- `issues` 会传入（如果有 pending issues）
- `chapterContent` 会传入现有内容
- `chapterPlan` 可能会被重置为 null（在 runner.ts 中，如果是结构性问题，会设置 `chapterPlan: null`）

但等一下，用户问的是"第一次 write 与第二次 write 同一章"——这个场景是什么？

在 MuseFlow 的工作流中：
1. `museflow write <id>` 写第 1 章
2. 如果质量检查发现问题，提示用户运行 `fix` 或 `rewrite`
3. 如果用户运行 `museflow rewrite <id>`，这会重新写同一章

但也可以这样理解：
1. 第一次 `museflow write <id>` —— 写第 N 章
2. 第二次 `museflow write <id>` —— 如果第 N 章有问题，状态会阻塞，无法继续写第 N+1 章。但如果第 N 章通过了，第二次 write 会写第 N+1 章。

所以"第二次 write 同一章"的场景，应该是指通过 `rewrite` 命令重新写同一章。

但还有一种可能：用户说的是在 continueStory 的循环中，第一次尝试写这章（draft_chapter）失败了，然后第二次尝试（rewrite loop）重新写这章。

让我再看看 `continueStory` 的循环逻辑：

```typescript
while (rewriteAttempts < MAX_REWRITE_ATTEMPTS) {
  // ...
  if (workingState.rewriteApproved && hasStructuralIssues && !hasLocalIssues) {
    // 结构性问题：重置 chapterPlan，重新 plan + draft
    workingState = { ...workingState, chapterPlan: null, pendingIssues: errorIssues }
    const planResult = await plan_chapter(workingState)
    workingState = { ...workingState, ...planResult }
    const draftResult = await draft_chapter(workingState)
    workingState = { ...workingState, ...draftResult }
    workingState = { ...workingState, pendingIssues: [] }
  } else if (workingState.rewriteApproved && hasLocalIssues && !hasStructuralIssues) {
    // 局部问题：fix_chapter
    // ...
  } else {
    if (workingState.rewriteApproved) {
      // 同时有结构性和局部问题
      workingState = { ...workingState, chapterPlan: null, pendingIssues: errorIssues }
      const planResult = await plan_chapter(workingState)
      workingState = { ...workingState, ...planResult }
    } else {
      // 第一次写：正常 plan + draft
      workingState = { ...workingState, pendingIssues: [] }
      const planResult = await plan_chapter(workingState)
      workingState = { ...workingState, ...planResult }
    }
    const draftResult = await draft_chapter(workingState)
    workingState = { ...workingState, ...draftResult }
    workingState = { ...workingState, pendingIssues: [] }
  }
  
  // 检查...
}
```

所以"第一次 write"和"第二次 write"同一章，可能有几种情况：

1. **continueStory 循环内的第一次和第二次尝试**：
   - 第一次：rewriteApproved = false，pendingIssues = []，chapterPlan = null
   - 第二次（如果有问题）：rewriteApproved = true，pendingIssues 包含 error issues，chapterPlan 可能被重置为 null
   - draft_chapter 中：existingContent = state.rewriteApproved ? readChapterContent(...) : null

2. **用户分别运行 `write` 和 `rewrite` 命令**：
   - `write` 命令调用 continueStory，userResponse = undefined，所以 rewriteApproved = false
   - `rewrite` 命令调用 continueStory，userResponse = true，所以 rewriteApproved = true

但问题更具体的问的是 "prompt 参数"——即传给 LLM 的 prompt 是否完全一样。

从代码来看，prompt 的构建取决于 `AgentState` 的内容。让我总结一下差异：

**plan_chapter 的 prompt 差异：**
- `previousChapters`: 由 `buildLayeredSummaries(state.chapterSummaries, chapterIndex)` 构建
- `timelineSnapshot`: 由 `buildCharacterFactTimeline(state, chapterIndex)` 构建
- `foreshadowStack`: 来自 state

如果第一次 write 和第二次 write 是同一章，且中间没有写其他章：
- `chapterSummaries` 可能没有变化（因为这一章还没完成，没有生成 summary）
- `foreshadowStack` 可能有变化（如果第一次 write 时检测到了新的伏笔）

但如果第二次 write 时，已经通过了检查并生成了 summary，那么：
- `chapterSummaries` 会增加本章的 summary（如果 finalize_chapter 被调用的话）

等一下，让我看看 finalize_chapter 什么时候被调用。在 continueStory 中，finalize_chapter 在循环结束后调用，但只有在没有剩余错误时才调用。如果第一次 write 有错误，就不会调用 finalize，chapterSummaries 不会更新。

所以，如果第一次 write 失败了（有 pending issues），第二次 write（rewrite loop 内）的 prompt 会有这些差异：
1. `pendingIssues` 不同（第一次是空，第二次有 issues）
2. `rewriteApproved` 不同（false vs true）
3. `chapterPlan` 可能被重置

在 draft_chapter 中，关键差异：
- `existingContent`: 第一次 null，第二次读取已有内容
- `issues`: 第一次不传入，第二次传入
- `chapterPlan`: 第一次是新生成的，第二次可能被重置后重新生成

但有一个重要的点：在 `continueStory` 中，每次循环结束后，如果还有错误，会更新 workingState：
```typescript
workingState.rewriteApproved = true
```

在下一次循环开始时：
- `workingState.chapters` 中当前章节已经有内容了（上一次 draft_chapter 写入了）
- `workingState.chapterSummaries` 保持不变（因为 finalize 没运行）
- `workingState.foreshadowStack` 可能已经更新了（如果 detect_foreshadowing 运行了）

等等，让我再看看循环中的检查节点。在第一次 write 的循环中，会运行：
1. validate_chapter
2. quality_pass
3. detect_foreshadowing
4. detect_hallucination
5. detect_consistency
6. verify_outline_compliance
7. auto_fix_warnings

如果在这些检查中发现了问题，workingState.pendingIssues 会被更新。但 workingState 的其他字段也会被这些节点更新吗？

看代码：
```typescript
const partial = await node(workingState)
workingState = {
  ...workingState,
  ...partial,
}
```

所以检查节点可能会返回部分状态更新。例如：
- `detect_foreshadowing` 返回 `{ foreshadowStack }`
- `detect_consistency` 返回 `{ pendingIssues: [...] }`
- `verify_outline_compliance` 返回 `{ pendingIssues: [...], rewriteApproved: true }`

这意味着第二次 write 时：
- `foreshadowStack` 可能已经更新了（来自第一次 write 的 detect_foreshadowing）
- `pendingIssues` 包含了第一次 write 发现的问题
- `rewriteApproved` 可能已经被设为 true

但 `chapterSummaries` 在循环中没有变化（只有 finalize_chapter 会添加 summary）。

所以总结差异：

**plan_chapter prompt 的差异：**
1. `foreshadowStack`：可能不同（如果第一次检测到了新伏笔）
2. `chapterSummaries`：相同（本章未完成，没有新 summary）
3. `previousChapters`：相同（基于 chapterSummaries）
4. `timelineSnapshot`：相同（基于 chapterSummaries）

**draft_chapter prompt 的差异：**
1. `existingContent`：第一次 null，第二次有内容
2. `issues`：第一次无，第二次有
3. `chapterPlan`：第一次新生成，第二次可能被重置后重新生成
4. `foreshadowStack`：可能不同
5. `keyEventsTimeline`：相同

所以答案是：**不，prompt 参数不完全一样。**

关键差异：
1. **第二次 write 时已有 `chapterContent`**（现有章节内容），会传入 prompt 要求"在原文基础上修改"
2. **第二次 write 时可能有 `issues`**（待修复问题），会传入 prompt 要求修复
3. **`foreshadowStack` 可能变化**（如果第一次写时 detect_foreshadowing 检测到了新伏笔）
4. **`chapterPlan` 可能被重置**（如果是结构性问题）

但还有一个更基本的场景：用户可能只是问，如果完全相同的命令运行两次（比如运行两次 `museflow write`），prompt 是否相同。

在这种场景下：
- 第一次 `write`：写第 N 章，成功通过检查，finalize_chapter 被调用，chapterSummaries 被更新
- 第二次 `write`：从 checkpoint 恢复，currentChapterIndex 已经是 N+1 了，所以写第 N+1 章，不是同一章

除非第一次写失败了，状态停留在第 N 章。此时第二次 `write` 会再次尝试写第 N 章。

在这种情况下：
- 第一次：全新写，rewriteApproved=false，pendingIssues=[]
- 第二次：再次写，从 checkpoint 恢复，状态包含第一次写时的 pendingIssues，rewriteApproved 可能是 true（如果 verify_outline_compliance 设置了）

所以即使在这个场景下，prompt 也不完全一样。

现在让我给出精确的回答。

**不完全一样。** 第二次 write 同一章时，prompt 会包含第一次 write 遗留的状态信息，主要差异有三点：

1. **已有章节内容（`chapterContent`）**  
   第一次 write 时 `existingContent` 为 `null`，prompt 要求全新撰写；第二次 write 时（如通过 `rewrite` 命令）会读取磁盘上已写好的章节内容传入 prompt，要求"在原文基础上修改，保留好的部分，修正问题"。

2. **待修复问题（`issues`）**  
   第一次 write 不会传入 `issues`；第二次 write 时，会将上一轮质量检查、幻觉检测、一致性检查等发现的 `pendingIssues` 传入 prompt，明确要求按问题描述修复。

3. **伏笔栈（`foreshadowStack`）可能变化**  
   第一轮 write 流程中会运行 `detect_foreshadowing` 节点，如果检测到了本章新埋下的伏笔，这些伏笔会被追加到 `foreshadowStack` 中。第二轮 write 时这些新伏笔会出现在 prompt 的"伏笔回收提醒"区域。

此外，`chapterPlan` 在结构性问题场景下会被重置为 `null`，第二轮会重新生成规划。只有在极少数理想情况下（第一轮没有任何问题、没有检测到新伏笔、且不是 rewrite 模式），两轮 prompt 才会接近相同——但 MuseFlow 的设计就是在发现问题后才触发 rewrite，所以实际上两次 write 同一章的 prompt **必然存在差异**。

---

## User

你说的第二次 write 实质上就是 rewrite 吧？

---

## Assistant (​Sisyphus - Ultraworker · Kimi K2.6 · 81.8s)

_Thinking:_

用户指出了我回答中的一个问题。让我重新审视这个问题。

用户问的是"第一次 write 与第二次 write 同一章"，而我之前的回答把第二次 write 等同于 rewrite 了。

让我重新理解这个问题：
1. 用户运行 `museflow write <story-id>` 写第 N 章
2. 如果第 N 章写成功了（通过了所有检查），状态会推进到第 N+1 章
3. 用户再次运行 `museflow write <story-id>`，这时会写第 N+1 章，而不是第 N 章

所以如果两次 `write` 都写"同一章"，这意味着：
- 第一次 `write` 写第 N 章，但失败了（有 pending issues），状态停留在第 N 章
- 第二次 `write` 再次尝试写第 N 章

在这种情况下，第二次 `write` 不是 `rewrite` 命令，而是再次执行 `write` 命令。

让我重新看看代码流程：

`write` 命令调用 `continueStory(storyId, undefined, chapterIndex)`，其中：
- `userResponse = undefined`
- `currentChapterIndex` 是从磁盘和状态计算出来的

在 `continueStory` 中：
```typescript
let workingState: ReducedGraphState = {
  ...checkpointState,
  currentChapterIndex: targetIndex,
  chapters: rewrittenChapters,
  pendingIssues: checkpointState.pendingIssues,
  rewriteApproved: userResponse ?? false,  // false，因为 userResponse 是 undefined
  rewriteRequested: false,
  isWriting: true,
  writeOneChapterOnly: true,
}
```

所以如果第一次 write 失败了，checkpoint 中保存了 `pendingIssues`。第二次 write 时：
- `rewriteApproved` = false
- `pendingIssues` = checkpointState.pendingIssues（来自第一次 write）

但是在 `handleWrite` 中：
```typescript
const unresolvedErrors = state.pendingIssues.filter(i => i.severity === 'error')
if (state.rewriteRequested || unresolvedErrors.length > 0) {
  console.error('[MuseFlow] 当前章节存在问题，需要先修复')
  // ... 提示用户运行 fix 或 rewrite
  process.exit(1)
}
```

所以如果第一次 write 有未解决的 errors，第二次直接运行 `write` 命令会被拒绝，要求先运行 `fix` 或 `rewrite`。

这意味着：**正常情况下，两次 `write` 命令不会写同一章。** 如果第一次失败了，第二次 `write` 会直接报错退出。

所以用户说的"第二次 write 同一章"实际上只能发生在以下场景：
1. 第一次 write 没有 errors 但有 warnings（因为 auto_fix_warnings 不对 warnings 做任何处理，warnings 会被保留在 pendingIssues 中）
2. 或者用户在第一次 write 失败后，没有运行 `fix`/`rewrite`，而是某种方式绕过了检查（但代码中 handleWrite 会阻止这种情况）

等等，让我再看看 auto_fix_warnings：
```typescript
export async function auto_fix_warnings(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  const errors = state.pendingIssues.filter(i => i.severity === 'error')
  const warnings = state.pendingIssues.filter(i => i.severity === 'warning')

  if (errors.length > 0) {
    return {}
  }

  if (warnings.length === 0) {
    return {}
  }

  return {}
}
```

auto_fix_warnings 什么都不做（空实现）。所以 warnings 会保留在 pendingIssues 中。

在 handleWrite 中：
```typescript
const unresolvedErrors = state.pendingIssues.filter(i => i.severity === 'error')
if (state.rewriteRequested || unresolvedErrors.length > 0) {
  // ... 报错
}
```

所以只有 errors 会阻止继续 write。warnings 不会阻止。

这意味着：
- 第一次 write：有 warnings 但没有 errors，finalize_chapter 被调用，状态推进到下一章
- 第二次 write：写下一章

所以两次 `write` 命令写同一章的情况非常罕见，除非：
1. 用户通过某种方式修改了状态（比如手动编辑 checkpoint）
2. 或者第一次 write 在 finalize 前 crash 了（异常），导致状态没有推进但章节文件已写入

让我再仔细看看用户的问题："第一次 write 与第二次 write 同一章，prompt 参数是完全一样的吗"

用户可能真正想知道的是：如果我用 `write` 命令写了第 N 章，然后不满意，再次运行 `write` 命令（不是 `rewrite`）写第 N 章，prompt 是否一样？

但从代码逻辑看，正常情况下这是不可能的。让我重新思考...

也许用户想问的是：在 `continueStory` 的 while 循环中，第一次尝试写这章（rewriteAttempts=1）和第二次尝试（rewriteAttempts=2，在发现错误后），prompt 是否一样？

或者用户可能误解了命令的工作方式，以为可以多次运行 `write` 来重写同一章？

我需要澄清这个问题。让我先承认用户的纠正，然后更准确地解释代码行为。

实际上，我重新看代码后，发现用户说得对，我之前的回答确实混淆了概念。

让我重新梳理：

1. **`write` 命令**：调用 `continueStory(storyId, undefined, chapterIndex)`，`rewriteApproved = false`。如果当前章节有未解决的 errors，会在 `handleWrite` 中直接报错退出，不会重新写同一章。

2. **`rewrite` 命令**：调用 `continueStory(storyId, true, chapterIndex)`，`rewriteApproved = true`。这是专门用来重写同一章的命令。

所以正常情况下，两次 `write` 命令不会写同一章。如果写同一章，那第二次必须是 `rewrite`。

但也有一个特殊情况：在 `continueStory` 的循环中，第一次 draft 后有 errors，进入第二次循环（rewriteAttempts=2），此时 `rewriteApproved` 被设为 true。这是在同一个 `write` 命令内部的自动重试，不是用户运行第二次 `write` 命令。

让我诚实地回答用户的纠正，并澄清这一点。

你说得对，我混淆了概念。

准确来说：

**正常情况下，两次 `write` 命令不会写同一章。** `write` 命令在 `handleWrite` 里有这个检查：

```typescript
const unresolvedErrors = state.pendingIssues.filter(i => i.severity === 'error')
if (state.rewriteRequested || unresolvedErrors.length > 0) {
  console.error('[MuseFlow] 当前章节存在问题，需要先修复')
  // 提示运行 museflow fix 或 museflow rewrite
  process.exit(1)
}
```

如果第一次 `write` 写第 N 章时发现了 error，状态会停留在第 N 章且 `rewriteRequested = true`。此时再次运行 `write` 会直接报错退出，根本不会进入撰写流程。所以**两次 `write` 命令写同一章的场景，在当前代码逻辑下几乎不可能发生**。

真正会重新写同一章的是这两种情况：

1. **`rewrite` 命令** —— 这才是专门用来重写同一章的命令，调用 `continueStory(storyId, true)`，`rewriteApproved = true`
2. **`continueStory` 内部的自动重试** —— 第一次 draft 后检查不通过，while 循环进入第二次迭代，`rewriteApproved` 被设为 `true`

你问的"第二次 write"如果指的是第一种情况（用户手动再次运行 `write`），那答案其实是：**代码不会让你写到同一章，会在入口处拦住**。如果指的是 `rewrite` 命令或内部自动重试，那 prompt 确实不同——第二次会带上 `chapterContent`（已有正文）、`issues`（待修复问题）等额外参数。

是我过度解读了你的问题，把 `write` 的第二次执行当成了 `rewrite` 的语义。

---

## User

可我看第一次 write 失败了，再次执行 write 是没有问题的

---

## Assistant (​Sisyphus - Ultraworker · Kimi K2.6 · 34.2s)

_Thinking:_

用户说第一次 write 失败了，再次执行 write 是没有问题的。这意味着我之前的理解有误。让我重新审视代码。

让我重新看 `write` 命令的实现：

```typescript
export async function write(storyId: string, _options: WriteOptions): Promise<void> {
  await initStoryDb()
  const story = getStory(storyId)
  // ...

  const state = await getState(storyId)
  // ...

  const hasChaptersOnDisk = checkExistingChapters(story.outputDir)

  let startChapterIndex = state.currentChapterIndex
  if (hasChaptersOnDisk && state.currentChapterIndex === 0) {
    const chaptersDir = join(story.outputDir, 'chapters')
    const files = readdirSync(chaptersDir).filter(f => f.startsWith('chapter_') && f.endsWith('.md'))
    startChapterIndex = files.length
  }

  const isResume = state.currentChapterIndex > 0 || hasChaptersOnDisk

  // If disk has more chapters than state.currentChapterIndex, use disk count
  if (hasChaptersOnDisk && startChapterIndex < state.currentChapterIndex) {
    startChapterIndex = state.currentChapterIndex
  }
  // ...
}
```

然后 `handleWrite`：
```typescript
const unresolvedErrors = state.pendingIssues.filter(i => i.severity === 'error')
if (state.rewriteRequested || unresolvedErrors.length > 0) {
  console.error('[MuseFlow] 当前章节存在问题，需要先修复')
  // ...
  process.exit(1)
}
```

如果第一次 write 失败了，`state.rewriteRequested` 可能为 true，或者 `unresolvedErrors.length > 0`。在这种情况下，`handleWrite` 确实会报错退出。

但用户说"再次执行 write 是没有问题的"，这意味着：
1. 第一次 write 失败后，state 中的 `rewriteRequested` 和 `pendingIssues` 可能没有正确保存？
2. 或者 `getState` 没有返回这些 pending issues？

让我再仔细看看 `continueStory` 中失败时的状态保存逻辑：

```typescript
const remainingErrors = workingState.pendingIssues.filter(i => i.severity === 'error')
if (remainingErrors.length > 0) {
  workingState = {
    ...workingState,
    rewriteRequested: true,
    rewriteApproved: false,
  }
  await graph.updateState(
    { configurable: { thread_id: storyId, outputDir } },
    {
      rewriteApproved: false,
      rewriteRequested: true,
      pendingIssues: workingState.pendingIssues,
      currentChapterIndex: workingState.currentChapterIndex,
      chapters: workingState.chapters,
      chapterSummaries: workingState.chapterSummaries,
    }
  )
  return workingState
}
```

这里确实保存了 `rewriteRequested: true` 和 `pendingIssues`。

然后在 `getState` 中：
```typescript
export async function getState(storyId: string): Promise<ReducedGraphState | null> {
  const graph = getGraph()
  const outputDir = getOutputDirFromStoryId(storyId)
  // ...
  const state = await graph.getState(config)
  const graphState = state.values as unknown as ReducedGraphState
  // ...
  return graphState
}
```

这应该能获取到保存的状态。

所以理论上，如果第一次 write 失败了，再次运行 write 应该在 `handleWrite` 中被拦住。

但用户说实际上没有拦住。这可能意味着：
1. `graph.updateState` 没有正确保存状态
2. `graph.getState` 没有正确读取状态
3. 或者 `pendingIssues` 被清除了

让我再仔细看看 `handleWrite` 的条件：
```typescript
const unresolvedErrors = state.pendingIssues.filter(i => i.severity === 'error')
if (state.rewriteRequested || unresolvedErrors.length > 0) {
```

等等，`state.rewriteRequested` 和 `unresolvedErrors.length > 0` 是 OR 关系。只要满足一个就会报错。

如果第一次 write 失败了，`rewriteRequested` 被设为 true。再次运行 write，`getState` 应该返回 `rewriteRequested: true`。那应该会被拦住。

除非...`graph.updateState` 保存失败，或者 checkpointer 的实现有问题？

让我看看 checkpointer 的实现。

**Tool: read**

**Input:**
```json
{
  "filePath": "/Users/bytedance/workspace/museflow/src/graph/checkpointer.ts"
}
```

**Output:**
```
<path>/Users/bytedance/workspace/museflow/src/graph/checkpointer.ts</path>
<type>file</type>
<content>
1: import { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint'
2: import type { Checkpoint, CheckpointTuple, CheckpointMetadata, PendingWrite, ChannelVersions } from '@langchain/langgraph-checkpoint'
3: import type { RunnableConfig } from '@langchain/core/runnables'
4: import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs'
5: import { join } from 'node:path'
6: import { logger } from '../utils/logger.js'
7: 
8: interface CheckpointRecord {
9:   checkpointId: string
10:   parentCheckpointId: string | null
11:   checkpoint: Checkpoint
12:   metadata: CheckpointMetadata
13: }
14: 
15: interface PendingWritesRecord {
16:   taskId: string
17:   channel: string
18:   value: unknown
19: }
20: 
21: export class JsonCheckpointer extends BaseCheckpointSaver<string> {
22:   private threadIdToOutputDir: Map<string, string> = new Map()
23:   // Track the last checkpoint ID created, used by saveChapterCheckpoint to find the correct checkpoint
24:   private lastCreatedCheckpointId: string | null = null
25: 
26:   constructor() {
27:     super(undefined)
28:   }
29: 
30:   private getCheckpointDir(outputDir: string): string {
31:     return join(outputDir, 'checkpoints')
32:   }
33: 
34:   private ensureCheckpointDir(outputDir: string): string {
35:     const dir = this.getCheckpointDir(outputDir)
36:     if (!existsSync(dir)) {
37:       mkdirSync(dir, { recursive: true })
38:     }
39:     return dir
40:   }
41: 
42:   private getOutputDir(threadId: string): string | undefined {
43:     return this.threadIdToOutputDir.get(threadId)
44:   }
45: 
46:   private getCheckpointPath(outputDir: string, checkpointId: string): string {
47:     return join(this.getCheckpointDir(outputDir), `${checkpointId}.json`)
48:   }
49: 
50:   private getPendingWritesPath(outputDir: string): string {
51:     return join(this.getCheckpointDir(outputDir), 'pending_writes.json')
52:   }
53: 
54:   private loadCheckpointRecords(outputDir: string): Map<string, CheckpointRecord> {
55:     const dir = this.getCheckpointDir(outputDir)
56:     const records = new Map<string, CheckpointRecord>()
57:     if (!existsSync(dir)) return records
58: 
59:     for (const file of readdirSync(dir)) {
60:       if (!file.endsWith('.json') || file === 'pending_writes.json') continue
61:       try {
62:         const raw = readFileSync(join(dir, file), 'utf-8')
63:         const rec = JSON.parse(raw) as CheckpointRecord
64:         records.set(rec.checkpointId, rec)
65:       } catch {
66:       }
67:     }
68:     return records
69:   }
70: 
71:   private loadPendingWrites(outputDir: string): PendingWritesRecord[] {
72:     const path = this.getPendingWritesPath(outputDir)
73:     if (!existsSync(path)) return []
74:     try {
75:       return JSON.parse(readFileSync(path, 'utf-8')) as PendingWritesRecord[]
76:     } catch {
77:       return []
78:     }
79:   }
80: 
81:   private savePendingWrites(outputDir: string, writes: PendingWritesRecord[]): void {
82:     const dir = this.ensureCheckpointDir(outputDir)
83:     const path = join(dir, 'pending_writes.json')
84:     writeFileSync(path, JSON.stringify(writes, null, 2), 'utf-8')
85:   }
86: 
87:   async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
88:     const threadId = config.configurable?.thread_id as string | undefined
89:     const outputDir = config.configurable?.outputDir as string | undefined
90:     const checkpointId = config.configurable?.checkpoint_id as string | undefined
91:     if (!threadId || !outputDir) return undefined
92: 
93:     const records = this.loadCheckpointRecords(outputDir)
94:     if (records.size === 0) return undefined
95: 
96:     // If checkpoint_id is provided, look up that specific checkpoint
97:     if (checkpointId) {
98:       const record = records.get(checkpointId)
99:       if (record) {
100:         const tuple: CheckpointTuple = {
101:           config: { configurable: { thread_id: threadId, checkpoint_id: record.checkpointId, outputDir } },
102:           checkpoint: record.checkpoint,
103:           metadata: record.metadata,
104:         }
105:         if (record.parentCheckpointId) {
106:           tuple.parentConfig = { configurable: { thread_id: threadId, checkpoint_id: record.parentCheckpointId } }
107:         }
108:         return tuple
109:       }
110:       // checkpointId provided but not found - fall through to latest
111:     }
112: 
113:     // No checkpoint_id or not found - return latest checkpoint
114:     const sorted = [...records.values()].sort((a, b) =>
115:       a.checkpoint.ts.localeCompare(b.checkpoint.ts)
116:     )
117:     const latest = sorted[sorted.length - 1]
118:     if (!latest) return undefined
119: 
120:     const tuple: CheckpointTuple = {
121:       config: { configurable: { thread_id: threadId, checkpoint_id: latest.checkpointId } },
122:       checkpoint: latest.checkpoint,
123:       metadata: latest.metadata,
124:     }
125:     if (latest.parentCheckpointId) {
126:       tuple.parentConfig = { configurable: { thread_id: threadId, checkpoint_id: latest.parentCheckpointId } }
127:     }
128:     return tuple
129:   }
130: 
131:   async *list(
132:     config: RunnableConfig,
133:     options?: { limit?: number; before?: RunnableConfig; filter?: Record<string, unknown> },
134:   ): AsyncGenerator<CheckpointTuple> {
135:     const threadId = config.configurable?.thread_id as string | undefined
136:     const outputDir = config.configurable?.outputDir as string | undefined
137:     if (!threadId || !outputDir) return
138: 
139:     const records = this.loadCheckpointRecords(outputDir)
140:     const limit = options?.limit ?? 100
141: 
142:     const sorted = [...records.values()]
143:       .sort((a, b) => b.checkpoint.ts.localeCompare(a.checkpoint.ts))
144: 
145:     let count = 0
146:     for (const rec of sorted) {
147:       if (count >= limit) break
148:       if (options?.before) {
149:         const beforeId = options.before.configurable?.checkpoint_id as string | undefined
150:         if (beforeId && rec.checkpointId.localeCompare(beforeId) >= 0) continue
151:       }
152:       const tuple: CheckpointTuple = {
153:         config: { configurable: { thread_id: threadId, checkpoint_id: rec.checkpointId, outputDir } },
154:         checkpoint: rec.checkpoint,
155:         metadata: rec.metadata,
156:       }
157:       if (rec.parentCheckpointId) {
158:         tuple.parentConfig = { configurable: { thread_id: threadId, checkpoint_id: rec.parentCheckpointId, outputDir } }
159:       }
160:       yield tuple
161:       count++
162:     }
163:   }
164: 
165:   async put(
166:     config: RunnableConfig,
167:     checkpoint: Checkpoint,
168:     metadata: CheckpointMetadata,
169:     newVersions: ChannelVersions,
170:   ): Promise<RunnableConfig> {
171:     const threadId = config.configurable?.thread_id as string | undefined
172:     const outputDir = config.configurable?.outputDir as string | undefined
173:     if (!threadId) throw new Error('thread_id required')
174:     if (!outputDir) throw new Error('outputDir required in configurable')
175: 
176:     this.threadIdToOutputDir.set(threadId, outputDir)
177:     this.lastCreatedCheckpointId = checkpoint.id as string
178: 
179:     const dir = this.ensureCheckpointDir(outputDir)
180:     const parentId = (config.configurable?.checkpoint_id as string | undefined) ?? null
181: 
182:     const record: CheckpointRecord = {
183:       checkpointId: checkpoint.id as string,
184:       parentCheckpointId: parentId,
185:       checkpoint,
186:       metadata,
187:     }
188: 
189:     const path = join(dir, `${checkpoint.id}.json`)
190:     writeFileSync(path, JSON.stringify(record, null, 2), 'utf-8')
191:     logger.debug(`Checkpoint saved: ${outputDir}/${checkpoint.id}`)
192: 
193:     this.savePendingWrites(outputDir, [])
194: 
195:     return { configurable: { thread_id: threadId, checkpoint_id: checkpoint.id as string, outputDir } }
196:   }
197: 
198:   async deleteThread(threadId: string): Promise<void> {
199:     const outputDir = this.getOutputDir(threadId)
200:     if (!outputDir) return
201: 
202:     const dir = this.getCheckpointDir(outputDir)
203:     if (!existsSync(dir)) return
204: 
205:     for (const file of readdirSync(dir)) {
206:       if (file.endsWith('.json')) {
207:         unlinkSync(join(dir, file))
208:       }
209:     }
210:     logger.debug(`Deleted checkpoints for thread: ${threadId}`)
211:   }
212: 
213:   async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
214:     const threadId = config.configurable?.thread_id as string | undefined
215:     const outputDir = config.configurable?.outputDir as string | undefined
216:     if (!threadId || !outputDir) return
217: 
218:     const existing = this.loadPendingWrites(outputDir)
219:     const filtered = existing.filter(w => !(w.taskId === taskId))
220:     const newWrites: PendingWritesRecord[] = writes.map(([channel, value]) => ({ taskId, channel, value }))
221:     this.savePendingWrites(outputDir, [...filtered, ...newWrites])
222:   }
223: 
224:   async loadPendingWritesForThread(outputDir: string): Promise<PendingWritesRecord[]> {
225:     return this.loadPendingWrites(outputDir)
226:   }
227: 
228:   async saveChapterCheckpoint(outputDir: string, chapterNumber: number): Promise<void> {
229:     const dir = this.getCheckpointDir(outputDir)
230:     if (!existsSync(dir)) return
231: 
232:     const chapterCheckpointId = `chapter_${chapterNumber}_done`
233: 
234:     let sourcePath: string
235:     if (this.lastCreatedCheckpointId) {
236:       sourcePath = join(dir, `${this.lastCreatedCheckpointId}.json`)
237:       if (!existsSync(sourcePath)) {
238:         return
239:       }
240:     } else {
241:       const files = readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'pending_writes.json' && !f.startsWith('chapter_'))
242:       if (files.length === 0) return
243:       const sorted = files.sort((a, b) => b.localeCompare(a))
244:       sourcePath = join(dir, sorted[0]!)
245:     }
246: 
247:     const targetPath = join(dir, `${chapterCheckpointId}.json`)
248: 
249:     const raw = readFileSync(sourcePath, 'utf-8')
250:     const record = JSON.parse(raw) as CheckpointRecord
251:     record.checkpointId = chapterCheckpointId
252:     record.parentCheckpointId = record.parentCheckpointId ?? null
253: 
254:     writeFileSync(targetPath, JSON.stringify(record, null, 2), 'utf-8')
255:     this.lastCreatedCheckpointId = null
256:     logger.debug(`Chapter-level checkpoint saved: ${targetPath}`)
257:   }
258: 
259:   async getChapterCheckpoint(outputDir: string, chapterNumber: number): Promise<{ checkpointId: string; checkpoint: Checkpoint; metadata: CheckpointMetadata } | undefined> {
260:     const chapterCheckpointId = `chapter_${chapterNumber}_done`
261:     const path = join(this.getCheckpointDir(outputDir), `${chapterCheckpointId}.json`)
262: 
263:     if (!existsSync(path)) {
264:       return undefined
265:     }
266: 
267:     try {
268:       const raw = readFileSync(path, 'utf-8')
269:       const record = JSON.parse(raw) as CheckpointRecord
270:       return {
271:         checkpointId: chapterCheckpointId,
272:         checkpoint: record.checkpoint,
273:         metadata: record.metadata,
274:       }
275:     } catch {
276:       return undefined
277:     }
278:   }
279: 
280:   /**
281:    * List all chapter-level checkpoints for a story.
282:    */
283:   async listChapterCheckpoints(outputDir: string): Promise<{ chapterNumber: number; checkpointId: string }[]> {
284:     const dir = this.getCheckpointDir(outputDir)
285:     if (!existsSync(dir)) return []
286: 
287:     const results: { chapterNumber: number; checkpointId: string }[] = []
288:     const prefix = 'chapter_'
289:     const suffix = '_done.json'
290: 
291:     for (const file of readdirSync(dir)) {
292:       if (!file.startsWith(prefix) || !file.endsWith(suffix)) continue
293:       const chapterNum = parseInt(file.slice(prefix.length, file.length - suffix.length), 10)
294:       if (!isNaN(chapterNum)) {
295:         results.push({ chapterNumber: chapterNum, checkpointId: file.slice(0, -5) })
296:       }
297:     }
298: 
299: return results.sort((a, b) => a.chapterNumber - b.chapterNumber)
300:   }
301: 
302:   async pruneIntermediateCheckpoints(outputDir: string): Promise<void> {
303:     const dir = this.getCheckpointDir(outputDir)
304:     if (!existsSync(dir)) return
305: 
306:     const chapterPrefix = 'chapter_'
307:     const files = readdirSync(dir)
308:       .filter(f => f.endsWith('.json') && f !== 'pending_writes.json')
309: 
310:     const chapterCheckpoints = new Set(files.filter(f => f.startsWith(chapterPrefix)))
311:     const toDelete = files.filter(f => !f.startsWith(chapterPrefix) && !chapterCheckpoints.has(f))
312: 
313:     for (const file of toDelete) {
314:       unlinkSync(join(dir, file))
315:       logger.debug(`Pruned intermediate checkpoint: ${file}`)
316:     }
317: 
318:     logger.debug(`Pruned ${toDelete.length} intermediate checkpoints, kept ${chapterCheckpoints.size} chapter checkpoints`)
319:   }
320: 
321:   async clearPendingWrites(outputDir: string): Promise<void> {
322:     const path = this.getPendingWritesPath(outputDir)
323:     if (existsSync(path)) {
324:       unlinkSync(path)
325:       logger.debug(`Cleared pending writes: ${path}`)
326:     }
327:   }
328: }
329: 
330: let _checkpointer: JsonCheckpointer | null = null
331: 
332: export function getCheckpointer(): JsonCheckpointer {
333:   if (!_checkpointer) {
334:     _checkpointer = new JsonCheckpointer()
335:   }
336:   return _checkpointer
337: }

(End of file - total 337 lines)
</content>
```

---

## Assistant (​Sisyphus - Ultraworker · Kimi K2.6 · 240.3s)

_Thinking:_

用户说第一次 write 失败了，再次执行 write 是没有问题的。这意味着我之前的代码分析有误。

让我重新仔细看看 `write` 命令的实现，特别是 `handleWrite` 函数：

```typescript
async function handleWrite(storyId: string, state: Awaited<ReturnType<typeof getState>>, startChapterIndex: number): Promise<void> {
  if (!state) return

  const unresolvedErrors = state.pendingIssues.filter(i => i.severity === 'error')
  if (state.rewriteRequested || unresolvedErrors.length > 0) {
    console.error('[MuseFlow] 当前章节存在问题，需要先修复')
    // ...
    process.exit(1)
  }
```

这确实会检查 `state.rewriteRequested` 和 `unresolvedErrors`。

但用户说实际上没有问题。那可能的情况是：
1. `getState` 返回的 state 没有包含 `rewriteRequested` 或 `pendingIssues`
2. 或者第一次 write 失败后，这些字段没有被正确保存

让我再仔细看 `continueStory` 中失败时的逻辑：

```typescript
const remainingErrors = workingState.pendingIssues.filter(i => i.severity === 'error')
if (remainingErrors.length > 0) {
  workingState = {
    ...workingState,
    rewriteRequested: true,
    rewriteApproved: false,
  }
  await graph.updateState(
    { configurable: { thread_id: storyId, outputDir } },
    {
      rewriteApproved: false,
      rewriteRequested: true,
      pendingIssues: workingState.pendingIssues,
      currentChapterIndex: workingState.currentChapterIndex,
      chapters: workingState.chapters,
      chapterSummaries: workingState.chapterSummaries,
    }
  )
  return workingState
}
```

这里调用了 `graph.updateState` 来保存状态。

然后在 `getState` 中：
```typescript
export async function getState(storyId: string): Promise<ReducedGraphState | null> {
  const graph = getGraph()
  const outputDir = getOutputDirFromStoryId(storyId)
  // ...
  const state = await graph.getState(config)
  const graphState = state.values as unknown as ReducedGraphState
  // ...
  return graphState
}
```

这应该能获取到更新后的状态。

但等等，让我看看 `continueStory` 的 catch 块：

```typescript
} catch (err) {
  // 当 draft_chapter 等节点抛出异常时，先保存当前的 pendingIssues
  // 这样 rewrite/fix 命令才能识别到已检测但尚未修复的问题
  if (workingState.pendingIssues.length > 0) {
    await graph.updateState(
      { configurable: { thread_id: storyId, outputDir } },
      {
        rewriteRequested: true,
        pendingIssues: workingState.pendingIssues,
        currentChapterIndex: workingState.currentChapterIndex,
        chapters: workingState.chapters,
        chapterSummaries: workingState.chapterSummaries,
      }
    )
  }
  throw err
}
```

如果发生异常，也会保存 `rewriteRequested: true`。

所以理论上，如果第一次 write 失败了（无论是检测到 errors 还是抛出异常），再次运行 write 时 `state.rewriteRequested` 应该是 true。

但用户说可以再次运行 write。这可能有几种情况：

1. 第一次 write 没有到达保存状态的那一步就崩溃了
2. 用户的 "失败" 不是指质量检查失败，而是指内容不满意，但程序本身没有报错
3. 或者状态保存有问题

或者，用户可能是指：第一次 write 生成了内容，但用户觉得写得不好，于是再次运行 write。此时：
- 如果第一次 write 成功完成了（通过了所有检查），`finalize_chapter` 会被调用
- `finalize_chapter` 会增加 chapter summary，更新 `currentChapterIndex` 到下一章
- 所以第二次 write 会写下一章，不是同一章

但如果用户在 `finalize_chapter` 之前（比如在 draft_chapter 写入文件后，但在检查节点之前）就中断了进程呢？那状态可能还停留在当前章节，但文件已经写入了。

或者，用户可能是指一种特定的场景：第一次 write 某章时，质量检查发现了 warnings 但没有 errors。此时：
- `auto_fix_warnings` 什么都不做
- `remainingErrors` 为空
- `finalize_chapter` 会被调用
- 状态推进到下一章

所以第二次 write 写下一章。

但用户明确说"写同一章"。那让我再想想...

等一下，让我重新审视 `write` 命令的入口逻辑：

```typescript
export async function write(storyId: string, _options: WriteOptions): Promise<void> {
  // ...
  const state = await getState(storyId)
  // ...
  const hasChaptersOnDisk = checkExistingChapters(story.outputDir)

  let startChapterIndex = state.currentChapterIndex
  if (hasChaptersOnDisk && state.currentChapterIndex === 0) {
    const chaptersDir = join(story.outputDir, 'chapters')
    const files = readdirSync(chaptersDir).filter(f => f.startsWith('chapter_') && f.endsWith('.md'))
    startChapterIndex = files.length
  }
  // ...
}
```

如果 `state.currentChapterIndex` 是 0，但磁盘上已经有章节文件了，`startChapterIndex` 会被设为文件数量。

然后：
```typescript
if (hasChaptersOnDisk && startChapterIndex < state.currentChapterIndex) {
  startChapterIndex = state.currentChapterIndex
}
```

这里取较大的值。

所以如果第一次 write 写了第 1 章（文件已写入），但 `currentChapterIndex` 还是 0（可能因为状态没保存或失败了），第二次 write 时：
- `startChapterIndex = 1`（因为有文件）
- 但 `state.currentChapterIndex = 0`
- 所以进入 `if` 分支，`startChapterIndex` 被设为 `max(1, 0) = 1`

等一下，让我仔细看：
```typescript
let startChapterIndex = state.currentChapterIndex  // 0
if (hasChaptersOnDisk && state.currentChapterIndex === 0) {
  startChapterIndex = files.length  // 1
}
```

如果 state.currentChapterIndex 是 0，hasChaptersOnDisk 是 true（有文件），那 startChapterIndex 会被设为 1。

然后：
```typescript
if (hasChaptersOnDisk && startChapterIndex < state.currentChapterIndex) {
  startChapterIndex = state.currentChapterIndex
}
```

startChapterIndex 现在是 1，state.currentChapterIndex 是 0，1 < 0 是 false，所以不会进入这个 if。

然后 `handleWrite` 被调用，`chapterIndex = 1`，写第 2 章。

所以如果第一次 write 后 currentChapterIndex 还是 0，第二次 write 会写第 2 章（基于文件数推断），不是同一章。

除非...文件数和 currentChapterIndex 不匹配的其他情况。

让我重新思考。用户说"第一次 write 失败了，再次执行 write 是没有问题的"。如果"失败"指的是程序抛异常而不是质量检查不通过，那：

1. 如果异常发生在 `draft_chapter` 写入文件之前：没有文件，状态也没保存 → 第二次 write 从头开始写同一章
2. 如果异常发生在写入文件后、保存状态前：有文件但状态没更新 → 第二次 write 可能写下一章
3. 如果异常发生在保存状态后：状态包含 rewriteRequested=true → 第二次 write 被阻止

所以具体行为取决于"失败"的时机和方式。

但用户说"再次执行 write 是没有问题的"，这意味着在他的场景中，程序允许再次 write。那最可能的情况是：
- 第一次 write 因为某种原因（比如 API 错误、网络问题）在 draft_chapter 写入文件前就崩溃了
- 或者第一次 write 虽然质量检查不通过，但状态没有被正确保存（bug）

让我再看看 `continueStory` 中检查失败后的路径：

```typescript
if (!hasErrors) {
  break
}

if (rewriteAttempts < MAX_REWRITE_ATTEMPTS) {
  console.log(`[MuseFlow] 将在第 ${rewriteAttempts + 1} 次尝试中修复上述问题...`)
  workingState.rewriteApproved = true
} else {
  const remainingErrors = workingState.pendingIssues.filter(i => i.severity === 'error')
  console.error(`[MuseFlow] 已达到最大重写次数 (${MAX_REWRITE_ATTEMPTS})，仍有 ${remainingErrors.length} 个未修复的严重问题：`)
  // ...
  break
}
```

如果 `hasErrors` 为 true，会进入 `rewriteAttempts < MAX_REWRITE_ATTEMPTS` 分支，`rewriteApproved` 设为 true，进入下一次循环。

如果达到了最大尝试次数（3次），会 break，然后：

```typescript
const remainingErrors = workingState.pendingIssues.filter(i => i.severity === 'error')
if (remainingErrors.length > 0) {
  workingState = {
    ...workingState,
    rewriteRequested: true,
    rewriteApproved: false,
  }
  await graph.updateState(...)
  return workingState
}
```

所以达到最大尝试次数后会保存 `rewriteRequested: true`。

如果用户说的是"第一次 write 失败了" = 第一次循环就有 errors，然后继续到第二次循环（自动重试），然后第二次循环也失败...直到第三次，然后 return。此时 `rewriteRequested` 应该是 true。

但等等，用户说的"再次执行 write"可能不是指 `continueStory` 内部的循环，而是指用户手动再次运行 `museflow write` 命令。

如果用户手动再次运行 `museflow write`，而 `rewriteRequested` 是 true，那 `handleWrite` 会阻止。

除非...`graph.updateState` 没有正确保存？

让我看看 LangGraph 的 `updateState` 方法。这是 LangGraph 的内置方法，应该能正确保存状态。

或者，可能用户运行的是 `continue` 命令而不是 `write`？不，用户明确说的是 `write`。

我觉得最合理的解释是：用户观察到的行为与代码理论行为不一致，可能有一个 bug，或者我对"失败"的理解有误。

让我换个角度思考。也许用户说的"失败"不是指质量检查失败，而是指：
1. 用户觉得写得不好
2. 用户直接 Ctrl+C 中断了进程
3. 然后再次运行 write

在这种情况下：
- 如果中断发生在 `finalize_chapter` 之前，但 `draft_chapter` 已经写入了文件
- 状态可能还是旧的（因为 `finalize_chapter` 没运行）
- 但文件已存在

此时 `write` 命令的逻辑：
- `state.currentChapterIndex` 还是 N
- `hasChaptersOnDisk` = true
- 但 `state.currentChapterIndex === 0` 可能不成立（如果之前已经写了其他章）
- `startChapterIndex = state.currentChapterIndex` = N
- 然后 `handleWrite` 检查 `state.pendingIssues` 和 `state.rewriteRequested`

如果进程在中断前已经运行了检查节点并发现了 errors，那 `pendingIssues` 可能包含 errors，会被阻止。

但如果进程在 draft_chapter 刚写完就中断了（检查节点还没运行），那 `pendingIssues` 可能是空的，不会被阻止。

所以这种情况是可能的：用户第一次 write，draft 写完文件但还没检查（或检查没完成），用户中断进程，再次 write，程序允许继续。

但用户明确说"失败了"...

我觉得我应该直接承认用户的观察，然后重新审视代码，寻找可能的代码路径。

让我重新看 `write` 的完整流程：

1. `write` → `handleWrite` → `executeWrite`
2. `executeWrite` → `continueStory`

在 `continueStory` 中：
- 获取 snapshot state
- 构建 workingState
- 进入 while 循环
- 第一次迭代：plan + draft
- 然后运行检查节点
- 如果 hasErrors，进入第二次迭代
- ...

如果第一次 write 命令运行时，第一次迭代就成功了（没有 errors），finalize 被调用，状态推进。

如果第一次 write 命令运行时，第一次迭代有 errors：
- 如果是局部问题：运行 fix_chapter
- 如果是结构性问题：重置 chapterPlan，重新 plan + draft
- 然后重新检查
- 如果还有 errors，继续循环
- 最多 3 次

如果 3 次后还有 errors，保存 `rewriteRequested: true` 并 return。

此时用户再次运行 `write`，`handleWrite` 会检查到 `rewriteRequested: true` 或 `unresolvedErrors.length > 0`，会报错退出。

所以理论上，如果"失败"是指质量检查不通过，再次 write 应该被阻止。

那用户说的"没有问题"是什么意思？

也许用户指的是：第一次 write 虽然没有通过质量检查，但章节文件已经写入了磁盘。此时用户可以：
1. 直接编辑文件
2. 然后再次运行 write

但再次运行 write 还是会被 handleWrite 阻止，除非...

让我再看看 handleWrite 的条件：
```typescript
const unresolvedErrors = state.pendingIssues.filter(i => i.severity === 'error')
if (state.rewriteRequested || unresolvedErrors.length > 0) {
```

如果 state 中没有 `rewriteRequested`，且 `pendingIssues` 中没有 severity='error' 的项，那就可以继续。

但 `continueStory` 中，如果有 errors，会设置 `rewriteRequested: true`。所以这个条件应该会被触发。

除非...`graph.updateState` 保存的状态和 `graph.getState` 读取的状态不一致？或者 LangGraph 的 updateState 有 bug？

我觉得我应该诚实地告诉用户：根据代码逻辑，如果第一次 write 因为质量问题失败，再次运行 write 应该被 handleWrite 阻止。但如果用户观察到可以再次运行，可能是：
1. 失败发生在状态保存之前
2. 或者存在一个状态同步的 bug

然后回到用户最初的问题：如果两次 write 同一章，prompt 是否一样？

如果第二次 write 没有被阻止（意味着状态中没有 rewriteRequested 和 errors），那两次 write 的 prompt 取决于状态差异：
- `chapterSummaries`：如果 finalize 没运行，相同
- `foreshadowStack`：如果 detect_foreshadowing 运行了，可能不同
- `pendingIssues`：如果没有 errors，可能只有 warnings 或为空
- `chapters`：第二次的 chapters 数组中，当前章节可能已有内容（如果 draft 写入了文件）

等等，在 `continueStory` 中：
```typescript
const rewrittenChapters = new Array(checkpointState.totalChapters).fill(null) as ReducedGraphState['chapters']
for (let i = 0; i < targetIndex; i++) {
  rewrittenChapters[i] = checkpointState.chapters[i] ?? null
}
```

这里只复制 targetIndex 之前的章节，当前章节被设为 null。

所以 chapters 数组中当前章节始终是 null。

让我重新思考。用户说"第一次 write 失败了，再次执行 write 是没有问题的"。

也许"失败"指的是 draft_chapter 抛异常（比如 AI 返回空内容）？在这种情况下：

```typescript
} catch (err) {
  if (workingState.pendingIssues.length > 0) {
    await graph.updateState(...)
  }
  throw err
}
```

如果 `workingState.pendingIssues.length === 0`（draft_chapter 抛异常但之前没有 pending issues），那不会保存状态。

然后异常被抛出到 `executeWrite` 的 catch 块：
```typescript
} catch (err) {
  const message = err instanceof Error ? err.message : String(err)
  // ...
  updateStatus('error')
  process.exit(1)
}
```

程序退出。用户再次运行 write。此时：
- 如果 draft_chapter 在写入文件前抛异常：没有文件，状态也没有保存
- `getState` 返回的是旧状态
- `handleWrite` 检查 `state.rewriteRequested` 和 `pendingIssues`

如果旧状态中这些字段都是默认值（false 和空数组），那 handleWrite 不会阻止，会继续写同一章。

这种情况下，两次 write 同一章的 prompt 会：
- `chapterSummaries`：相同（因为 finalize 没运行）
- `foreshadowStack`：相同（因为 detect_foreshadowing 没运行）
- `pendingIssues`：相同（空）
- `rewriteApproved`：相同（false）
- `chapterPlan`：相同（null，第一次会重新 plan）

所以这种情况下，prompt 几乎是相同的！

但如果 draft_chapter 已经写入了文件再抛异常（比如在 parse 阶段），那文件存在但状态没保存。

让我再看看 draft_chapter：
```typescript
const output = await agent.run(agentState)
let content = output.content ?? ''
// ...
await writeChapterContent(state.story.outputDir, chapterIndex + 1, content)
// ...
const newChapters = [...state.chapters]
newChapters[chapterIndex] = newChapter
return { chapters: newChapters }
```

如果 `agent.run` 成功，但后续的 parse 或返回有问题...实际上 draft_chapter 没有抛异常的地方，除非 `agent.run` 失败或 `writeChapterContent` 失败。

如果 `agent.run` 失败（网络错误等），不会写入文件。

所以"失败"最可能是：
1. API 调用失败（agent.run 抛异常）
2. 或者检查节点发现了 errors

对于情况 1，如果发生在写入文件前，没有保存状态，再次 write 可以正常进行，prompt 几乎相同。

对于情况 2，会保存 `rewriteRequested: true`，再次 write 应该被阻止。

我觉得我应该这样回答用户：
1. 承认用户的观察——如果 draft 阶段就失败（如 API 错误），状态确实没有保存，再次 write 可以正常进行
2. 在这种情况下，两次 write 同一章的 prompt **基本相同**，差异很小（可能只有随机性导致）
3. 但如果失败发生在质量检查阶段（发现了 errors），代码逻辑上应该阻止再次 write

实际上，让我再仔细看看用户的原始问题。他问的是"第一次 write 与第二次 write 同一章，prompt 参数是完全一样的吗"。

从代码逻辑看，最可能让两次 write 同一章的场景是：
- 第一次 write 时 draft 失败（API 错误等），状态没保存，再次 write

或者：
- 用户使用了某种方式绕过检查（比如直接修改 checkpoint）

在正常流程中，如果第一次 write 通过了 draft 但检查不通过，再次 write 会被阻止。

所以我应该区分这两种情况来回答。

但根据用户的反馈"可我看第一次 write 失败了，再次执行 write 是没有问题的"，这说明：
1. 用户确实观察到了这个现象
2. 用户的"失败"可能指的是 draft 阶段就失败了（API 错误等）

让我再看一个可能性：也许用户在问的是 `continue` 命令而不是 `write`？不，用户明确说的是 `write`。

好，我决定这样回答：
1. 首先承认：如果 draft 阶段就失败（如 API 异常、网络问题），程序会在抛出异常前保存 pendingIssues（如果有的话），但如果 pendingIssues 为空，状态不会被标记为 rewriteRequested
2. 但实际上，在 `executeWrite` 的 catch 中，updateStatus('error') 和 process.exit(1) 会让程序退出
3. 再次运行 write 时，getState 获取到的状态取决于上一次是否成功调用了 graph.updateState

如果 draft 阶段抛异常（且之前没有 pending issues）：
- catch 块中 `workingState.pendingIssues.length === 0`，不会调用 graph.updateState
- 异常继续抛出，executeWrite 的 catch 捕获，设置 status='error'，exit(1)
- 再次 write：getState 获取的是上一次成功保存的 checkpoint
- 这个 checkpoint 中 rewriteRequested=false, pendingIssues=[]（或之前的状态）
- handleWrite 不会阻止

所以这种情况下，prompt 确实几乎相同。

但还有一个更常见的情况：用户在 `continueStory` 的 while 循环中，第一次 iteration 失败了（有 errors），但这不是用户手动再次运行 write，而是程序自动进行了第二次 iteration。

用户明确说"再次执行 write"，指的是手动再次运行命令。

我最终的理解是：用户观察到的现象可能是 draft 阶段失败导致的。在这种情况下，两次 write 的 prompt 确实非常相似，主要差异来自：
- 磁盘上可能已写入部分文件
- 但传递给 LLM 的 prompt 参数基本相同

但还有另一种可能：也许 `write` 命令的 `handleWrite` 检查有 bug，或者状态保存有 bug，导致 rewriteRequested 没有被正确保存。

让我看看 finalize_chapter 之前，状态是什么时候被保存到 checkpoint 的。

LangGraph 的 `graph.invoke` 或 `graph.getState` 会自动管理 checkpoint。但 `continueStory` 直接调用了各个节点函数，没有通过 graph.invoke。

等一下，这是一个非常重要的发现！

`continueStory` 函数：
```typescript
export async function continueStory(...) {
  const graph = getGraph()
  // ...
  const snapshot = await graph.getState(config)
  const checkpointState = snapshot.values as ReducedGraphState
  // ...
  // 直接调用节点函数：
  const planResult = await plan_chapter(workingState)
  const draftResult = await draft_chapter(workingState)
  // ...
  const partial = await validate_chapter(workingState)
  // ...
}
```

`continueStory` 没有调用 `graph.invoke`！它是直接调用节点函数，手动管理状态的。

这意味着 LangGraph 的自动 checkpoint 机制不会触发。只有在显式调用 `graph.updateState` 时，状态才会被保存。

在 `continueStory` 中，`graph.updateState` 只在以下地方被调用：
1. 循环结束后，如果有 remaining errors
2. 循环结束后，如果成功 finalize
3. catch 块中，如果有 pendingIssues

所以在循环内部（plan + draft + 检查节点），状态不会被自动保存！

如果第一次 write 时：
- draft_chapter 成功，写入了文件
- 然后检查节点发现了 errors
- 进入第二次 iteration
- 然后用户中断进程（Ctrl+C）

此时：
- 文件已写入
- 但 `graph.updateState` 还没有被调用（因为循环还没结束）
- checkpoint 中还是旧状态（currentChapterIndex 没变，rewriteRequested=false, pendingIssues=[]）

用户再次运行 write：
- `getState` 返回旧状态
- `handleWrite` 检查：rewriteRequested=false, pendingIssues=[]
- 不会阻止！
- 继续写同一章

这就是答案！因为 `continueStory` 直接调用节点函数而不是通过 `graph.invoke`，中间状态不会被自动保存。只有在整个循环结束后才会显式保存。

所以如果用户在检查节点发现 errors 后、循环结束前中断进程，再次 write 就可以写同一章，而且 prompt 基于的是旧状态，与第一次几乎相同。

但等等，如果循环成功发现了 errors 并继续到第二次 iteration，这是自动的，用户不需要再次运行 write。用户说的"再次执行 write"应该是指循环结束后再次运行。

如果循环正常结束（达到 MAX_REWRITE_ATTEMPTS），会调用 `graph.updateState` 保存 `rewriteRequested: true`。然后再次 write 应该被阻止。

除非...循环因为某种原因异常退出，没有执行到 `graph.updateState`。

我觉得我应该更仔细地看看 `executeWrite` 的调用：

```typescript
try {
  const result = await withSpinner(
    `正在撰写第 ${chapterNum}/${totalChapters} 章...`,
    () => continueStory(storyId, undefined, chapterIndex),
    `✅ 第 ${chapterNum} 章撰写完成`
  )
  // ...
} catch (err) {
  // ...
}
```

如果 `continueStory` return 了（达到最大尝试次数），`result` 包含 `rewriteRequested: true`。

然后 `executeWrite` 检查：
```typescript
if (result.rewriteRequested) {
  const errors = result.pendingIssues.filter(i => i.severity === 'error')
  console.log(`\n[MuseFlow] 检测到 ${errors.length} 个严重问题，撰写已中断：`)
  // ...
  return
}
```

注意这里是 `return`，不是 `process.exit(1)`。所以程序正常退出，状态已经被 `continueStory` 中的 `graph.updateState` 保存了。

然后用户再次运行 `write`，`handleWrite` 会检查到 `rewriteRequested: true`，会阻止。

所以理论上，如果程序正常完成（即使发现了 errors），再次 write 应该被阻止。

但用户说可以。那只能是：
1. 程序异常退出，没有保存状态
2. 或者用户观察到的行为有误

我觉得最可能的解释是：用户在第一次 write 过程中中断了进程（Ctrl+C），此时：
- draft_chapter 可能已经写入了文件
- 但 `graph.updateState` 还没被调用
- 所以状态还是旧的

或者：第一次 write 时，draft_chapter 本身抛异常，导致整个流程中断，状态没保存。

无论如何，我都应该重新回答用户的问题，承认存在某些场景下可以再次 write 同一章，并分析这些场景下 prompt 的差异。

让我再想想，也许有一个更简单的解释：用户可能运行的是 `museflow continue` 而不是 `museflow write`？但用户明确说的是 write。

或者，也许 `handleWrite` 的检查有逻辑漏洞？

```typescript
const unresolvedErrors = state.pendingIssues.filter(i => i.severity === 'error')
if (state.rewriteRequested || unresolvedErrors.length > 0) {
```

这个检查应该没问题。如果 state 确实保存了 rewriteRequested 或 errors，会被阻止。

我最终认为，用户观察到的现象最可能是由于：
1. 进程在状态保存前被中断，或者
2. draft 阶段异常退出导致状态未保存

在这些情况下，两次 write 的 prompt **基本相同**，因为状态没有变化。唯一的差异可能是：
- 磁盘上已有章节文件（但 draft_chapter 只有在 rewriteApproved 时才读取已有内容，而 write 命令设置 rewriteApproved=false）
- 随机性（temperature=0.7）

所以我的最终答案是：在可以再次 write 同一章的场景下（通常是状态未保存的中断场景），prompt 参数**几乎完全相同**，主要差异来自 LLM 的随机性。

但我需要更仔细地确认这一点。让我再想想...

实际上，还有一个重要的点：`write` 命令调用 `continueStory(storyId, undefined, chapterIndex)`，其中第三个参数 `currentChapterIndex` 是 `chapterIndex`。

在 `continueStory` 中：
```typescript
const targetIndex = currentChapterIndex ?? checkpointState.currentChapterIndex
```

如果传入的 `chapterIndex` 是 `startChapterIndex`，而 `startChapterIndex` 是从磁盘文件数推断的（在有文件但 currentChapterIndex 没变的情况下），那 `targetIndex` 就是文件数。

但 `checkpointState` 还是旧的。所以 `workingState` 构建时：
```typescript
const rewrittenChapters = new Array(checkpointState.totalChapters).fill(null) as ReducedGraphState['chapters']
for (let i = 0; i < targetIndex; i++) {
  rewrittenChapters[i] = checkpointState.chapters[i] ?? null
}
```

如果 targetIndex 大于 checkpointState.currentChapterIndex，但小于 totalChapters，那 `rewrittenChapters` 会包含更多 null。

然后 `plan_chapter` 和 `draft_chapter` 会使用 `state.chapterSummaries`，这在 checkpointState 中还是旧的（如果没有 finalize）。

所以 prompt 确实几乎相同。

等等，如果磁盘上已有文件，但 `rewriteApproved` 是 false，`draft_chapter` 不会读取已有内容：

```typescript
const existingContent = state.rewriteApproved
  ? await readChapterContent(state.story.outputDir, chapterIndex + 1)
  : null
```

所以 existingContent 是 null。

这意味着：即使磁盘上有文件，第二次 write 同一章时，也不会在 prompt 中包含已有内容！

这是一个很重要的发现。所以两次 write 同一章（在 rewriteApproved=false 的情况下）：
1. 不会读取已有章节内容
2. 不会传入 issues
3. chapterSummaries 相同（如果 finalize 没运行）
4. foreshadowStack 相同（如果 detect_foreshadowing 没运行）

prompt **几乎完全相同**！

但有一个差异：`state.chapterPlan`。在第一次 write 时，如果 plan_chapter 成功，会生成 chapterPlan 并保存到 workingState。但 workingState 只在循环结束后通过 `graph.updateState` 保存。如果进程中断，chapterPlan 不会被保存。

所以第二次 write 时，`state.chapterPlan` 还是 null，和第一次开始时一样。

综上所述，在大多数"失败后可以再次 write"的场景下，prompt 确实是**几乎完全相同**的。

但我需要注意一点：如果第一次 write 的循环成功完成了（finalize_chapter 运行了），状态被保存，`currentChapterIndex` 推进到下一章，那第二次 write 就不会写同一章了。

所以"可以再次 write 同一章"的场景，必然是状态没有被正确保存或推进的场景。在这些场景下，prompt 基本相同。

好的，我现在给出最终回答。

我重新审视了代码，你说得对——确实存在可以再次 `write` 同一章的场景。关键在于 `continueStory` 是**直接调用节点函数**而非通过 `graph.invoke`，中间状态不会自动保存到 checkpoint，只有循环结束后才会显式调用 `graph.updateState`。

如果进程在以下时机中断或异常退出，checkpoint 中仍保留旧状态（`rewriteRequested=false`、`pendingIssues=[]`）：
- `draft_chapter` 写入文件后、检查节点运行前
- 检查节点发现 errors 后、循环结束前
- `draft_chapter` 本身抛异常（API 错误等），且此前无 pending issues

此时再次运行 `write`，`handleWrite` 的检查会放行，确实会重新写同一章。

**这种情况下，两次 write 的 prompt 参数几乎完全相同**：

| 参数 | 第一次 write | 第二次 write（状态未保存时） |
|------|-------------|------------------------|
| `previousChapters` | 基于 `chapterSummaries` | 相同（`finalize` 未运行，无新 summary） |
| `timelineSnapshot` | 基于 `chapterSummaries` | 相同 |
| `keyEventsTimeline` | 基于 `chapterSummaries` | 相同 |
| `foreshadowStack` | 初始状态 | 相同（`detect_foreshadowing` 未运行完） |
| `chapterPlan` | `null`（首次规划） | `null`（上次未保存） |
| `issues` | 不传入 | 不传入（`rewriteApproved=false`） |
| `chapterContent` | `null` | `null`（即使磁盘有文件，只有 `rewriteApproved=true` 才读取） |

**唯一差异**：
- `temperature=0.7` 带来的随机性
- 如果上次写入了文件，本次会**覆盖**原文件（因为 `draft_chapter` 会重新写入）

所以结论是：**在状态未保存的异常/中断场景下，两次 write 同一章的 prompt 几乎完全一样**，区别主要来自 LLM 的随机采样，而非 prompt 内容本身。

---

