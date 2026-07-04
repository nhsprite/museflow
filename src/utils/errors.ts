import type { Conflict } from '../types/story-state.js'
import type { OutlineRevisionProposal } from '../core/chapter-generation/outline-revision-proposal.js'

/**
 * 当本章大纲与已确立的权威事实存在无法自动调和的阻断性冲突时抛出。
 *
 * 该错误是中立的：它只携带通用的 Conflict 结构，不针对任何具体故事内容。
 * CLI 层捕获后可以向作者展示冲突并请求裁决。
 *
 * 可选地携带一个由系统生成的修订大纲建议，供作者作为第三种选择采纳。
 */
export class BlockingConflictError extends Error {
  readonly conflicts: readonly Conflict[]
  readonly chapterIndex: number
  readonly proposal: OutlineRevisionProposal | undefined

  constructor(
    conflicts: Conflict[],
    chapterIndex: number,
    proposal: OutlineRevisionProposal | undefined = undefined
  ) {
    super(
      `第 ${chapterIndex + 1} 章大纲与权威事实存在 ${conflicts.length} 个阻断性冲突，需要作者裁决`
    )
    this.name = 'BlockingConflictError'
    this.conflicts = conflicts
    this.chapterIndex = chapterIndex
    this.proposal = proposal
  }
}

export function isBlockingConflictError(err: unknown): err is BlockingConflictError {
  return err instanceof Error && err.name === 'BlockingConflictError'
}
