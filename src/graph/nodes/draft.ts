import { logger } from '../../utils/logger.js'
import type { ReducedGraphState } from '../state.js'
import type { ChapterAgentInput } from '../../agents/types.js'
import type { Issue } from '../../types/agent.js'
import { getChapterAgent } from '../agent-factory.js'
import { writeStagedChapterContent, readChapterContent } from '../../storage/filesystem/writer.js'
import { createChapterMeta, createIssue } from '../../utils/agent-output.js'
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
  acceptEmittedChapterEvents,
  augmentExpectedEventsWithClaimedBeats,
} from '../../story-memory/event-completion.js'

/**
 * 起草产出校验（字数等）未通过时的最大起草次数（首次 + 携带反馈的重试）。
 * 与 outline-expander 的打回重试同一模式：校验失败原因作为结构化 issue 注入
 * 下一轮起草，让模型看到具体差距后重新分配篇幅；耗尽后才抛出人工处理错误，
 * 避免一次字数不达标就直接卡死整章流程。
 */
const MAX_DRAFT_VALIDATION_ATTEMPTS = 3

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

  const wordCountPolicy = getChapterWordCountPolicy(state.genre)
  const validationFeedback: Issue[] = []
  let content = ''
  let acceptedEvents: ReturnType<typeof acceptEmittedChapterEvents> = { content: '', events: [] }
  let finalStateDeclarations: ChapterFinalStateDeclaration[] = []
  let lastValidationError: string | null = null

  for (let attempt = 0; attempt < MAX_DRAFT_VALIDATION_ATTEMPTS; attempt++) {
    const attemptIssues = [...mergedIssues, ...validationFeedback]
    const agentState: ChapterAgentInput = mergeAgentState(baseContext, {
      outline: formatChapterOutlineForAgent(state, chapterIndex, boundaryHints),
      ...(outlineItem?.title ? { chapterTitle: outlineItem.title } : {}),
      ...(outlineItem?.description ? { chapterSummary: outlineItem.description } : {}),
      ...(attemptIssues.length > 0 ? { issues: attemptIssues } : {}),
      ...(existingContent ? { chapterContent: existingContent } : {}),
      ...(state.chapterPlan ? { chapterPlan: state.chapterPlan } : {}),
    }) as ChapterAgentInput

    const output = await agent.run(agentState)

    if (!output.success && output.error) {
      throw new Error(`第 ${chapterIndex + 1} 章 AI 生成失败：${output.error}`)
    }

    const storyEvents = isStoryEventsData(output.data) ? (output.data.storyEvents ?? []) : []
    finalStateDeclarations = isFinalStateData(output.data)
      ? (output.data.finalStateDeclarations ?? [])
      : []

    content = output.content ?? ''
    if (!content || content.trim().length === 0) {
      throw new Error(
        `第 ${chapterIndex + 1} 章内容为空，AI 未返回有效内容。请检查模型配置或重试。`
      )
    }

    const preWriteCheck = (output.data as { preWriteCheck?: string } | undefined)?.preWriteCheck
    if (!preWriteCheck) {
      logger.warn(`[MuseFlow] 第 ${chapterIndex + 1} 章未输出预写检查表，可能遗漏大纲要求`)
    }

    content = normalizeChapterHeading(content, {
      chapterIndex,
      title: outlineItem?.title ?? null,
    })

    acceptedEvents = acceptEmittedChapterEvents(content, storyEvents)
    content = acceptedEvents.content

    const validation = await validateFixedChapterContent(content, {
      chapterIndex,
      wordCountPolicy,
      enforceWordCount: true,
    })

    if (validation.valid) {
      lastValidationError = null
      break
    }

    lastValidationError = validation.error ?? '未知错误'
    if (attempt + 1 >= MAX_DRAFT_VALIDATION_ATTEMPTS) break

    logger.warn(
      `[MuseFlow] 第 ${chapterIndex + 1} 章起草产出第 ${attempt + 1}/${MAX_DRAFT_VALIDATION_ATTEMPTS} 次校验未通过：${lastValidationError}，将携带反馈重新起草`
    )
    validationFeedback.push(
      createIssue(
        {
          ruleId: 'draft.output-validation',
          type: 'draft_failure',
          severity: 'error',
          description: `第 ${chapterIndex + 1} 章上一稿未通过产出校验：${lastValidationError}。请按章节规划的各节字数预算重新分配篇幅，确保全章总字数落在要求区间内。`,
        },
        'quality',
        'draft'
      )
    )
  }

  if (lastValidationError !== null) {
    throw new Error(`第 ${chapterIndex + 1} 章起草后校验失败：${lastValidationError}`)
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
    draftChapterEvents: acceptedEvents.events,
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
