import { logger } from '../../utils/logger.js'
import type { ReducedGraphState } from '../state.js'
import type { ChapterAgentInput } from '../../agents/types.js'
import { getChapterAgent } from '../agent-factory.js'
import { writeStagedChapterContent, readChapterContent } from '../../storage/filesystem/writer.js'
import { createChapterMeta } from '../../utils/agent-output.js'
import { expandOutlineForChapter } from '../../core/outline-expander.js'
import { formatChapterOutlineForAgent } from './planning.js'
import { buildChapterAgentContext, mergeAgentState } from '../utils/chapter-context.js'
import {
  validateFixedChapterContent,
  normalizeChapterHeading,
  getChapterWordCountPolicy,
} from '../../utils/chapter-content-validation.js'
import type { RuntimeContext } from '../../core/context.js'
import type { StoryEvent, ChapterFinalStateDeclaration } from '../../types/story-memory.js'
import {
  completeMissingExpectedEvents,
  augmentExpectedEventsWithClaimedBeats,
} from '../../story-memory/event-completion.js'

export async function draft_chapter(
  context: RuntimeContext,
  state: ReducedGraphState
): Promise<Partial<ReducedGraphState>> {
  const agent = getChapterAgent(context.provider)
  const chapterIndex = state.currentChapterIndex

  const expanded = await expandOutlineForChapter(state, chapterIndex, context)
  let chapterPlan = expanded.chapterPlan
  const {
    boundaryHints,
    pendingIssues: outlinePendingIssues,
    outline: updatedOutline,
    story: updatedStory,
    totalChapters: updatedTotalChapters,
    storyArc: updatedStoryArc,
    chapters: updatedChapters,
  } = expanded

  const augmentedExpectedEvents = augmentExpectedEventsWithClaimedBeats(
    chapterPlan,
    updatedStoryArc ?? state.storyArc ?? undefined,
    chapterIndex,
    state.storyMemory
  )
  if (chapterPlan && augmentedExpectedEvents.length > (chapterPlan.expectedEvents?.length ?? 0)) {
    chapterPlan = { ...chapterPlan, expectedEvents: augmentedExpectedEvents }
  }

  state = {
    ...state,
    chapterPlan,
    story: updatedStory ?? state.story,
    totalChapters: updatedTotalChapters ?? state.totalChapters,
    storyArc: updatedStoryArc ?? state.storyArc,
    outline: updatedOutline ?? state.outline,
    chapters: updatedChapters ?? state.chapters,
  }
  const outlineItem = state.outline[chapterIndex]

  const isRetryDraft = state.rewriteApproved || (state.session?.errorRewriteAttempts ?? 0) > 0
  const mergedIssues = [
    ...(outlinePendingIssues ?? []),
    ...(isRetryDraft ? (state.pendingIssues ?? []) : []),
  ]

  const existingContent = state.rewriteApproved
    ? await readChapterContent(state.story.outputDir, chapterIndex + 1)
    : null

  const baseContext = await buildChapterAgentContext(state, chapterIndex, context)

  const agentState: ChapterAgentInput = mergeAgentState(baseContext, {
    outline: formatChapterOutlineForAgent(state, chapterIndex, boundaryHints),
    ...(outlineItem?.title ? { chapterTitle: outlineItem.title } : {}),
    ...(outlineItem?.description ? { chapterSummary: outlineItem.description } : {}),
    ...(mergedIssues.length > 0 ? { issues: mergedIssues } : {}),
    ...(existingContent ? { chapterContent: existingContent } : {}),
    ...(state.chapterPlan ? { chapterPlan: state.chapterPlan } : {}),
  }) as ChapterAgentInput

  const output = await agent.run(agentState)

  if (!output.success && output.error) {
    throw new Error(`第 ${chapterIndex + 1} 章 AI 生成失败：${output.error}`)
  }

  const storyEvents = isStoryEventsData(output.data) ? (output.data.storyEvents ?? []) : []
  const finalStateDeclarations = isFinalStateData(output.data)
    ? (output.data.finalStateDeclarations ?? [])
    : []

  let content = output.content ?? ''
  if (!content || content.trim().length === 0) {
    throw new Error(`第 ${chapterIndex + 1} 章内容为空，AI 未返回有效内容。请检查模型配置或重试。`)
  }

  const preWriteCheck = (output.data as { preWriteCheck?: string } | undefined)?.preWriteCheck
  if (!preWriteCheck) {
    logger.warn(`[MuseFlow] 第 ${chapterIndex + 1} 章未输出预写检查表，可能遗漏大纲要求`)
  }

  content = normalizeChapterHeading(content, {
    chapterIndex,
    title: outlineItem?.title ?? null,
  })

  const completionResult = completeMissingExpectedEvents(
    content,
    state.chapterPlan?.expectedEvents ?? [],
    storyEvents,
    chapterIndex
  )
  if (completionResult.completedCount > 0) {
    logger.info(
      `[MuseFlow] 第 ${chapterIndex + 1} 章自动补全 ${completionResult.completedCount} 个缺失的结构化事件`
    )
  }
  content = completionResult.content

  const wordCountPolicy = getChapterWordCountPolicy(state.genre)
  const validation = await validateFixedChapterContent(content, {
    chapterIndex,
    wordCountPolicy,
    enforceWordCount: true,
  })

  if (!validation.valid) {
    throw new Error(`第 ${chapterIndex + 1} 章起草后校验失败：${validation.error}`)
  }

  await writeStagedChapterContent(state.story.outputDir, chapterIndex + 1, content)

  const newChapter = createChapterMeta(state.story.id, chapterIndex + 1, {
    outline: outlineItem?.description || null,
  })

  const newChapters = [...state.chapters]

  newChapters[chapterIndex] = newChapter

  return {
    story: state.story,
    totalChapters: state.totalChapters,
    storyArc: state.storyArc,
    outline: state.outline,
    chapters: newChapters,
    chapterPlan,
    draftChapterEvents: completionResult.events,
    chapterFinalStateDeclarations: finalStateDeclarations,
    canonicalFactsDelta: baseContext.reconciledState.canonicalFacts ?? [],
    supersededFactsDelta: baseContext.reconciledState.supersededFacts ?? [],
  }
}

function isStoryEventsData(data: unknown): data is { storyEvents?: StoryEvent[] } {
  return typeof data === 'object' && data !== null && 'storyEvents' in data
}

function isFinalStateData(
  data: unknown
): data is { finalStateDeclarations?: ChapterFinalStateDeclaration[] } {
  return typeof data === 'object' && data !== null && 'finalStateDeclarations' in data
}
