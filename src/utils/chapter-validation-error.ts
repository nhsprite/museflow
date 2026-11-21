import { logger } from './logger.js'

export type ChapterCheck =
  'consistency' | 'continuity.opening' | 'foreshadowing' | 'narrative.audit'

/** 检查未完成是执行失败，不能进入会降级/豁免小说问题的收敛路由。 */
export class ChapterValidationError extends Error {
  constructor(
    readonly check: ChapterCheck,
    readonly chapterIndex: number,
    cause: unknown
  ) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    super(`第 ${chapterIndex + 1} 章 ${check} 检查未完成，已阻止定稿：${detail}`, { cause })
    this.name = 'ChapterValidationError'
  }
}

/** 只重跑检查，不消耗正文修复/重写次数。持续失败时让图执行失败，禁止提交章节。 */
export async function runRequiredChapterCheck<T>(
  check: ChapterCheck,
  chapterIndex: number,
  operation: () => Promise<T>
): Promise<T> {
  const maxAttempts = 3
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation()
    } catch (cause) {
      if (attempt >= maxAttempts) throw new ChapterValidationError(check, chapterIndex, cause)
      logger.warn(
        `[MuseFlow] 第 ${chapterIndex + 1} 章 ${check} 检查未完成，重试检查 (${attempt}/${maxAttempts - 1})`,
        cause
      )
    }
  }
}
