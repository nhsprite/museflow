# 书名选择 TUI 设计

> 在 `start` 流程的世界观构建阶段，AI 生成多个候选书名 + 世界观方向，用户通过箭头键 TUI 选择后再继续完整规划流程。

## 背景

当前 `start` 命令直接根据 `--idea` 启动完整规划流程，标题由 AI 在世界观构建后自动生成，用户无法干预。

**目标**：在正式构建世界观之前，让 AI 提供 3-5 个候选书名及其世界观方向摘要，用户选择后再继续。

## 交互流程

```
用户执行: museflow start --idea "少年崛起" --chapters 10 --genre xianxia

MuseFlow 输出:
  [MuseFlow] 分析中...
  [MuseFlow] 请选择书名和世界观方向：

  ❯ 1. 《逆天改命》
     修炼体系：凡境→灵境→仙境；散修崛起vs宗门体系
     核心冲突：资源争夺、宗门秘宝
     世界观特色：中土大陆、灵气衰退

    2. 《凡人之躯》
     修炼体系：炼体、炼气、炼神三阶段；无灵根者另辟蹊径
     核心冲突：人与天斗、阶级固化
     世界观特色：偏远山村、世俗王朝

    3. 《破妄之剑》
     修炼体系：剑修为尊；剑意凝兵
     核心冲突：正邪两道、师门恩怨
     世界观特色：万剑山脉、剑冢禁地

    4. 重新生成选项

  [使用 ↑↓ 箭头选择，Enter 确认]
```

用户选择后继续正常流程：
```
  [MuseFlow] 已选择：《逆天改命》
  [MuseFlow] 开始生成世界观...
  ...
```

## 架构设计

### 新增模块

**`src/cli/commands/title-selector.ts`**

```typescript
interface TitleOption {
  title: string
  worldDirection: WorldDirection
}

interface WorldDirection {
  cultivationSystem: string   // 修炼体系
  coreConflict: string        // 核心冲突
  worldFeatures: string[]     // 世界观特色（数组，每项一个要点）
}

/**
 * 调用 AI 生成候选书名 + 世界观方向
 * 返回 3-5 个候选选项
 */
export async function generateTitleOptions(
  idea: string,
  genre: string,
  totalChapters: number
): Promise<TitleOption[]>

/**
 * 展示 TUI 列表供用户选择
 * 返回用户选择的 TitleOption
 */
export async function selectTitleOption(options: TitleOption[]): Promise<TitleOption>
```

### 修改现有代码

**`src/cli/commands/start.ts`**

- 在 `runStory()` 调用之前，先调用 `generateTitleOptions()` 获取候选
- 调用 `selectTitleOption()` 让用户选择
- 将用户选择的 `title` 和 `worldDirection` 传递给 `runStory()`
- 如果用户选择"重新生成"，循环调用 `generateTitleOptions()`

**`src/graph/nodes.ts` - `build_world()` 函数**

- 修改 prompt，要求 AI 返回多个候选（JSON array 格式）
- 新增 `extractTitleOptions()` 方法解析多个候选
- 将 `worldDirection` 附加到 world content 中传递给后续节点

**`src/agents/worldbuilder.ts`**

- 新增 `generateTitleOptions()` 方法替代当前的 single title 生成
- Prompt 需要引导 AI 生成 3-5 个不同风格/角度的书名和对应的世界观方向

## Prompt 设计

Worldbuilder Agent 在标题选择阶段使用的 prompt：

```
你是一位资深的书名策划师。根据以下故事概要，提供 3-5 个候选书名和对应的世界观方向。

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
```

## 数据流

```
start(options)
  ├── generateTitleOptions(idea, genre, chapters)
  │     └── WorldbuilderAgent.generateTitleOptions() → AI 调用
  │           └── 返回 TitleOption[]
  │
  ├── selectTitleOption(options) [TUI]
  │     └── inquirer 箭头键选择
  │           └── 返回用户选择的 TitleOption
  │
  └── runStory({ ..., title: selectedOption.title, worldDirection })
        └── build_world() 使用 worldDirection 辅助生成更精准的世界观
              └── 后续节点正常执行
```

## 依赖

需要新增 `inquirer` 包用于 TUI 交互：

```bash
npm install inquirer
npm install -D @types/inquirer
```

## 错误处理

- **AI 调用失败**：输出错误信息，提示用户重试或退出
- **用户取消选择（Ctrl+C）**：优雅退出，清理状态
- **无效的 AI 输出格式**：回退到默认行为（使用第一个候选或自动选择一个）
- **重新生成达到最大次数**：限制 3 次后强制使用第一个选项

## 测试策略

1. **单元测试**：`generateTitleOptions()` 解析 AI 输出的正确性
2. **集成测试**：模拟完整选择流程
3. **手动测试**：验证 TUI 交互符合预期

## 实现顺序

1. 新增 `inquirer` 依赖
2. 实现 `src/cli/commands/title-selector.ts`
3. 修改 `src/agents/worldbuilder.ts` 的 prompt 和解析逻辑
4. 修改 `src/cli/commands/start.ts` 集成选择流程
5. 添加测试
6. 更新 README 文档（如需要）