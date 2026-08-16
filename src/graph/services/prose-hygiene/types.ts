/**
 * 正文体例检查（Prose Hygiene Gate）的共享类型。
 *
 * 检测只允许两类操作：
 * 1. 机器可读协议的格式解析（=== 区块标记、事件行、终态 JSON、Markdown 标题行）；
 * 2. 已知标识符集合的成员判定（实体 id、节拍 id、章节号）。
 * 严禁任何形式的自然语言语义匹配（红线，见 AGENTS.md）。
 */

export type ProseHygieneIssueCode =
  /** === SECTION === 标记、STORY_FINAL_STATE 区块、STORY_EVENTS 事件行混入正文。 */
  | 'prose.protocol-block'
  /** 已知实体/节拍 id 被当作正文 token 使用（如 `c-25`、`A1-M2`）。 */
  | 'prose.internal-identifier'
  /** 正文叙述中引用作品自身章节号（第N章）或章节 id（chapter-N）。 */
  | 'prose.chapter-self-reference'
  /**
   * 作者腔点题/元叙述。属自然语言现象，确定性车道不做检测；
   * 保留该 code 供 advisory 车道（consistency.prose-artifact）对齐使用。
   */
  | 'prose.meta-narration'

export interface ProseHygieneIssue {
  code: ProseHygieneIssueCode
  severity: 'error' | 'warning'
  /** 在章节正文中的字符偏移区间。 */
  span: { start: number; end: number }
  /** 触发判定的机器可读 token 或整行。 */
  excerpt: string
}

/**
 * 已知标识符集合。任一集合为空时对应检测器自动失效（不做无根据猜测）。
 */
export interface ProseHygieneContext {
  /** story-memory 中的已知实体/伏笔/任务 id。 */
  entityIds?: readonly string[]
  /** story arc / story-memory 中的已知节拍 id（如 A1-M2）。 */
  beatIds?: readonly string[]
  /** 当前章的 1-based 章节号。 */
  chapterNumber?: number
  /** 全书总章数，用于构造合法章节号集合。 */
  totalChapters?: number
}
