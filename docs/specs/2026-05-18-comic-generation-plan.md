# MuseFlow AI 漫画生成系统规划

> 基于 MuseFlow 生成的小说自动创作 AI 漫画
> 版本: v1.0
> 日期: 2026-05-18

## 1. 功能概述

将 MuseFlow 生成的长篇小说自动转化为 AI 漫画。系统读取小说的世界观、角色设定、章节内容，通过多 Agent 协作生成完整的分镜脚本和画面，最终输出可阅读的漫画页面。

### 核心能力
- **智能分镜**：将章节文本自动拆解为漫画分镜（面板）
- **角色一致**：同一角色在所有画面中保持视觉一致性
- **画面生成**：调用 AI 图像 API 生成每格画面
- **自动排版**：将画面和对话气泡组合成标准漫画页面
- **渐进生成**：支持按章节/按卷生成，随时中断和恢复

### 输出格式
```
books/{storyId}/
├── comics/
│   ├── characters/          # 角色视觉参考图
│   │   ├── 林逸秋.png
│   │   └── 沈墨白.png
│   ├── chapter_1/
│   │   ├── storyboard.json  # 分镜脚本
│   │   ├── panels/          # 单张面板图片
│   │   │   ├── panel_01.png
│   │   │   └── panel_02.png
│   │   └── pages/           # 排版好的漫画页面
│   │       ├── page_01.png
│   │       └── page_02.html # 可选：可交互版本
│   └── manifest.json        # 漫画元数据
```

---

## 2. 数据输入分析

### 2.1 MuseFlow 现有输出

| 数据源 | 路径 | 用途 |
|--------|------|------|
| 故事元数据 | `meta.json` | 标题、题材、总章节数 |
| 世界观 | `meta.json → world` | 场景描述、时代背景、氛围 |
| 角色列表 | `meta.json → characters` | 姓名、外貌描述、服装、气质 |
| 章节大纲 | `meta.json → outline` | 每章标题、核心事件 |
| 章节正文 | `chapters/chapter_{n}.md` | 完整叙事文本、对话、动作 |

### 2.2 章节文本特征

MuseFlow 的章节 Markdown 结构：
```markdown
# 第1章 永宁城外

## 一、荒草萋萋入城路

[环境描写段落]

"对话内容"

[动作描写段落]

## 二、标题
...
```

**特点**：
- 按场景分段（二级标题分隔不同场景）
- 对话使用中文引号 `"` 包裹
- 环境描写和动作描写交替出现
- 每章长度约 3000-8000 字

---

## 3. 系统架构

### 3.1 模块设计

```
src/
├── comic/                          # 漫画生成核心模块
│   ├── types.ts                    # 漫画相关类型定义
│   ├── storyboard.ts               # 分镜脚本生成引擎
│   ├── character-ref.ts            # 角色视觉参考管理
│   ├── panel-generator.ts          # 单面板画面生成
│   ├── layout.ts                   # 页面排版引擎
│   └── manifest.ts                 # 漫画元数据管理
├── agents/
│   └── comic/                      # 漫画专用 Agent
│       ├── storyboard.ts           # 分镜脚本 Agent
│       └── character-visual.ts     # 角色视觉 Agent
├── model/
│   └── image-provider.ts           # 图像生成 Provider 抽象
└── cli/commands/
    └── comic.ts                    # CLI 命令入口
```

### 3.2 新增类型定义 (`src/comic/types.ts`)

```typescript
// 分镜面板
export interface ComicPanel {
  id: string
  sequence: number           // 在章节中的顺序
  scene: string              // 所属场景（对应二级标题）
  
  // 视觉描述
  visual: {
    description: string      // 画面内容描述（用于图像生成 prompt）
    setting: string          // 场景/环境
    characters: string[]     // 出现的角色名称
    mood: string             // 氛围（紧张、温馨、恐怖等）
    angle: string            // 镜头角度（特写、全景、俯视等）
    lighting: string         // 光线效果
  }
  
  // 文本内容
  text: {
    narration?: string       // 旁白/叙述文字
    dialogues: Dialogue[]    // 对话气泡
    soundEffects?: string[]  // 拟声词
  }
  
  // 生成结果
  generated?: {
    imagePath: string        // 生成的图片路径
    width: number
    height: number
  }
}

export interface Dialogue {
  character: string          // 说话角色
  content: string            // 对话内容
  bubbleStyle: 'normal' | 'shout' | 'whisper' | 'thought'
  position: 'left' | 'right' | 'center'  // 在画面中的大致位置
}

// 角色视觉参考
export interface CharacterVisualRef {
  characterId: string
  characterName: string
  prompt: string             // 生成该角色的核心 prompt
  seed?: number              // 随机种子（用于一致性）
  referenceImages: string[]  // 参考图路径
  style: string              // 画风描述
}

// 漫画页面
export interface ComicPage {
  pageNumber: number
  panels: ComicPanel[]
  layout: PageLayout
}

export interface PageLayout {
  rows: number
  columns: number
  panelPositions: Array<{
    panelId: string
    x: number      // 百分比
    y: number
    width: number
    height: number
  }>
}

// 漫画生成配置
export interface ComicConfig {
  style: 'manga' | 'manhua' | 'webtoon' | 'american'
  quality: 'sketch' | 'standard' | 'premium'
  panelsPerChapter: number   // 每章面板数（默认 15-20）
  pageSize: 'a4' | 'b5' | 'phone'
  colorMode: 'color' | 'grayscale' | 'bw'
}
```

---

## 4. 工作流程

### 4.1 完整流程

```
┌─────────────────────────────────────────────────────────────┐
│  CLI: museflow comic <story-id> --chapter 1                  │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  1. 加载故事数据                                            │
│     - meta.json (角色、世界观、大纲)                         │
│     - chapter_1.md (章节正文)                               │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  2. CharacterVisualAgent: 角色视觉化                        │
│     - 检查 comics/characters/ 下是否已有参考图              │
│     - 如无：根据角色描述生成角色设定图                       │
│     - 保存参考图和生成参数                                   │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  3. ComicStoryboardAgent: 生成分镜脚本                       │
│     - 分析章节文本结构                                       │
│     - 提取场景、对话、动作                                   │
│     - 生成 ComicPanel[] 数组                                │
│     - 确定镜头角度、氛围、角色位置                           │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  4. PanelGenerator: 生成面板画面                             │
│     - 遍历每个 ComicPanel                                   │
│     - 组合 prompt: 场景 + 角色 + 角度 + 氛围 + 画风         │
│     - 调用 ImageProvider 生成图片                            │
│     - 保存到 panels/ 目录                                    │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  5. LayoutEngine: 页面排版                                   │
│     - 将面板分配到页面                                       │
│     - 确定每页布局（网格/自由）                              │
│     - 添加对话气泡和旁白                                     │
│     - 输出 PNG/HTML                                         │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  6. 生成 manifest.json                                      │
│     - 记录生成参数、进度、版本                               │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 分镜脚本生成策略

**输入**：章节 Markdown 文本（约 3000-8000 字）
**输出**：15-20 个 ComicPanel

**分镜规则**：
1. **场景转换 = 新面板**：二级标题切换时生成新面板
2. **对话密度控制**：连续对话合并到同一面板（最多 2-3 句）
3. **动作描写提取**：关键动作生成独立面板
4. **氛围面板**：环境描写生成无对话的氛围面板
5. **节奏控制**：紧张场景增加面板密度，过渡场景减少

**Agent Prompt 示例**：
```
你是一位资深漫画分镜师。请将以下小说章节转化为漫画分镜脚本。

要求：
- 生成 15-20 个面板
- 每个面板包含：画面描述、镜头角度、氛围、对话
- 画面描述要简洁具体，适合 AI 图像生成
- 保持叙事节奏：开头慢、冲突紧、结尾留悬念
- 角色外貌参考：{character_refs}

画风：{style}
```

---

## 5. 角色一致性方案

这是 AI 漫画生成**最大的技术难点**。

### 5.1 方案对比

| 方案 | 原理 | 优点 | 缺点 | 成本 |
|------|------|------|------|------|
| **A. Midjourney CREF** | 使用 `--cref URL` 引用角色图 | 简单、效果好 | 仅限 MJ、需要订阅 | 高 |
| **B. Stable Diffusion + LoRA** | 训练角色 LoRA | 最稳定、可控 | 需要训练时间、技术门槛 | 中 |
| **C. IP-Adapter** | 使用参考图引导生成 | 无需训练、灵活 | 一致性不如 LoRA | 低 |
| **D. Prompt Engineering** | 精细化角色描述 prompt | 零成本 | 一致性差、需要大量调优 | 低 |
| **E. 种子固定 + 风格固化** | 固定 seed + 统一画风 prompt | 简单 | 姿势变化时一致性下降 | 低 |

### 5.2 推荐架构：分层一致性

采用**多层保障**策略：

```
第一层：核心参考图
├── 为每个角色生成 3-5 张参考图（正面、侧面、半身、表情）
└── 使用统一的画风 prompt 和种子范围

第二层：Prompt 模板
├── 角色基础描述（外貌、服装、气质）固定
├── 场景、动作、表情动态变化
└── 画风关键词全局统一

第三层：后处理校验
├── 生成后检测角色特征是否匹配
├── 不一致时重试或标记人工审核
└── 可选：使用面部识别/CLIP 对比相似度
```

### 5.3 角色参考图生成流程

```
输入：角色 description（来自 meta.json characters）
  │
  ▼
CharacterVisualAgent 生成图像 prompt：
  "A character reference sheet of [角色名], [外貌描述], 
   wearing [服装描述], [气质描述], 
   multiple angles, front view, side view, 
   [画风关键词], 
   character design, concept art, 
   --ar 3:2 --v 6"
  │
  ▼
生成 3-5 张参考图 → 保存到 comics/characters/{角色名}/
  │
  ▼
提取核心 prompt 特征 → 保存到 character-ref.json
```

---

## 6. 技术选型

### 6.1 图像生成 Provider

设计类似 MuseFlow ModelProvider 的抽象：

```typescript
// src/model/image-provider.ts
export interface ImageProvider {
  generate(options: GenerateOptions): Promise<Buffer>
}

export interface GenerateOptions {
  prompt: string
  negativePrompt?: string
  width: number
  height: number
  seed?: number
  referenceImage?: string  // 角色参考图路径
  style?: string
}
```

**支持的 Provider**：

| Provider | 推荐场景 | 角色一致性 | 中文支持 | 成本 |
|----------|----------|-----------|----------|------|
| **Midjourney** | 高质量成品 | CREF 优秀 | 一般 | 高 |
| **Stable Diffusion (API)** | 自定义需求 | LoRA/IP-Adapter | 好 | 低 |
| **DALL-E 3** | 快速原型 | 一般 | 好 | 中 |
| **MiniMax 图像** | 国内接入 | 一般 | 优秀 | 中 |
| **豆包/火山引擎** | 国内接入 | 一般 | 优秀 | 中 |
| **Recraft** | 矢量/平面风格 | 一般 | 一般 | 中 |

**默认推荐**：
- 海外用户：Midjourney（质量优先）或 SD API（成本优先）
- 国内用户：MiniMax 或豆包（接入便利）

### 6.2 排版引擎

**方案 A：Canvas/Sharp 纯代码排版**（推荐）
- 使用 Node.js Canvas 或 Sharp 库
- 将图片裁剪、拼接、添加文字
- 优点：完全可控、无外部依赖
- 缺点：需要处理字体、文字换行

**方案 B：HTML + Puppeteer 截图**
- 生成 HTML 页面，用 CSS Grid/Flex 布局
- Puppeteer 截图输出 PNG/PDF
- 优点：布局灵活、可交互
- 缺点：依赖 Chromium

**方案 C：专业漫画软件集成**
- Clip Studio Paint / Photoshop 脚本
- 优点：专业效果
- 缺点：平台限制、无法自动化

### 6.3 依赖库

```json
{
  "dependencies": {
    "canvas": "^2.11.2",        // 图像合成
    "sharp": "^0.33.0",         // 图像处理
    "puppeteer": "^22.0.0",     // HTML 转图片（可选）
    "fs-extra": "^11.2.0"       // 文件操作
  }
}
```

---

## 7. CLI 设计

### 7.1 命令

```bash
# 生成指定章节的漫画
museflow comic <story-id> --chapter 1

# 生成多个章节
museflow comic <story-id> --chapters 1-5

# 生成全部章节
museflow comic <story-id> --all

# 指定画风
museflow comic <story-id> --chapter 1 --style manga

# 指定质量等级
museflow comic <story-id> --chapter 1 --quality standard

# 仅生成分镜脚本（不生成图片）
museflow comic <story-id> --chapter 1 --storyboard-only

# 重新生成角色参考图
museflow comic <story-id> --regenerate-characters
```

### 7.2 配置

```bash
# 配置图像生成 Provider
museflow comic config set --provider midjourney --api-key xxx

# 查看配置
museflow comic config show
```

---

## 8. 实现优先级

### Phase 1: MVP（最小可用版本）
**目标**：生成单章漫画，基本可用

- [ ] `ComicStoryboardAgent` 分镜生成
- [ ] `CharacterVisualAgent` 角色参考生成
- [ ] 基础 `ImageProvider` 接口 + 1 个实现（如 DALL-E）
- [ ] 基础 `LayoutEngine`（网格布局 + 文字叠加）
- [ ] CLI 命令 `museflow comic --chapter`

**预期输出**：每章 10-15 张图 + 简单排版

### Phase 2: 质量提升
- [ ] 角色一致性优化（参考图机制）
- [ ] 多种画风支持（manga/manhua/webtoon）
- [ ] 复杂布局（自由布局、跨页）
- [ ] 拟声词和特效文字
- [ ] 支持更多 ImageProvider

### Phase 3: 完整体验
- [ ] 连续章节生成（批量）
- [ ] 交互式 HTML 版本
- [ ] PDF/EPUB 导出
- [ ] 人工编辑接口（修改分镜、替换图片）
- [ ] 增量更新（修改章节后只更新变化部分）

---

## 9. 风险与限制

### 9.1 技术风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| **角色一致性差** | 高 | 多层保障 + 参考图机制 + 后处理校验 |
| **API 成本过高** | 高 | 质量分级、缓存机制、provider 切换 |
| **生成速度慢** | 中 | 异步并行、断点续传、进度显示 |
| **中文排版复杂** | 中 | 使用支持中文的 Canvas 库、预留字体配置 |
| **长文本理解** | 低 | 分块处理、上下文摘要 |

### 9.2 成本估算

以每章 15 个面板计算：

| Provider | 单价/张 | 每章成本 | 30章全书 |
|----------|---------|----------|----------|
| DALL-E 3 | $0.04 | $0.60 | $18 |
| Midjourney | ~$0.03 | $0.45 | $13.5 |
| SD API (本地) | $0 | $0 | $0 |
| 国内 API | ~¥0.1 | ¥1.5 | ¥45 |

**建议**：提供 `--quality` 参数，草图模式用于预览，标准模式用于成品。

### 9.3 法律和版权

- AI 生成图片的版权归属因平台而异
- 建议在使用前查看各 Provider 的服务条款
- 提供免责声明，明确标注 AI 生成内容

---

## 10. 与现有架构的集成点

### 10.1 复用现有能力

| 现有模块 | 复用方式 |
|----------|----------|
| `ModelProvider` | 新增 `ImageProvider` 遵循相同设计模式 |
| `config/store.ts` | 扩展配置存储图像生成 API key |
| `storage/database/story-dao.ts` | 扩展记录漫画生成状态 |
| `utils/spinner.ts` | 复用进度显示 |
| `utils/logger.ts` | 复用日志系统 |

### 10.2 最小化侵入

- 不修改现有小说生成流程
- 漫画生成作为独立的 CLI 命令
- 读取现有 `meta.json` 和章节文件，不修改原始数据
- 输出到新的 `comics/` 目录，与小说数据隔离

---

## 附录 A: Prompt 模板示例

### 分镜生成 Prompt

```
你是一位资深漫画分镜师，擅长将小说转化为视觉叙事。

请将以下章节内容转化为漫画分镜脚本，输出 JSON 格式。

要求：
1. 生成 15-20 个面板（panel）
2. 每个面板包含：
   - visual.description: 画面内容描述（50字以内，适合图像生成）
   - visual.setting: 场景环境
   - visual.characters: 出现的角色
   - visual.mood: 氛围（如：紧张、温馨、恐怖、平静）
   - visual.angle: 镜头角度（特写、中景、全景、俯视、仰视）
   - text.dialogues: 对话列表（最多3句）
   - text.narration: 旁白（可选）
3. 保持叙事节奏：
   - 开头：环境铺垫，2-3个面板
   - 发展：冲突升级，逐渐加快
   - 高潮：最密集的面板切换
   - 结尾：悬念或过渡，1-2个面板
4. 画风关键词：{style}

角色参考：
{character_descriptions}

章节内容：
{chapter_text}
```

### 图像生成 Prompt（角色特写）

```
A manga-style illustration of [角色名], [外貌描述],
wearing [服装描述], [表情/动作],
[场景描述],
[画风关键词],
highly detailed, cinematic lighting, 
--ar 16:9 --niji 6
```

---

## 附录 B: 文件变更清单

### 新增文件
```
src/
├── comic/
│   ├── types.ts
│   ├── storyboard.ts
│   ├── character-ref.ts
│   ├── panel-generator.ts
│   ├── layout.ts
│   └── manifest.ts
├── agents/comic/
│   ├── storyboard.ts
│   └── character-visual.ts
├── model/
│   └── image-provider.ts
├── cli/commands/
│   └── comic.ts
└── tests/comic/
    ├── storyboard.test.ts
    ├── layout.test.ts
    └── character-ref.test.ts
```

### 修改文件
```
src/cli/index.ts          # 注册 comic 命令
src/types/                # 可能需要扩展类型
```

---

*本规划文档基于 MuseFlow v0.1.0 架构设计，实现时可根据实际情况调整优先级。*
