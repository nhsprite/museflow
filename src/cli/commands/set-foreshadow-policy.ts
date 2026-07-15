import { requireStory } from '../utils/story-loader.js'
import { createCheckpointService } from '../../storage/checkpoint-service.js'
import { exportMetaFromCheckpoint } from '../../storage/meta/exporter.js'
import { applyEvents } from '../../story-memory/projector.js'
import {
  isValidForeshadowDeadline,
  projectForeshadowStack,
} from '../../story-memory/foreshadow-policy.js'
import {
  isForeshadowResolutionPolicy,
  migrateStoryMemoryToV2,
  validatePolicyDeadline,
  type LegacyStoryMemoryV1,
} from '../../story-memory/resolution-policy.js'
import { generateId } from '../../utils/id.js'
import type { ReducedGraphState } from '../../graph/state.js'
import type {
  ForeshadowResolutionPolicy,
  StoryEvent,
  StoryMemory,
} from '../../types/story-memory.js'

export interface SetForeshadowPolicyOptions {
  foreshadow?: string
  policy?: string
  deadline?: number
}

function fail(message: string): void {
  console.error(`[MuseFlow] 错误: ${message}`)
  process.exit(1)
}

function policyLabel(policy: ForeshadowResolutionPolicy): string {
  switch (policy) {
    case 'must_resolve':
      return '必须回收'
    case 'should_resolve':
      return '建议自然回收'
    case 'may_remain_open':
      return '可保持开放'
  }
}

export async function setForeshadowPolicy(
  storyId: string,
  options: SetForeshadowPolicyOptions
): Promise<void> {
  const foreshadowId = options.foreshadow?.trim()
  if (!storyId || !foreshadowId || !options.policy) {
    fail('请提供故事ID、伏笔ID和回收策略')
    console.log(
      '用法: museflow set-foreshadow-policy <story-id> --foreshadow <id> --policy <must_resolve|should_resolve|may_remain_open> [--deadline <chapter>]'
    )
    return
  }

  if (!isForeshadowResolutionPolicy(options.policy)) {
    fail('--policy 必须是 must_resolve、should_resolve 或 may_remain_open')
    return
  }
  const policy = options.policy

  if (policy === 'must_resolve' && options.deadline === undefined) {
    fail('must_resolve 必须提供 --deadline')
    return
  }
  if (policy !== 'must_resolve' && options.deadline !== undefined) {
    fail('--deadline 仅适用于 must_resolve')
    return
  }

  const deadline = policy === 'must_resolve' ? (options.deadline ?? null) : null
  if (!validatePolicyDeadline(policy, deadline)) {
    fail('--deadline 必须是大于 0 的整数章节号')
    return
  }

  const story = await requireStory(storyId)
  const checkpointService = createCheckpointService(story.outputDir)
  const tuple = await checkpointService.getTuple({
    configurable: { thread_id: storyId, outputDir: story.outputDir },
  })
  if (!tuple) {
    fail('找不到故事状态')
    return
  }

  const state = tuple.checkpoint.channel_values as ReducedGraphState
  if (!state.storyMemory) {
    fail('当前故事未初始化 StoryMemory，无法调整伏笔策略')
    return
  }
  const memory = migrateStoryMemoryToV2(state.storyMemory as StoryMemory | LegacyStoryMemoryV1)
  const foreshadow = memory.foreshadows[foreshadowId]
  if (!foreshadow) {
    fail(`伏笔 ${foreshadowId} 不存在`)
    return
  }
  if (foreshadow.fulfilledIn !== null) {
    fail(`伏笔 ${foreshadowId} 已在第 ${foreshadow.fulfilledIn + 1} 章回收，不能调整策略`)
    return
  }
  if (foreshadow.waivedIn !== undefined) {
    fail(`伏笔 ${foreshadowId} 已经放弃回收，不能调整策略`)
    return
  }
  if (deadline !== null && !isValidForeshadowDeadline(foreshadow.introducedIn, deadline)) {
    fail(`--deadline 必须晚于伏笔引入章节（第 ${foreshadow.introducedIn + 1} 章）`)
    return
  }

  // 策略调整是作者决策，使用结构化事件进入同一条 StoryMemory 重放链。
  const event: StoryEvent = {
    id: generateId('evt'),
    type: 'foreshadow-policy-set',
    foreshadowId,
    resolutionPolicy: policy,
    expectedFulfillChapter: deadline,
    chapterIndex: state.currentChapterIndex,
    source: 'outline',
  }
  const newMemory = applyEvents(memory, [event])
  const newPendingIssues = (state.pendingIssues ?? []).filter(
    (issue) => !(issue.type === 'foreshadow_boundary_unresolved' && issue.subject === foreshadowId)
  )
  const newVerifiedConstraints = (state.verifiedConstraints ?? []).filter(
    (constraint) =>
      !(constraint.kind === 'generic' && constraint.id === `foreshadow-boundary:${foreshadowId}`)
  )

  await checkpointService.updateLatestState({
    storyMemory: newMemory,
    foreshadowStack: projectForeshadowStack(newMemory),
    pendingIssues: newPendingIssues,
    verifiedConstraints: newVerifiedConstraints,
  })
  await exportMetaFromCheckpoint(story.outputDir)

  console.log(`[MuseFlow] 已调整伏笔策略：${foreshadowId}`)
  console.log(`  内容：${foreshadow.text}`)
  console.log(`  策略：${policyLabel(policy)} (${policy})`)
  if (deadline !== null) console.log(`  截止章节：第 ${deadline} 章`)
}
