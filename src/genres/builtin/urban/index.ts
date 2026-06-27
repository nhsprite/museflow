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
    chapterPromptSupplement: `你是一位擅长都市风格的作家。请特别注意：
- 语言贴近现代都市生活
- 描写职场、校园或社交场景
- 情感细腻，节奏明快
- 角色塑造贴近现实`,
    tropes: ['business war', 'campus romance', 'career struggle', 'family conflict', 'social ladder', 'revenge', 'redemption'],
    constraints: '必须严格遵循现实主义原则。世界观基于现实社会，禁止科幻、奇幻、超自然或系统流元素。冲突来源应是现实中可能发生的：商业竞争、职场斗争、家庭矛盾、情感纠葛、阶层跨越等。重生/穿越元素仅限于主角主观视角，不应引入超自然世界观设定。',
  }
}
