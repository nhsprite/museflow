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

# 类型检查
npm run typecheck

# 运行测试
npm test

# 启动新故事
npm run dev -- start --idea "一个少年获得修真能力后崛起为最强者的故事" --chapters 100 --genre xianxia

# 继续生成下一章
npm run dev -- continue

# 查看状态
npm run dev -- status
```

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

## 开发

```bash
# 监听模式运行测试
npm run test:watch

# 开发模式（tsx watch）
npm run dev
```
