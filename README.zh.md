# MuseFlow

> AI Native 长篇小说生成工具 — 端到端 AI 写作助手

MuseFlow 是一款本地运行的 CLI 工具，用户输入一句话故事简介，AI 自动完成从世界观构建、大纲生成到逐章正文撰写的全部工作，最终输出完整可读的长篇小说。

## 核心特性

- **LangGraph 状态图编排**：多 Agent 协同，支持断点恢复和人工确认重写
- **10 类专业 Agent**：世界观、人物、故事弧线、即时章节大纲、章节规划、正文、伏笔、一致性、修复、摘要
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

如果质量检查发现错误，会提示重写：

```bash
# 彻底重写当前章节
museflow rewrite <story-id>
```

`write` 命令内部已包含自动重试机制（最多 3 次），如果仍无法通过质量检查，则需要手动运行 `rewrite` 进行彻底重写。

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
write → 即时大纲 → 章节规划 → 草稿 → 伏笔/一致性综合校验 → 修复或重写
              ↓
        ┌─────┴─────┐
        ↓           ↓
    通过          发现问题
        ↓           ↓
    下一章      rewrite
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
| 恐怖 | `horror` | 惊悚、灵异 |
| 悬疑 | `mystery` | 推理、侦探、解谜 |
| 都市 | `urban` | 现代都市、职场 |
| 浪漫 | `romance` | 言情、爱情 |
| 默认 | `default` | 通用题材 |

## Agent 系统

MuseFlow 使用 10 类专业 Agent 协同工作：

| Agent | 职责 |
|-------|------|
| **WorldBuilder** | 构建世界观、历史背景、社会结构 |
| **Character** | 生成人物设定、性格、关系网 |
| **StoryArc** | 生成幕结构、mandatory beats 和全局关键情节点 |
| **ChapterOutline** | 在每章动笔前即时生成具体章节大纲 |
| **ChapterPlanner** | 生成章节段落规划、时间锚点和前章差事处理方案 |
| **Chapter** | 撰写章节正文，保持风格和状态一致 |
| **Foreshadowing** | 从正文中检测伏笔创建与回收 |
| **Consistency** | 检查跨章节逻辑、设定和大纲遵循问题 |
| **Fix** | 对可修复问题进行句子级、段落级或整章修复 |
| **Summary** | 生成章节摘要并提取权威事实、任务和状态更新 |

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
├── agents/        # 10 类 Agent 实现
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
运行 `rewrite` 命令重写当前章节：
```bash
museflow rewrite <story-id>  # 彻底重写
```

## 架构说明

详见 [设计文档](./docs/specs/2025-04-17-museflow-design.md) 和 [实施计划](./docs/specs/2025-04-17-museflow-implementation-plan.md)。

## License

MIT
