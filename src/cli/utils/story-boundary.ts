import {
  evaluateStoryCompletion,
  type StoryCompletionAudit,
  type StoryCompletionInput,
} from '../../core/story-completion.js'

export function getReachedStoryBoundary(state: StoryCompletionInput): StoryCompletionAudit | null {
  const audit = evaluateStoryCompletion(state)
  return audit.chapterLimitReached ? audit : null
}

export function printReachedStoryBoundary(audit: StoryCompletionAudit, storyId: string): void {
  if (audit.status === 'complete') {
    console.log('[MuseFlow] 故事已完成')
    console.log(`  可使用 museflow rewrite ${storyId} --chapter <章节号> 修改已有章节`)
    console.log(`  可使用 museflow export ${storyId} 导出故事`)
    return
  }

  console.log('[MuseFlow] 已到规划章节边界，但故事未通过完结门禁。')
  console.log(`  使用 museflow rewrite ${storyId} 修复终章`)
}
