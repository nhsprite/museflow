import type { GenreSkill } from '../../../types/genre.js'

export function createDefaultSkill(): GenreSkill {
  return {
    name: 'default',
    displayName: '默认（通用）',
    version: '1.0.0',
    worldbuildingPrompt: `请为以下故事构建一个中立通用的世界观设定。
故事简介：{idea}
总章节数：{totalChapters}

请输出一份结构化的世界观文档，包含：
1. 背景设定（时间、地点、社会结构）
2. 主要势力或阵营
3. 核心规则或法则
4. 文化与技术水平
5. 可能的冲突来源`,
    outlineTemplate: `根据以下信息，为一部 {totalChapters} 章的小说制定大纲。

题材：通用（不限定具体类型）
故事简介：{idea}

请按章节顺序列出每一章的：
- 章节标题
- 本章核心事件
- 预计篇幅

严格生成 exactly {totalChapters} 个章节。`,
    chapterPromptSupplement: ``,
    tropes: [],
  }
}
