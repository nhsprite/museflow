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
} from '../../utils/chapter-content-validation.js'
import { getGenreSkill } from '../../genres/registry.js'
import {
  DEFAULT_CHAPTER_WORD_COUNT_MIN,
  DEFAULT_CHAPTER_WORD_COUNT_MAX,
} from '../../types/genre.js'
import type { RuntimeContext } from '../../core/context.js'
import type { StoryEvent } from '../../types/story-memory.js'

export async function draft_chapter(
  context: RuntimeContext,
  state: ReducedGraphState
): Promise<Partial<ReducedGraphState>> {
  const agent = getChapterAgent(context.provider)
  const chapterIndex = state.currentChapterIndex

  const {
    chapterPlan,
    boundaryHints,
    pendingIssues: outlinePendingIssues,
    outline: updatedOutline,
    story: updatedStory,
    totalChapters: updatedTotalChapters,
    storyArc: updatedStoryArc,
    chapters: updatedChapters,
  } = await expandOutlineForChapter(state, chapterIndex, context)
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

  const mergedIssues = [
    ...(outlinePendingIssues ?? []),
    ...(state.rewriteApproved ? (state.pendingIssues ?? []) : []),
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

  const genre = getGenreSkill(state.genre)
  const min = genre?.chapterWordCountMin ?? DEFAULT_CHAPTER_WORD_COUNT_MIN
  const max = genre?.chapterWordCountMax ?? DEFAULT_CHAPTER_WORD_COUNT_MAX

  const validation = await validateFixedChapterContent(content, {
    chapterIndex,
    minWordCount: min,
    maxWordCount: max,
    enforceWordCount: false,
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
    draftChapterEvents: storyEvents,
  }
}

function isStoryEventsData(data: unknown): data is { storyEvents?: StoryEvent[] } {
  return typeof data === 'object' && data !== null && 'storyEvents' in data
}
