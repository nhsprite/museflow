# MuseFlow

> AI Native 长篇小说生成工具 — 端到端 AI 写作助手

MuseFlow 是一款本地运行的 CLI 工具，用户输入一句话故事简介，AI 自动完成从世界观构建、大纲生成到逐章正文撰写的全部工作，最终输出完整可读的长篇小说。

## 核心特性

- **LangGraph 状态图编排**：多 Agent 协同，支持断点恢复和人工确认重写
- **8 类专业 Agent**：世界观、人物、大纲、章节、质量、伏笔检测、幻觉检测、逻辑一致性
- **题材 Skill 系统**：内置玄幻、仙侠、科幻、恐怖等题材包，支持用户自定义 Skill
- **本地优先**：所有数据存储在本地，模型可配置（OpenAI / MiniMax / 本地模型）
- **断点恢复**：写作过程中断后可随时恢复，无需从头开始
- **质量保障**：每章写完自动进行多维度质量检查，发现问题可针对性修复或重写

## 系统要求

- **Node.js >= 20**
- **npm** 或 **pnpm**
- API Key（OpenAI / MiniMax / 本地 Ollama）

## 安装

```bash
# 克隆项目
git clone <repository-url>
cd museflow

# 安装依赖
npm install

# 编译 TypeScript
npm run build
```

## 快速开始

### 1. 配置模型

首次使用前需要配置 AI 模型：

```bash
# 查看当前配置
npm start -- config show

# 配置 OpenAI
npm start -- config set --provider openai --api-key YOUR_API_KEY --model gpt-4o

# 配置 MiniMax
npm start -- config set --provider minimax --api-key YOUR_API_KEY --model abab6.5s-chat

# 配置本地模型（需先启动 Ollama）
npm start -- config set --provider local --model llama3 --base-url http://localhost:11434/v1
```

配置保存在 `~/.museflow/config.json`。

### 2. 创建故事

```bash
# 启动新故事（仅规划和创建，不写正文）
npm start -- start --idea "一个少年获得修真能力后崛起为最强者的故事" --chapters 30 --genre xianxia
```

此命令会：
1. 构建世界观
2. 生成人物设定
3. 生成章节大纲
4. 保存到 `./books/{story_id}/`

### 3. 撰写正文

```bash
# 撰写当前章节（写完一章后停止）
npm start -- write <story-id>

# 继续撰写下一章
npm start -- write <story-id>
```

### 4. 修复问题

如果质量检查发现错误，会提示修复：

```bash
# 针对性修复当前章节（保留大部分内容，修改问题段落）
npm start -- fix <story-id>

# 彻底重写当前章节（从头重新撰写）
npm start -- rewrite <story-id>
```

**修复策略**：
- **Fix**：适合局部问题（用词重复、描写不足、小逻辑矛盾）。保留 90%+ 内容，只修改相关段落。
- **Rewrite**：适合结构性问题（时间线混乱、人物性格前后矛盾、大纲偏离）。整章重写。

### 5. 查看进度

```bash
# 查看故事进度
npm start -- status <story-id>

# 查看故事详情
npm start -- info <story-id>
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
| `~/.museflow/config.json` | 用户配置（API key、provider 等） |
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
├── model/         # 模型抽象层（OpenAI / MiniMax / Local）
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
确保传入了 story-id：`npm start -- write <story-id>`

### API 调用报错
检查 config 中 api key 和 base url 是否正确，用 `npm start -- config show` 确认。

### 写完一章后提示"需要处理问题"
运行 `rewrite` 或 `fix` 命令处理当前章节：
```bash
npm start -- rewrite <story-id>  # 彻底重写
npm start -- fix <story-id>      # 针对性修复
```

### 为什么 fix 定位到很多段落？
Fix 命令会分析问题所在段落，只修改相关部分。如果问题描述涉及常见词汇（如"轻轻"、"缓缓"），可能会匹配到多个段落。这种情况建议用 `rewrite` 代替。

### 故事写到一半中断了怎么办？
运行 `continue` 命令从断点恢复：
```bash
npm start -- continue <story-id>
```

## 架构说明

详见 [设计文档](./docs/specs/2025-04-17-museflow-design.md) 和 [实施计划](./docs/specs/2025-04-17-museflow-implementation-plan.md)。

## License

MIT
