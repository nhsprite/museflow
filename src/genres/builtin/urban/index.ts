import type { GenreSkill } from '../../../types/genre.js'

export function createUrbanSkill(): GenreSkill {
  return {
    name: 'urban',
    displayName: '都市',
    version: '1.0.0',
    worldbuildingPrompt: `请为以下都市故事构建世界观。
故事简介：{idea}
总章节数：{totalChapters}

请以以下JSON格式返回（title 为必填字段，不可省略）：
{
  "title": "书名",
  "world": "世界观详细设定内容"
}

其中 world 字段应包含以下内容：
1. 现代都市背景设定
2. 社会阶层与职场/校园环境
3. 特殊能力或异能设定（如有）
4. 重要人物关系网络
5. 核心冲突来源`,
    outlineTemplate: `为一部 {totalChapters} 章的都市小说制定大纲。

故事简介：{idea}

请按章节顺序列出每一章的：
- 章节标题
- 本章核心事件
- 人物关系变化

严格生成 exactly {totalChapters} 个章节。`,
    chapterPromptSupplement: `你是一位擅长都市风格的作家。请特别注意：
- 语言贴近现代都市生活
- 描写职场、校园或社交场景
- 情感细腻，节奏明快
- 角色塑造贴近现实`,
    tropes: ['business war', 'campuss romance', 'urban fantasy', 'superpower', 'social ladder'],
  }
}
