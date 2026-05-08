import type { GenreSkill } from '../../../types/genre.js'

export function createSciFiSkill(): GenreSkill {
  return {
    name: 'scifi',
    displayName: '科幻',
    version: '1.0.0',
    worldbuildingPrompt: `请为以下科幻故事构建世界观。
故事简介：{idea}
总章节数：{totalChapters}

请以以下JSON格式返回（title 为必填字段，不可省略）：
{
  "title": "书名",
  "world": "世界观详细设定内容"
}

其中 world 字段应包含以下内容：
1. 时间设定（未来/星际/赛博朋克等）
2. 科技水平与社会结构
3. 主要势力或星际国家
4. 核心科技设定（AI、星际航行、基因改造等）
5. 末世或危机的根源（如有）`,
    outlineTemplate: `为一部 {totalChapters} 章的科幻小说制定大纲。

故事简介：{idea}

请按章节顺序列出每一章的：
- 章节标题
- 本章核心科技或社会议题
- 主要剧情冲突

严格生成 exactly {totalChapters} 个章节。`,
    chapterPromptSupplement: `你是一位擅长科幻风格的作家。请特别注意：
- 使用冷静、理性的语言风格
- 描写科技细节但不过度技术化
- 通过对话或行动展现技术对人的影响
- 制造紧张感或认知颠覆`,
    tropes: ['AI uprising', 'space exploration', 'dystopia', 'cybernetics', 'first contact'],
  }
}
