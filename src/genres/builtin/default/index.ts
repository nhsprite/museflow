import type { GenreSkill } from '../../../types/genre.js'
import { DEFAULT_CHAPTER_PLANNING_CONFIG } from '../../../utils/chapter-planning.js'

export function createDefaultSkill(): GenreSkill {
  return {
    name: 'default',
    displayName: '默认（通用）',
    version: '1.0.0',
    worldbuildingPrompt: `请为以下故事构建一个中立通用的世界观设定。
故事简介：{idea}
总章节数：{totalChapters}

请输出世界观设定，严格遵守以下 JSON 格式（不要添加 JSON 之外的解释文字，不要使用 Markdown 代码块包裹）：
{
  "title": "生成的书名",
  "world": "世界观详细设定内容，包含：1. 背景设定（时间、地点、社会结构） 2. 主要势力或阵营 3. 核心规则或法则 4. 文化与技术水平 5. 可能的冲突来源"
}`,
    chapterPromptSupplement: ``,
    tropes: [],
    chapterPlanning: DEFAULT_CHAPTER_PLANNING_CONFIG,
  }
}
