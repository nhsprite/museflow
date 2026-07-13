import { runOneChapter, type RunOneChapterOptions } from '../../core/runner.js'
import type { ReducedGraphState } from '../../graph/state.js'
import { withSpinner } from './spinner.js'
import { isBlockingConflictError, resolveBlockingConflicts } from './conflict-resolver.js'

/**
 * 封装 runOneChapter 的通用执行模式：带 spinner、阻塞冲突自动交互式解决、递归重试。
 *
 * 当冲突被解决后，会根据解决结果设置/更新 options.preserveTargetOutline，然后重试。
 */
export async function runOneChapterWithConflictResolution(
  storyId: string,
  options: RunOneChapterOptions,
  spinnerMessage: string,
  spinnerSuccess?: string
): Promise<ReducedGraphState> {
  try {
    return await withSpinner(
      spinnerMessage,
      () => runOneChapter(storyId, options),
      spinnerSuccess,
      (result) => !result.rewriteRequested
    )
  } catch (err) {
    if (isBlockingConflictError(err)) {
      const resolution = await resolveBlockingConflicts(storyId, err)
      options.preserveTargetOutline = resolution.preserveTargetOutline
      return runOneChapterWithConflictResolution(storyId, options, spinnerMessage, spinnerSuccess)
    }
    throw err
  }
}
