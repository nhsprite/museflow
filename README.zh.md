# MuseFlow

> AI Native 长篇小说生成工具 — 端到端 AI 写作助手

MuseFlow 是一款本地运行的 CLI 工具，用户输入一句话故事简介，AI 自动完成从世界观构建、大纲生成到逐章正文撰写的全部工作，最终输出完整可读的长篇小说。

## 核心特性

- **LangGraph 状态图编排**：多 Agent 协同，支持断点恢复和人工确认重写
- **10 类专业 Agent**：世界观、人物、故事弧线、即时章节大纲、章节规划、正文、伏笔、一致性、修复、摘要
- **题材 Skill 系统**：内置西方奇幻、仙侠、科幻、恐怖、悬疑、都市、浪漫和默认题材，支持自定义 JSON 题材 Skill
- **本地优先**：故事状态、checkpoint、章节正文、报告和导出文件都写入本地文件系统
- **模型可配置**：支持 OpenAI 兼容和 Anthropic 兼容协议；`minimax`、`local` 会按 OpenAI 兼容协议处理
- **断点恢复**：写作过程中断后可随时恢复，无需从头开始
- **质量保障**：每章写完自动进行字数、连续性、伏笔、一致性、大纲和质量维度检查，发现问题可针对性修复或重写

## 系统要求

- **Node.js >= 20**
- **npm** 或兼容包管理器
- OpenAI 兼容或 Anthropic 兼容服务的 API Key

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

# 可选：编译 TypeScript 到 dist/
npm run build

# 日常开发直接通过 tsx 运行，不需要先 build
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

# 可选：允许 mandatory beats 空间不足时自动延长幕边界
museflow config set --auto-adjust-act-boundaries true
```

CLI 写入的配置保存在当前项目目录下的 `.museflow/config.json`。项目级配置优先于可选的全局兜底配置 `~/.museflow/config.json`。

### 2. 创建故事

```bash
# 启动新故事（仅规划和创建，不写正文）
museflow start --idea "一个少年获得修真能力后崛起为最强者的故事" --chapters 30 --genre xianxia
```

此命令会：

1. 生成书名和世界观方向选项（`--yes` 会自动选择第一个）
2. 构建世界观
3. 生成人物设定
4. 生成故事弧线和空的逐章大纲脚手架
5. 保存到 `./books/{story-dir}/`
6. 写入 `outline.md`、`story_bible.md`、`meta.json` 和初始 checkpoint

### 3. 撰写正文

```bash
# 撰写当前章节（写完一章后停止）
museflow write <story-id>

# 再次运行同一命令撰写下一章
museflow write <story-id>

# 从最新 checkpoint 恢复，或处理待确认的 rewrite 请求
museflow continue <story-id>
```

### 4. 修复问题

如果检查无法通过正常草稿/修复路由收敛，MuseFlow 会写入报告并提示重写：

```bash
# 彻底重写当前章节
museflow rewrite <story-id>
```

`write` 命令可能会自动重试草稿或应用局部修复。如果结构性问题、状态冲突或重复错误仍然存在，则需要手动运行 `rewrite` 进行彻底重写。

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
write → 准备章节 → 决策 → 即时大纲 → 章节规划 → 草稿/修复
              ↓
        伏笔/连续性/一致性/质量综合校验 → 决策
              ↓
        ┌─────┴─────┐
        ↓           ↓
    finalize     rewrite / blocking report
        ↓
    章节提交边界 → 下一章
```

## 命令参考

全局选项：`museflow --debug <command>` 会输出 LLM 会话调试信息。

| 命令                                                          | 说明                                                                |
| ------------------------------------------------------------- | ------------------------------------------------------------------- |
| `start --idea <text> --chapters <n> [--genre <name>] [--yes]` | 创建新故事规划：书名/世界方向、世界观、人物、故事弧线和空章节脚手架 |
| `write <id>`                                                  | 撰写当前章节，每次只写一章                                          |
| `continue <id> [-y                                            | -n]`                                                                | 从最新 checkpoint 恢复，并可自动接受/拒绝待确认的 rewrite 请求 |
| `rewrite <id> [--chapter <n>]`                                | 彻底重写当前或指定章节；下游章节文件由代码截断                      |
| `status <id>`                                                 | 查看进度、待处理问题、世界观状态和伏笔状态                          |
| `info <id>`                                                   | 查看故事元数据、题材信息、状态预览和存储路径                        |
| `list` / `ls`                                                 | 列出 `books/` 下的所有本地书籍                                      |
| `delete <id> --force`                                         | 删除本地书籍目录；需要显式 `--force`                                |
| `adjust-act <id> --act <n> --end-chapter <n>`                 | mandatory beats 空间不足时手动调整幕边界                            |
| `export <id>`                                                 | 导出已写章节为 `output/` 下的 `.txt` 文件，并启动临时二维码下载服务 |
| `config [show                                                 | set                                                                 | get]`                                                          | 管理模型和运行配置 |
| `genres [list                                                 | install                                                             | uninstall                                                      | info]`             | 查看、安装、卸载或检查题材 Skill |

## 题材

内置以下题材，可通过 `--genre` 指定：

| 题材     | 参数值    | 说明               |
| -------- | --------- | ------------------ |
| 西方奇幻 | `fantasy` | 魔法、史诗、冒险   |
| 玄幻     | `xianxia` | 修真、仙侠、武侠   |
| 科幻     | `scifi`   | 未来科技、太空冒险 |
| 恐怖     | `horror`  | 惊悚、灵异         |
| 悬疑     | `mystery` | 推理、侦探、解谜   |
| 都市     | `urban`   | 现代都市、职场     |
| 浪漫     | `romance` | 言情、爱情         |
| 默认     | `default` | 通用题材           |

## Agent 系统

MuseFlow 使用 10 类专业 Agent 协同工作：

| Agent              | 职责                                         |
| ------------------ | -------------------------------------------- |
| **WorldBuilder**   | 构建世界观、历史背景、社会结构               |
| **Character**      | 生成人物设定、性格、关系网                   |
| **StoryArc**       | 生成幕结构、mandatory beats 和全局关键情节点 |
| **ChapterOutline** | 在每章动笔前即时生成具体章节大纲             |
| **ChapterPlanner** | 生成章节段落规划、时间锚点和前章差事处理方案 |
| **Chapter**        | 撰写章节正文，保持风格和状态一致             |
| **Foreshadowing**  | 从正文中检测伏笔创建与回收                   |
| **Consistency**    | 检查跨章节逻辑、设定和大纲遵循问题           |
| **Fix**            | 对可修复问题进行句子级、段落级或整章修复     |
| **Summary**        | 生成章节摘要并提取权威事实、任务和状态更新   |

## 数据存储

故事数据保存在本地 `./books/` 目录下。具体故事目录由书名和 ID 后缀组成，例如 `books/my-title-abc123def456/`。

| 路径                                                  | 内容                                         |
| ----------------------------------------------------- | -------------------------------------------- |
| `./.museflow/config.json`                             | `museflow config set` 写入的项目级配置       |
| `~/.museflow/config.json`                             | 可选的全局兜底配置                           |
| `./books/{story-dir}/checkpoints/latest.json`         | 指向最新 LangGraph checkpoint                |
| `./books/{story-dir}/checkpoints/*.json`              | LangGraph checkpoint JSON 文件；运行时真相源 |
| `./books/{story-dir}/meta.json`                       | 从最新 checkpoint 导出的 CLI 展示/检查投影   |
| `./books/{story-dir}/outline.md`                      | 故事弧线和即时生成章节大纲的人类可读投影     |
| `./books/{story-dir}/story_bible.md`                  | 初始世界观、人物和章节脚手架参考             |
| `./books/{story-dir}/chapters/chapter_{n}.md`         | 各章正文 `.md` 文件                          |
| `./books/{story-dir}/reports/chapter_{n}.report.json` | 每章生成报告                                 |
| `./books/{story-dir}/reports/blocking_*.json`         | 重写收敛失败时的人工处理报告                 |
| `./output/*.txt`                                      | `museflow export` 生成的导出稿               |

> **注意**：MuseFlow 使用 JSON + 文件系统存储，不依赖 SQLite。
> Checkpoint 是权威状态；`meta.json`、`outline.md`、报告和导出文件都是由代码生成的投影/产物。

## 运行时架构

- `src/graph/novel.graph.ts` 负责 LangGraph 状态机。
- `src/core/runner.ts` 构建初始/工作状态并调用 graph。
- `src/core/chapter-commit.ts` 是 graph 运行后的章节提交边界：在 LangGraph 持久化最终 checkpoint 后保存章节 marker，并导出 `meta.json`。
- `src/core/outline-expander.ts` 在动笔前即时生成当前章大纲和 `ChapterPlan`，使用故事弧线进度、前文摘要、故事状态和下一章边界提示。
- `src/graph/services/chapter-orchestration/` 负责准备章节状态和收敛感知路由。
- `src/core/chapter-generation/routing/` 决定当前章应草稿、局部修复、finalize，还是停止等待人工 rewrite。
- `src/graph/services/finalization/` 提取摘要/状态/权威事实，验证 mandatory beats，更新幕进度并写入报告。
- `verifiedConstraints` 在运行时是结构化对象，只在传入 agent prompt 时渲染为文本。
- `meta.json`、`outline.md` 和报告是投影/产物；checkpoint state 才是运行时权威记录。

## 项目结构

```
src/
├── cli/           # 命令行入口（所有命令的实现）
├── graph/         # LangGraph 图编排（状态、节点、边、检查点）
├── agents/        # 10 类 Agent 实现
├── core/          # Runner、章节提交边界、即时大纲扩展、路由策略
├── genres/        # 题材 Skill 系统
├── storage/       # JSON 元数据 + 文件系统存储
├── config/        # 项目/全局配置加载与保存
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

运行 `rewrite` 命令重写当前章节：

```bash
museflow rewrite <story-id>  # 彻底重写
```

### 故事文件在哪里？

运行 `museflow info <story-id>` 查看“存储路径”。故事目录使用所选书名加 ID 后缀命名，不是裸 story id。

## 架构说明

详见 [Current Runtime Architecture](./docs/specs/2026-07-04-current-runtime-architecture.md)。2025 年的设计文档和实施计划是历史参考，仍描述早期 SQLite 与线性 Agent 方案。

## License

MIT
