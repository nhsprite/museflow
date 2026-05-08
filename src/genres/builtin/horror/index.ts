import type { GenreSkill } from '../../../types/genre.js'

export function createHorrorSkill(): GenreSkill {
  return {
    name: 'horror',
    displayName: '恐怖',
    version: '1.0.0',
    worldbuildingPrompt: `请为以下恐怖故事构建世界观。
故事简介：{idea}
总章节数：{totalChapters}

请以以下JSON格式返回（title 为必填字段，不可省略）：
{
  "title": "书名",
  "world": "世界观详细设定内容"
}

其中 world 字段应包含以下内容：
1. 恐惧来源（超自然/心理/未知等）
2. 主要恐怖实体或现象
3. 故事发生的地理与社会环境
4. 受害者或角色的处境
5. 可能的逃生或对抗规则`,
    outlineTemplate: `为一部 {totalChapters} 章的恐怖小说制定大纲。

故事简介：{idea}

请按章节顺序列出每一章的：
- 章节标题
- 本章核心恐怖事件
- 紧张感递进节奏

严格生成 exactly {totalChapters} 个章节。`,
    chapterPromptSupplement: `你是一位擅长恐怖风格的作家。请特别注意：
- 营造压抑、紧张的氛围
- 逐步揭露恐惧的来源
- 利用未知制造恐惧，而非直接展示
- 适时描写角色的心理崩溃`,
    tropes: ['psychological horror', 'supernatural entity', 'survival', 'cosmic horror', 'haunting'],
  }
}
