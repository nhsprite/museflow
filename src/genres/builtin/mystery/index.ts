import type { GenreSkill } from '../../../types/genre.js'

export function createMysterySkill(): GenreSkill {
  return {
    name: 'mystery',
    displayName: '悬疑',
    version: '1.0.0',
    worldbuildingPrompt: `请为以下悬疑故事构建世界观。
故事简介：{idea}
总章节数：{totalChapters}

请以以下JSON格式返回（title 为必填字段，不可省略）：
{
  "title": "书名",
  "world": "世界观详细设定内容"
}

其中 world 字段应包含以下内容：
1. 案件或谜团的核心设定（事件背景、受害者、关键线索）
2. 侦探/调查者的身份与动机
3. 嫌疑人或相关人物的关系网络
4. 地理与社会环境（密闭空间、小镇、都市等）
5. 误导与反转的布局空间`,
    outlineTemplate: `为一部 {totalChapters} 章的悬疑小说制定大纲。

故事简介：{idea}

请按章节顺序列出每一章的：
- 章节标题
- 本章核心事件（线索发现、调查推进、人物对话等）
- 悬念递进与信息揭示节奏

严格生成 exactly {totalChapters} 个章节。`,
    chapterPromptSupplement: `你是一位擅长悬疑风格的作家。请特别注意：
- 控制信息释放的节奏，保持读者的好奇心
- 通过细节描写埋下伏笔和线索
- 对话要暗藏机锋，避免直白透露关键信息
- 在解谜前制造足够的误导和反转`,
    tropes: ['locked room', 'whodunit', 'unreliable narrator', 'cold case', 'double identity'],
  }
}
