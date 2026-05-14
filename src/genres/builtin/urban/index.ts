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
1. 现代都市背景设定（时间、地点、城市特征）
2. 社会阶层与职场/校园/家庭环境
3. 时代背景特征（经济、文化、科技水平）
4. 重要人物关系网络
5. 核心冲突来源（利益、情感、阶层、价值观等）`,
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
    tropes: ['business war', 'campus romance', 'career struggle', 'family conflict', 'social ladder', 'revenge', 'redemption'],
  }
}
