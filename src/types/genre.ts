import type { FactAttribute } from './story-state.js'

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
  /** 收尾阶段前必须回收的主要伏笔最低比例 */
  closingForeshadowRecoveryRatio: number
  /** 每章最少段落/场景数 */
  minSections: number
  /** 每章最多段落/场景数 */
  maxSections: number
  /** 核心事件场景的最少数量 */
  minCoreSections: number
  /** 必须被提升为 canonical facts 的关键属性维度 */
  criticalFactAttributes: FactAttribute[]
  /** 高层次大纲描述的字数下限 */
  outlineDescriptionLengthMin: number
  /** 高层次大纲描述的字数上限 */
  outlineDescriptionLengthMax: number
  /** 高层次大纲描述的最少句数 */
  outlineDescriptionSentenceCountMin: number
  /** 高层次大纲描述的最多句数 */
  outlineDescriptionSentenceCountMax: number
  /** 新伏笔的最短文本长度（字符） */
  foreshadowMinLength: number
  /** 新伏笔的最短回收距离（章数，从当前章之后开始算） */
  foreshadowMinFulfillDistance: number
  /** 新伏笔的最长回收距离（章数） */
  foreshadowMaxFulfillDistance: number
  /** 同时保留的未回收伏笔最大数量 */
  foreshadowMaxStackSize: number
  /** 单章最多主动回收的 required 伏笔数量 */
  foreshadowMaxFulfillmentsPerChapter: number
  /** 每个未来章节为伏笔规划保留的容量余量 */
  foreshadowFulfillmentHeadroomPerChapter: number
  /** 单章最多提供的无期限伏笔自然回收候选数量；0 表示关闭 */
  foreshadowMaxOpportunisticCandidatesPerChapter: number
  /** 进入收尾阶段前剩余章节比例 */
  closingPhaseRatio: number
  /** 错误级问题最大连续重写次数 */
  maxErrorRewriteAttempts: number
  /** 问题集合相似度阈值，超过则认为重写未收敛 */
  issueSetSimilarityThreshold: number
  /** 当只剩解释性错误时是否自动降级为 warning */
  downgradeInterpretiveErrors: boolean
}

export interface GenreSkill {
  name: string
  displayName: string
  version: string
  worldbuildingPrompt: string
  chapterPromptSupplement: string
  tropes: string[]
  chapterWordCountMin?: number
  chapterWordCountMax?: number
  /** 题材约束说明，会注入到系统提示中指导 AI 遵循该题材的核心特征 */
  constraints?: string
  /** 章节规划阶段的数值约束，未指定时使用默认值 */
  chapterPlanning?: Partial<ChapterPlanningConfig>
  /** 主要人物数量下限（默认使用全局常量） */
  mainCharacterCountMin?: number
  /** 主要人物数量上限（默认使用全局常量） */
  mainCharacterCountMax?: number
}

/** 默认章节字数下限（校验用） */
export const DEFAULT_CHAPTER_WORD_COUNT_MIN = 1500

/** 默认章节字数上限（校验用） */
export const DEFAULT_CHAPTER_WORD_COUNT_MAX = 8000

/** 默认章节规划目标字数下限 */
export const DEFAULT_CHAPTER_PLANNING_WORD_COUNT_MIN = 4000

/** 默认章节规划目标字数上限 */
export const DEFAULT_CHAPTER_PLANNING_WORD_COUNT_MAX = 7000

export interface GenreRegistryEntry {
  skill: GenreSkill
  source: 'builtin' | 'custom'
  path: string
}
