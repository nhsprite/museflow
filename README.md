# MuseFlow

> AI Native 长篇小说生成工具 — 端到端 AI 写作助手

MuseFlow 是一款本地运行的 CLI 工具，用户输入一句话故事简介，AI 自动完成从世界观构建、大纲生成到逐章正文撰写的全部工作，最终输出完整可读的长篇小说。

## 核心特性

- **LangGraph 状态图编排**：多 Agent 协同，支持断点恢复和人工确认重写
- **8 类专业 Agent**：世界观、人物、大纲、章节、质量、伏笔检测、幻觉检测、逻辑一致性
- **题材 Skill 系统**：内置玄幻、仙侠、科幻、恐怖等题材包，支持用户自定义 Skill
- **本地优先**：所有数据存储在本地，模型可配置（OpenAI / MiniMax / 本地模型）
- **双存储架构**：JSON 元数据 + 文件系统正文，CLI 重启后完整恢复

## 快速开始

```bash
# 安装依赖
npm install

# 编译 TypeScript
npm run build

# 类型检查
npm run typecheck

# 运行测试
npm test
```

## 配置模型

MuseFlow 支持三种模型 provider，首次使用前需要配置：

```bash
# 查看当前配置
npm start -- config show

# 配置 OpenAI（示例）
npm start -- config set --provider openai --api-key YOUR_API_KEY --model gpt-4o

# 配置 MiniMax（示例）
npm start -- config set --provider minimax --api-key YOUR_API_KEY --model abab6.5s-chat

# 配置本地模型（需先启动 Ollama）
npm start -- config set --provider local --model llama3 --base-url http://localhost:11434/v1
```

配置保存在 `~/.museflow/config.json`。

## 题材

内置以下题材，可通过 `--genre` 指定：

| 题材 | 参数值 |
|------|--------|
| 玄幻 | `xianxia` |
| 科幻 | `scifi` |
| 恐怖 | `horror` |
| 都市 | `urban` |
| 浪漫 | `romance` |
| 默认（通用） | `default` |

## 启动故事

```bash
# 启动新故事（仅规划和创建，不写正文）
npm start -- start --idea "一个少年获得修真能力后崛起为最强者的故事" --chapters 3 --genre xianxia

# 撰写故事正文（写完当前章后停止）
npm start -- write <story-id>

# 重写当前有问题的章节
npm start -- rewrite <story-id>

# 继续一个未完成的故事
npm start -- continue <story-id>

# 查看故事进度
npm start -- status <story-id>

# 查看故事详情
npm start -- info <story-id>
```

`start` 命令创建故事并完成世界观、人物、大纲等规划阶段。`write` 命令撰写正文，每章写完后停止；如果当前章有问题，会提示运行 `rewrite` 重写。`rewrite` 命令专门用于重写有质量问题的章节。`continue` 命令用于从断点恢复继续撰写。

## 项目结构

```
src/
├── cli/           # 命令行入口（start/write/rewrite/continue/status/info/config/genres）
├── graph/         # LangGraph 图编排（状态、节点、边、检查点）
├── agents/        # 8 类 Agent 实现
├── core/          # 核心业务逻辑（Runner）
├── genres/        # 题材 Skill 系统
├── storage/       # 双存储（SQLite + 文件系统）
├── model/         # 模型抽象层
├── types/         # 共享类型
└── utils/         # 工具函数
```

## 架构说明

详见 [设计文档](./docs/specs/2025-04-17-museflow-design.md) 和 [实施计划](./docs/specs/2025-04-17-museflow-implementation-plan.md)。

## 数据存储

故事数据保存在本地 `./books/` 目录下：

| 路径 | 内容 |
|------|------|
| `~/.museflow/config.json` | 用户配置（API key、provider 等） |
| `./books/{story_id}/meta.json` | 故事元数据（JSON 文件） |
| `./books/{story_id}/checkpoints/` | LangGraph checkpoint JSON 文件 |
| `./books/{story_id}/chapter_{n}.md` | 各章正文 `.md` 文件 |

## 常见问题

**`write` 没有反应**  
确保传入了 story-id：`npm start -- write <story-id>`

**API 调用报错**  
检查 config 中 api key 和 base url 是否正确，用 `npm start -- config show` 确认。

**写完一章后提示"需要处理问题"**  
运行 `rewrite` 命令重写当前章节：`npm start -- rewrite <story-id>`

## 开发

```bash
# 监听模式运行测试
npm run test:watch

# 开发模式（tsx watch）
npm run dev
```
