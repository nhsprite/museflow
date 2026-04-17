# MuseFlow 设计文档

> 日期：2025-04-17
> 状态：已确认，待实施

## 1. 项目概述

### 1.1 项目名称
**MuseFlow** — AI Native 长篇小说生成工具

### 1.2 核心定位
端到端 AI 长篇小说生成器。用户输入一句话故事简介，AI 自动完成从世界观构建、大纲生成到逐章正文撰写的全部工作，最终输出完整可读的长篇小说。

### 1.3 目标用户
- 普通写作爱好者（缺乏写作经验，需要 AI 全程辅助完成一本书）
- 内容创业者/自媒体（需要快速生成小说内容用于平台发布，如番茄小说、起点等网文平台）

### 1.4 交互形式
CLI 工具（`museflow start --idea "..."`），本地运行，数据完全在本地。

---

## 2. 技术栈

| 项目 | 选择 |
|---|---|
| 语言 | TypeScript / Node.js |
| 运行时 | Node.js 单进程 |
| 包管理器 | npm / yarn |
| 类型检查 | TypeScript（strict mode） |

---

## 3. 模型支持

### 3.1 模型可配置架构
用户可自由选择 AI 模型 provider，系统内置以下 Provider 实现：

- **OpenAI Provider** — GPT-4o / GPT-4.5 等
- **MiniMax Provider** — MiniMax 文本模型
- **Local Provider** — 本地开源模型（如 Ollama 运行的 Llama、Qwen 等）

### 3.2 Provider 抽象
所有 Provider 实现统一的抽象接口，包含：
- `chat(messages: Message[]): Promise<string>` — 发送对话并获取响应
- 模型参数可配置（temperature、max_tokens 等）

---

## 4. 数据存储

### 4.1 双存储架构
采用 **SQLite + 文件系统双存储**，职责分离：

**SQLite 数据库**（元数据）：
- 故事信息（story table）
- 人物设定（character table）
- 世界观设定（world table）
- 大纲（outline table）
- 章节元数据（chapter table）

**文件系统**（正文内容）：
- 路径：`outputs/{story_id}/chapters/chapter_{n}.md`
- 每章一个 `.md` 文件，包含完整正文

### 4.2 数据库 Schema（概要）
```sql
-- story: 故事主表
CREATE TABLE story (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  idea TEXT NOT NULL,          -- 用户原始简介
  total_chapters INTEGER NOT NULL,  -- 用户指定的章节总数
  status TEXT NOT NULL,        -- 'init' | 'worldbuilding' | 'outlining' | 'writing' | 'done'
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- world: 世界观设定表
CREATE TABLE world (
  id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL UNIQUE,
  content TEXT NOT NULL,       -- 世界观设定正文（Markdown）
  FOREIGN KEY (story_id) REFERENCES story(id)
);

-- character: 人物表
CREATE TABLE character (
  id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  dialogue_style TEXT,
  FOREIGN KEY (story_id) REFERENCES story(id)
);

-- chapter: 章节元数据表
CREATE TABLE chapter (
  id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL,
  number INTEGER NOT NULL,      -- 章节序号（1~total_chapters）
  title TEXT,
  outline TEXT,                 -- 本章大纲（大纲 Agent 生成）
  summary TEXT,                 -- 章节核心内容摘要（检测后提取）
  foreshadows TEXT,             -- 本章埋下的伏笔（JSON 数组）
  status TEXT NOT NULL,         -- 'outline' | 'drafting' | 'reviewing' | 'done' | 'error'
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (story_id) REFERENCES story(id)
);
```

---

## 5. LangGraph 架构

### 5.1 为什么用 LangGraph

长篇小说的生成流程是一个**有状态、多阶段、人机交互**的复杂工作流：

- 多 Agent 协同（8 个 Agent 依次执行）
- 状态在阶段间传递（世界观 → 人物 → 大纲 → 逐章生成）
- 需要中断等用户确认重写（`interrupt` 机制）
- CLI 重启后需从断点恢复（CheckpointSaver）

LangGraph 原生支持以上所有场景，手工编排则需要大量胶水代码。

### 5.2 GraphState（共享状态）

```typescript
interface GraphState {
  // 故事元数据
  story: Story
  idea: string                      // 用户原始简介
  genre: string                    // 题材名称
  totalChapters: number            // 用户指定的章节总数

  // 规划阶段输出
  world: WorldContent | null       // 世界观设定
  characters: Character[]          // 角色列表
  outline: ChapterOutline[]        // 章节大纲（精确 totalChapters 条）

  // 逐章生成状态
  chapters: WrittenChapter[]       // 已完成的章节（含正文）
  currentChapterIndex: number       // 当前正在处理的章节序号（0-indexed）

  // 质量保障累积数据
  foreshadowStack: Foreshadow[]    // 全局伏笔栈（跨章节累积）
  chapterSummaries: string[]       // 每章摘要（用于逻辑一致性检测）

  // 重写流程状态
  pendingIssues: Issue[]            // 当前章检测到的问题
  rewriteApproved: boolean         // 用户是否已确认重写
  rewriteRequested: boolean        // 是否触发了重写请求中断
}
```

### 5.3 节点定义

| 节点函数 | 职责 | 状态修改 |
|---|---|---|
| `build_world` | 调用世界观 Agent | `state.world = <世界观内容>` |
| `create_characters` | 调用人物 Agent | `state.characters = <角色列表>` |
| `create_outline` | 调用大纲 Agent | `state.outline = <n章大纲>` |
| `draft_chapter` | 调用章节 Agent 生成正文 | `state.chapters[current] = <章节正文>` |
| `quality_pass` | 调用质量 Agent 润色 | `state.chapters[current].content = <润色后正文>` |
| `detect_foreshadowing` | 调用伏笔检测 Agent | `state.foreshadowStack += <本章伏笔>` |
| `detect_hallucination` | 调用幻觉检测 Agent | `state.pendingIssues += <幻觉问题>` |
| `detect_consistency` | 调用逻辑一致性 Agent | `state.pendingIssues += <一致性问题>` |
| `request_rewrite` | 中断图执行，等用户确认 | —（通过 `interrupt()` 实现） |
| `save_checkpoint` | 双写 SQLite + 文件系统 | 持久化当前状态 |
| `finalize_chapter` | 写入本章摘要，更新 currentChapterIndex | `state.chapterSummaries += <摘要>` |

### 5.4 图结构（StateGraph）

```
用户 idea 输入
      │
      ▼
┌─────────────────────────────────┐
│         PLANNING PHASE           │
│  build_world → create_characters │
│            → create_outline      │
└─────────────────────────────────┘
      │
      ▼  outline 生成完成，开始逐章
┌─────────────────────────────────┐
│        CHAPTER LOOP             │◄──┐
│  draft_chapter                   │   │
│       ↓                          │   │
│  quality_pass                    │   │
│       ↓                          │   │
│  detect_foreshadowing            │   │
│       ↓                          │   │
│  detect_hallucination            │   │
│       ↓                          │   │
│  detect_consistency              │   │
│       ↓                          │   │
│  ┌── has_issues? ──┐           │   │
│  │ yes            no│           │   │
│  ▼                ▼            │   │
│ request_rewrite  save_checkpoint│   │
│  (interrupt)     finalize_chapter│   │
│      ↑                │         │   │
│      └──── approved?──┘         │   │
│                              ◄──┘   │
└─────────────────────────────────┘
      │
      ▼  所有章节完成
┌─────────────────┐
│  finalize_story  │
│  (生成结束)       │
└─────────────────┘
```

### 5.5 条件边（Conditional Edges）

```typescript
// detect_consistency 之后判断是否需要重写
function should_continue(state: GraphState):
  if state.pendingIssues.length > 0:
    return "request_rewrite"   // 中断，等用户确认
  elif state.currentChapterIndex < state.totalChapters - 1:
    return "next_chapter"      // 继续下一章
  else:
    return "finalize_story"    // 全部完成

// request_rewrite 用户确认后的分支
function after_user_confirmation(state: GraphState):
  if state.rewriteApproved:
    return "draft_chapter"     // 用户同意，重写当前章
  else:
    return "save_checkpoint"    // 用户拒绝，保留当前章继续
```

### 5.6 CheckpointSaver（状态持久化）

LangGraph 内置 SQLite CheckpointSaver：

```typescript
import { SqliteSaver } from "@langgraph/langgraph-native/checkpoint-sqlite"

const checkpointer = new SqliteSaver({
  dbPath: "~/.museflow/checkpoints/{story_id}.sqlite"
})

const graph = new StateGraph({ /* ... */ })
  .runnable(...)
  .compile({ checkpointer })
```

**恢复流程**：
1. CLI 启动时检测 `~/.museflow/checkpoints/{story_id}.sqlite` 是否存在
2. 存在则 `graph.getState({ config: { thread_id: story_id } })` 恢复状态
3. 从断点继续执行（用户执行 `museflow continue` 时自动触发）

### 5.7 8 类 Agent 在 LangGraph 中的角色

Agent 不再是独立的执行单元，而是**节点函数内部调用的 LLM 封装**：

```typescript
// 示例：build_world 节点
async function build_world(state: GraphState, config: LangGraphConfig) {
  const provider = resolveProvider(config.config)
  const genreSkill = genreRegistry.get(state.genre)

  const agent = new WorldBuilderAgent({
    provider,
    genrePrompt: genreSkill.worldbuildingPrompt,
  })

  const result = await agent.run({
    idea: state.idea,
    totalChapters: state.totalChapters,
  })

  return { world: result.worldContent }
}
```

这样做的好处：
- Agent 逻辑与图编排分离，单元测试更简单
- 同一个 Agent 可以被多个节点调用（如章节 Agent 生成正文和重写正文）
- 图结构清晰表达整体流程，Agent 逻辑聚焦单一职责

### 5.8 与传统手工编排的对比

| 能力 | LangGraph | 手工编排 |
|---|---|---|
| 状态持久化 | `SqliteSaver` 自动保存每个节点状态 | 手工双写 Context → SQLite |
| 人机交互 | `interrupt()` 原生支持，自动暂停 | 手工 `readline` 判断 |
| 条件分支 | `conditional_edges` 声明式 | `switch/if` 硬编码 |
| 断点恢复 | `checkpointer.getState()` 一行 | 手工加载 DAO → 重建 Context |
| 图可视化 | `graph.get_graph()` 生成图片 | 需要额外工具 |
| 重试机制 | 节点级别 `retry` 配置 | 手工 try/catch |

---

## 6. 上下文管理

### 6.1 LangGraph Checkpoint 替代手工双写

状态持久化完全由 LangGraph 的 `SqliteSaver` 处理，无需手工双写：

- **生成时**：状态在内存的 `GraphState` 中流转
- **每个节点执行后**：`SqliteSaver` 自动将状态写入 SQLite 文件
- **CLI 重启后**：`checkpointer.getState({ thread_id })` 恢复完整状态

### 6.2 Checkpoint 文件路径

`~/.museflow/checkpoints/{story_id}.sqlite`

每创建一个新故事，对应一个独立的 Checkpoint SQLite 文件，重启后直接加载。

### 6.3 共享上下文内容（GraphState）

见 5.2 节 GraphState 定义。

---

## 7. CLI 命令设计

### 7.1 核心命令

```bash
# 启动新故事（指定总章节数）
museflow start --idea "一句话故事简介" --chapters 100 --genre fantasy

# 继续生成下一章
museflow continue

# 继续生成指定章节
museflow continue --chapter 3

# 查看故事状态
museflow status

# 查看故事信息
museflow info

# 导出成品（仅在故事完成后可用）
museflow export --format epub
museflow export --format pdf

# 配置管理
museflow config                    # 交互式配置
museflow config --model openai     # 指定模型
museflow config --show             # 查看当前配置

# 题材管理
museflow genres                    # 查看已安装的所有题材
museflow genres install ./my-genre  # 从本地目录安装自定义题材 Skill
museflow genres uninstall xianxia   # 卸载自定义题材
```

### 7.2 配置管理
通过 `museflow config` 交互式命令管理配置，配置项：
- 模型选择（openai / minimax / local）
- API Key
- 模型参数（temperature、max_tokens 等）
- 输出目录

配置持久化到 `~/.museflow/config.json`。

---

## 8. 项目结构

```
museflow/
├── package.json
├── tsconfig.json
├── README.md
├── docs/
│   └── specs/
│       ├── 2025-04-17-museflow-design.md
│       └── 2025-04-17-museflow-implementation-plan.md
├── src/
│   ├── cli/                       # 命令行入口
│   │   ├── index.ts               # CLI 主入口
│   │   └── commands/
│   │       ├── start.ts           # museflow start
│   │       ├── continue.ts        # museflow continue
│   │       ├── status.ts         # museflow status
│   │       ├── info.ts           # museflow info
│   │       ├── export.ts          # museflow export
│   │       ├── config.ts         # museflow config
│   │       └── genres.ts         # museflow genres
│   ├── graph/                      # LangGraph 图编排
│   │   ├── state.ts               # GraphState 类型定义
│   │   ├── nodes.ts               # 所有节点函数（build_world 等）
│   │   ├── edges.ts               # 条件边（should_continue 等）
│   │   ├── novel.graph.ts         # 图构建 + compile
│   │   └── checkpointer.ts        # SqliteSaver 封装
│   ├── agents/                    # 8 类 Agent（节点函数内部调用）
│   │   ├── base.ts                # Agent 基类
│   │   ├── worldbuilder.ts        # 世界观 Agent
│   │   ├── character.ts           # 人物 Agent
│   │   ├── outline.ts             # 大纲 Agent
│   │   ├── chapter.ts             # 章节 Agent
│   │   ├── quality.ts             # 质量 Agent
│   │   ├── foreshadowing.ts       # 伏笔检测 Agent
│   │   ├── hallucination.ts      # 幻觉检测 Agent
│   │   └── consistency.ts        # 逻辑一致性 Agent
│   ├── core/                      # 核心业务逻辑
│   │   ├── story.ts               # Story 聚合根
│   │   └── runner.ts             # LangGraph Runner（唤醒图执行）
│   ├── genres/                    # 题材 Skill（可扩展）
│   │   ├── base.ts                # GenreSkill 接口定义
│   │   ├── registry.ts            # Skill 注册表（扫描 + 加载）
│   │   ├── builtin/               # 内置 Skill
│   │   │   ├── default/
│   │   │   ├── fantasy/
│   │   │   ├── xianxia/
│   │   │   ├── scifi/
│   │   │   ├── horror/
│   │   │   ├── urban/
│   │   │   └── romance/
│   │   └── custom/               # 用户自定义 Skill（符号链接到 ~/.museflow/genres/）
│   ├── storage/                   # 双存储
│   │   ├── database/
│   │   │   ├── index.ts           # SQLite 连接管理
│   │   │   ├── schema.ts          # 建表 SQL
│   │   │   └── dao/               # Data Access Object
│   │   │       ├── story.ts
│   │   │       ├── chapter.ts
│   │   │       ├── character.ts
│   │   │       └── world.ts
│   │   └── filesystem/
│   │       └── writer.ts          # 章节正文写入 .md 文件
│   ├── model/                     # 模型抽象层
│   │   ├── provider.ts            # Provider 接口
│   │   ├── openai.ts              # OpenAI Provider
│   │   ├── minimax.ts            # MiniMax Provider
│   │   └── local.ts              # 本地模型 Provider
│   ├── types/                     # 共享类型
│   │   ├── story.ts
│   │   ├── chapter.ts
│   │   ├── character.ts
│   │   ├── agent.ts
│   │   └── config.ts
│   └── utils/
│       ├── logger.ts              # 日志工具
│       └── id.ts                  # ID 生成工具
└── tests/
    ├── agents/
    ├── graph/
    ├── core/
    └── storage/
```

---

## 9. 实施计划（待编写）

实施计划将通过 `writing-plans` skill 单独编制。

---

## 10. 已知约束与待确认项

- [x] 模型可配置（已确认）
- [x] 双存储架构（已确认）
- [x] 8 类 Agent 架构（已确认）
- [x] 每章生成后触发伏笔/幻觉/逻辑检测（已确认）
- [x] 上下文内存 + SQLite 双写（已确认）→ **已升级为 LangGraph CheckpointSaver 自动持久化**
- [x] `museflow config` 交互式配置（已确认）
- [x] 章节数量在 `start` 时由用户指定，严格按章节数安排剧情（已确认）
- [x] 重写策略：询问用户确认后再重写（已确认）→ **LangGraph interrupt() 原生支持**
- [x] 输出格式：写作期间 .md，写完后可导出 EPUB 和 PDF（已确认）
- [x] 支持题材类别（Genre Skill）：科幻、玄幻、仙侠、恐怖等各类小说类别（已确认）
- [x] **LangGraph 架构**：使用 LangGraph 进行状态图编排，SqliteSaver 做断点恢复（已确认）

## 11. 题材类别系统（Genre Skill）

### 11.1 概述
MuseFlow 支持通过 Genre Skill 扩展不同小说题材的生成能力。用户通过 `--genre` 参数指定题材，每种题材拥有独立的 Skill 包，内置该题材的：
- 专属术语体系
- 世界观模板
- 叙事风格指南
- 常见情节模式库

### 11.2 内置题材
| 题材 | 说明 |
|---|---|
| `fantasy` | 西方奇幻（剑与魔法、领主、种族） |
| `xianxia` | 仙侠（修真、功法、门派） |
| `scifi` | 科幻（星际、赛博、末日） |
| `horror` | 恐怖（克苏鲁、逃生、心理恐怖） |
| `urban` | 都市（现代都市、异能、商战） |
| `romance` | 言情（情感、校园、都市爱情） |

### 11.3 默认 Skill
当用户未指定 `--genre` 时，使用默认 Skill（`default`），该 Skill 不偏向任何题材，适用于跨类型或混合题材创作。

### 11.4 Genre Skill 结构
每种题材为一个独立 Skill 目录：
```
src/genres/
├── base.ts                    # Genre Skill 基类/接口
├── registry.ts                # Skill 注册表（扫描 + 加载）
├── builtin/                   # 内置 Skill（系统自带）
│   ├── fantasy/
│   │   ├── prompts/           # 题材专用提示词
│   │   ├── templates/         # 世界观模板
│   │   └── index.ts          # Skill 入口
│   ├── xianxia/
│   ├── scifi/
│   ├── horror/
│   ├── urban/
│   └── romance/
└── custom/                    # 用户自定义 Skill（用户安装目录）
    └── ~/.museflow/genres/    # 用户安装的 Skill 放这里
```

### 11.4 Genre Skill 接口
```typescript
interface GenreSkill {
  name: string;                  // 'fantasy'
  displayName: string;           // '西方奇幻'
  version: string;               // '1.0.0'
  worldbuildingPrompt: string;   // 世界观构建专用提示词
  outlineTemplate: string;       // 大纲模板（带占位符）
  chapterPromptSupplement: string; // 章节生成提示词补充
  tropes: string[];             // 该题材常见套路列表
}
```

### 11.5 Skill 加载优先级
用户自定义 Skill > 内置 Skill（同名时用户自定义覆盖内置）。

### 11.6 题材扩展机制
- **内置题材**：系统自带 6 种（fantasy / xianxia / scifi / horror / urban / romance）
- **自定义题材**：用户可通过 `museflow genres install <path>` 安装本地 Skill 目录到 `~/.museflow/genres/`
- 新题材只需在对应目录放置 `index.ts` 声明 Skill 接口，系统启动时自动扫描并注册所有可用题材，无需修改核心代码
