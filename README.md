# MuseFlow

> AI Native 长篇小说生成工具 — 端到端 AI 写作助手

MuseFlow 是一款本地运行的 CLI 工具，用户输入一句话故事简介，AI 自动完成从世界观构建、大纲生成到逐章正文撰写的全部工作，最终输出完整可读的长篇小说。

## 核心特性

- **LangGraph 状态图编排**：多 Agent 协同，支持断点恢复和人工确认重写
- **8 类专业 Agent**：世界观、人物、大纲、章节、质量、伏笔检测、幻觉检测、逻辑一致性
- **题材 Skill 系统**：内置玄幻、仙侠、科幻、恐怖等题材包，支持用户自定义 Skill
- **本地优先**：所有数据存储在本地，模型可配置（OpenAI / MiniMax / 本地模型）
- **双存储架构**：SQLite 元数据 + 文件系统正文，CLI 重启后完整恢复

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
npm run dev -- config --show

# 配置 OpenAI（示例）
npm run dev -- config --set --provider openai --api-key YOUR_API_KEY --model gpt-4o

# 配置 MiniMax（示例）
npm run dev -- config --set --provider minimax --api-key YOUR_API_KEY --model abab6.5s-chat

# 配置本地模型（需先启动 Ollama）
npm run dev -- config --set --provider local --model llama3 --base-url http://localhost:11434/v1
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
# 启动新故事（示例：3章，仙侠题材）
npm run dev -- start --idea "一个少年获得修真能力后崛起为最强者的故事" --chapters 3 --genre xianxia

# 继续生成（从断点恢复，或处理重写确认）
npm run dev -- continue <story-id>

# 自动确认重写（不询问直接重写）
npm run dev -- continue <story-id> --yes

# 自动跳过重写（不重写直接继续下一章）
npm run dev -- continue <story-id> --no

# 查看故事状态
npm run dev -- status <story-id>

# 查看故事详情
npm run dev -- info <story-id>
```

`start` 命令会创建故事并从世界观构建开始自动跑完规划阶段，然后在每章生成后停顿等待确认。故事 ID 会输出在终端。后续用 `continue` 继续。

## 项目结构

```
src/
├── cli/           # 命令行入口
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

故事数据保存在本地，目录位于 `~/.museflow/`：

| 路径 | 内容 |
|------|------|
| `~/.museflow/config.json` | 用户配置（API key、provider 等） |
| `~/.museflow/outputs/{story_id}/chapters/` | 各章正文 `.md` 文件 |
| `~/.museflow/checkpoints/` | SQLite 断点恢复文件 |

## 常见问题

**`continue` 没有反应**  
确保传入了 story-id：`npm run dev -- continue <story-id>`

**API 调用报错**  
检查 config 中 api key 和 base url 是否正确，用 `npm run dev -- config --show` 确认。

**故事停在"等待重写确认"**  
用 `--yes` 自动重写，或 `--no` 跳过重写继续下一章。

## 开发

```bash
# 监听模式运行测试
npm run test:watch

# 开发模式（tsx watch）
npm run dev
```
