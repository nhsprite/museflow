import type { GenreSkill } from '../../types/genre.js'

export function createDefaultSkill(): GenreSkill {
  return {
    name: 'default',
    displayName: '默认（通用）',
    version: '1.0.0',
    worldbuildingPrompt: `请为以下故事构建一个中立通用的世界观设定。
故事简介：{idea}
总章节数：{totalChapters}

请输出一份结构化的世界观文档，包含：
1. 背景设定（时间、地点、社会结构）
2. 主要势力或阵营
3. 核心规则或法则
4. 文化与技术水平
5. 可能的冲突来源`,
    outlineTemplate: `根据以下信息，为一部 {totalChapters} 章的小说制定大纲。

题材：通用（不限定具体类型）
故事简介：{idea}

请按章节顺序列出每一章的：
- 章节标题
- 本章核心事件
- 预计篇幅

严格生成 exactly {totalChapters} 个章节。`,
    chapterPromptSupplement: ``,
    tropes: [],
  }
}

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
    outlineTemplate: `为一部 {totalChapters} 章的西方奇幻小说制定大纲。

故事简介：{idea}

请按章节顺序列出每一章的：
- 章节标题
- 本章核心事件
- 涉及的主要角色或势力

严格生成 exactly {totalChapters} 个章节。`,
    chapterPromptSupplement: `你是一位擅长西方奇幻风格的作家。请特别注意：
- 使用史诗感的叙事语言
- 描写剑、魔法、城堡等奇幻元素
- 角色对话体现骑士精神或古老智慧
- 适时埋下伏笔并制造悬念`,
    tropes: ['chosen one', 'magical artifact', 'dark lord', 'quest', 'magical academy'],
  }
}

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
