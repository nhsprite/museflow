import { updateStoryRuntimeStatus } from '../../core/runner.js'
import type { StoryStatus } from '../../types/story.js'

export interface HandleCommandErrorOptions {
  retryCommand?: string
  updateStatus?: (status: StoryStatus) => Promise<void> | void
}

/**
 * 统一处理 CLI 命令异常：打印错误、可选重试提示、更新故事状态、退出进程。
 */
export async function handleCommandError(
  storyId: string,
  err: unknown,
  options: HandleCommandErrorOptions = {}
): Promise<never> {
  const message = err instanceof Error ? err.message : String(err)

  console.error('[MuseFlow] 错误:', message)

  if (options.retryCommand) {
    console.error('')
    console.error('可以运行以下命令重试：')
    console.error(`   ${options.retryCommand}`)
    console.error('')
  }

  try {
    if (options.updateStatus) {
      await options.updateStatus('error')
    } else {
      await updateStoryRuntimeStatus(storyId, 'error')
    }
  } catch {
    // 错误处理阶段状态更新失败不应掩盖原始错误。
  }

  process.exit(1)
}
