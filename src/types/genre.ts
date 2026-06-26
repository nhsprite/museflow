export interface ChapterPlanningConfig {
  /** 核心事件字数占本章总字数的最低比例（硬底线） */
  coreEventRatioMin: number
  /** 核心事件字数占本章总字数的目标比例 */
  coreEventRatioTarget: number
  /** 单个非核心段落的最大字数 */
  maxNonCoreSectionWordCount: number
  /** 核心事件段落的最低字数 */
  minCoreSectionWordCount: number
  /** background 处理的差事在正文中的最大字数 */
  maxBackgroundTaskWordCount: number
  /** 非核心差事累计字数占本章总字数的最大比例 */
  maxExecutedTaskRatio: number
  /** 桥接/过渡场景占本章总字数的最大比例 */
  maxBridgeSceneRatio: number
  /** 已验证约束的最大保留条数 */
  maxVerifiedConstraints: number
  /** 每种非错误类型最多保留的问题数 */
  maxNonErrorIssuesPerType: number
}

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
  /** 章节规划阶段的数值约束，未指定时使用默认值 */
  chapterPlanning?: Partial<ChapterPlanningConfig>
}

export interface GenreRegistryEntry {
  skill: GenreSkill
  source: 'builtin' | 'custom'
  path: string
}
