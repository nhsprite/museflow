export interface GenreSkill {
  name: string
  displayName: string
  version: string
  worldbuildingPrompt: string
  outlineTemplate: string
  chapterPromptSupplement: string
  tropes: string[]
  chapterWordCountMin?: number
  chapterWordCountMax?: number
  /** 题材约束说明，会注入到系统提示中指导 AI 遵循该题材的核心特征 */
  constraints?: string
}

export interface GenreRegistryEntry {
  skill: GenreSkill
  source: 'builtin' | 'custom'
  path: string
}
