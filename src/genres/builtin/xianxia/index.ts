import type { GenreSkill } from '../../../types/genre.js'

export function createXianxiaSkill(): GenreSkill {
  return {
    name: 'xianxia',
    displayName: '仙侠',
    version: '1.0.0',
    worldbuildingPrompt: `请为以下仙侠故事构建世界观。
故事简介：{idea}
总章节数：{totalChapters}

请以以下JSON格式返回（title 为必填字段，不可省略）：
{
  "title": "书名",
  "world": "世界观详细设定内容"
}

其中 world 字段应包含以下内容：
1. 修真境界体系（从低到高列出主要境界）
2. 主要门派或势力
3. 功法/法术体系
4. 灵根/天赋设定
5. 资源稀缺性设定（灵石、灵药等）
6. 仙凡关系`,
    outlineTemplate: `为一部 {totalChapters} 章的仙侠小说制定大纲。

故事简介：{idea}

请按章节顺序列出每一章的：
- 章节标题
- 本章核心事件（包含修真、功法、门派冲突等）
- 主角当前境界

严格生成 exactly {totalChapters} 个章节。`,
    chapterPromptSupplement: `你是一位擅长仙侠风格的作家。请特别注意：
- 使用古风文言与白话结合的语言
- 描写修真境界、功法特效、修仙心境
- 门派恩怨、机缘争夺等经典仙侠主题
- 描写时应注重意境而非写实`,
    tropes: ['martial realm', 'golden core', 'sect war', 'immortal herbs', 'body refinement'],
  }
}
