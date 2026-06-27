import type { GenreSkill } from '../../../types/genre.js'

export function createFantasySkill(): GenreSkill {
  return {
    name: 'fantasy',
    displayName: '西方奇幻',
    version: '1.0.0',
    worldbuildingPrompt: `请为以下奇幻故事构建世界观。
故事简介：{idea}
总章节数：{totalChapters}

请输出一份西方奇幻风格的世界观文档，包含：
1. 世界/大陆名称及地理概况
2. 魔法体系（来源、分类、使用限制）
3. 主要种族（如人类、精灵、矮人等）
4. 王国/势力分布
5. 重要历史事件或传说
6. 常见的奇幻冲突来源`,
    chapterPromptSupplement: `你是一位擅长西方奇幻风格的作家。请特别注意：
- 使用史诗感的叙事语言
- 描写剑、魔法、城堡等奇幻元素
- 角色对话体现骑士精神或古老智慧
- 适时埋下伏笔并制造悬念`,
    tropes: ['chosen one', 'magical artifact', 'dark lord', 'quest', 'magical academy'],
  }
}
