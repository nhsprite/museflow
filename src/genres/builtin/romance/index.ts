import type { GenreSkill } from '../../../types/genre.js'

export function createRomanceSkill(): GenreSkill {
  return {
    name: 'romance',
    displayName: '言情',
    version: '1.0.0',
    worldbuildingPrompt: `请为以下言情故事构建世界观。
故事简介：{idea}
总章节数：{totalChapters}

请以以下JSON格式返回（title 为必填字段，不可省略）：
{
  "title": "书名",
  "world": "世界观详细设定内容"
}

其中 world 字段应包含以下内容：
1. 故事背景（校园/都市/古代等）
2. 主要人物及性格特点
3. 人物关系网络
4. 核心情感冲突来源
5. 故事基调（甜蜜/虐恋/暗恋等）`,
    outlineTemplate: `为一部 {totalChapters} 章的言情小说制定大纲。

故事简介：{idea}

请按章节顺序列出每一章的：
- 章节标题
- 本章核心情感事件
- 情感递进节奏

严格生成 exactly {totalChapters} 个章节。`,
    chapterPromptSupplement: `你是一位擅长言情风格的作家。请特别注意：
- 细腻描写人物内心情感
- 通过对话和动作展示情感变化
- 制造心动或心酸的瞬间
- 情节曲折但情感真实`,
    tropes: ['slow burn', 'enemies to lovers', 'childhood connection', 'misunderstanding', 'growth'],
  }
}
