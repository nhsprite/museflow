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
}

export interface GenreRegistryEntry {
  skill: GenreSkill
  source: 'builtin' | 'custom'
  path: string
}
