import type { ReducedGraphState } from '../../state.js'
import type { FixAgentInput, SentenceFix } from '../../../agents/types.js'
import type { FixAgent } from '../../../agents/index.js'
import type { ModelProvider } from '../../../model/provider.js'
import type { Issue } from '../../../types/agent.js'
import type { StoryEvent } from '../../../types/story-memory.js'
import { writeStagedChapterContent } from '../../../storage/filesystem/writer.js'
import {
  getChapterWordCountBounds,
  validateFixedChapterContent,
} from '../../../utils/chapter-content-validation.js'
import { countEvidenceParagraphs } from '../../../story-memory/validator.js'
import { formatStoryState, prepareStoryStateForChapter } from '../../utils/reconciler/index.js'
import { buildEffectiveCharactersList, charactersToString } from '../../utils/characters.js'
import { splitIntoParagraphs } from '../../utils/text-patching.js'
import { buildDuplicateEndingParagraphMessage } from '../../utils/chapter-window.js'
import { readChapterContent } from '../../../storage/filesystem/writer.js'
import { createIssue } from '../../../utils/agent-output.js'
import { logger } from '../../../utils/logger.js'

/**
 * 句子/段落级修复的合并产出校验，与 runLegacyFix 的 validateFixedChapterContent 口径一致。
 * 额外检查修复后内容是否意外复制了上一章结尾，避免局部修复引入跨章断裂。
 */
async function validateMergedFixContent(
  content: string,
  state: ReducedGraphState,
  chapterIndex: number,
  provider: ModelProvider
): Promise<{ valid: boolean; error?: string }> {
  const bounds = getChapterWordCountBounds(state.genre)
  const baseValidation = await validateFixedChapterContent(
    content,
    { chapterIndex, minWordCount: bounds.min, maxWordCount: bounds.max, enforceWordCount: false },
    provider
  )
  if (!baseValidation.valid) {
    return baseValidation
  }

  if (chapterIndex > 0) {
    const previousContent = await readChapterContent(state.story.outputDir, chapterIndex)
    if (previousContent && previousContent.trim().length > 0) {
      const duplicateMessage = buildDuplicateEndingParagraphMessage(
        chapterIndex,
        previousContent,
        content
      )
      if (duplicateMessage) {
        return {
          valid: false,
          error: `修复后的${duplicateMessage}`,
        }
      }
    }
  }

  return { valid: true }
}

function buildFixValidationFailureIssue(chapterIndex: number, error: string): Issue {
  return createIssue(
    {
      type: 'draft_failure',
      severity: 'error',
      description: `第 ${chapterIndex + 1} 章修复后内容校验失败：${error}`,
    },
    'quality',
    'draft'
  )
}

/**
 * fix 落盘后对 draftChapterEvents 重跑证据校验：
 * 证据段落索引在修复后正文中越界的事件会被剔除并产生 warning，
 * 避免结构化校验对修复后正文产生虚假 event_evidence_invalid 错误，
 * 以及 finalize 把失效事件写入 StoryMemory。
 */
function refreshDraftChapterEventsAfterFix(
  events: StoryEvent[] | undefined,
  fixedContent: string,
  chapterIndex: number
): { events: StoryEvent[] | undefined; issues: Issue[] } {
  if (!events || events.length === 0) return { events, issues: [] }

  const paragraphCount = countEvidenceParagraphs(fixedContent)
  const kept: StoryEvent[] = []
  const issues: Issue[] = []

  for (const event of events) {
    const evidence = event.evidence
    if (evidence && (evidence.paragraphIndex < 1 || evidence.paragraphIndex > paragraphCount)) {
      issues.push(
        createIssue(
          {
            type: 'event_evidence_invalid',
            severity: 'warning',
            description: `结构化事件 ${event.id}（${event.type}）的段落证据 @p${evidence.paragraphIndex} 在第 ${chapterIndex + 1} 章修复后的正文中不存在，已将其从 draftChapterEvents 移除，避免写入 StoryMemory`,
          },
          'outline_compliance',
          'draft'
        )
      )
      continue
    }
    kept.push(event)
  }

  if (issues.length > 0) {
    logger.warn(
      `[MuseFlow] 第 ${chapterIndex + 1} 章修复后有 ${issues.length} 个结构化事件的段落证据失效，已从 draftChapterEvents 移除`
    )
  }

  return { events: kept, issues }
}

export async function runSentenceFix(
  agent: FixAgent,
  provider: ModelProvider,
  state: ReducedGraphState,
  existingContent: string,
  paragraphs: string[],
  sentenceFixes: SentenceFix[],
  chapterIndex: number,
  outlineItem: { description?: string } | undefined,
  previousChapters: string,
  timelineSnapshot: string,
  nextBoundaryHint: string
): Promise<Partial<ReducedGraphState>> {
  const affectedParagraphs = new Set(sentenceFixes.map((s) => s.paragraphIndex))

  const contextIndices = new Set<number>()
  for (const idx of affectedParagraphs) {
    if (idx > 0) contextIndices.add(idx - 1)
    if (idx < paragraphs.length - 1) contextIndices.add(idx + 1)
  }
  for (const idx of affectedParagraphs) {
    contextIndices.delete(idx)
  }

  const contextParagraphs = Array.from(contextIndices)
    .sort((a, b) => a - b)
    .map((idx) => paragraphs[idx])
  const context = contextParagraphs.join('\n\n')

  const { reconciledState } = await prepareStoryStateForChapter(state, chapterIndex, provider)
  const storyStateStr = formatStoryState(reconciledState, state.storyMemory?.entities)

  const {
    merged: effectiveCharacters,
    outline: outlineCharacters,
    established: establishedCharacters,
  } = buildEffectiveCharactersList(state, chapterIndex)

  const agentState: FixAgentInput = {
    idea: state.idea,
    genre: state.genre,
    totalChapters: state.totalChapters,
    chapterIndex,
    issues: state.pendingIssues,
    chapterContent: existingContent,
    previousChapters,
    timelineSnapshot,
    ...(storyStateStr ? { storyState: storyStateStr } : {}),
    ...(nextBoundaryHint ? { nextChapterBoundary: nextBoundaryHint } : {}),
    charactersList: effectiveCharacters,
    outlineCharacters,
    establishedCharacters,
    sentenceFix: {
      sentences: sentenceFixes,
      context,
    },
  }

  const output = await agent.run(agentState)

  const affectedIndices = Array.from(new Set(sentenceFixes.map((s) => s.paragraphIndex)))
  const {
    content,
    chapterMeta: updatedChapter,
    issues: fixIssues,
  } = agent.processOutput(
    output,
    existingContent,
    paragraphs,
    affectedIndices,
    state.story.id,
    chapterIndex + 1
  )

  const validation = await validateMergedFixContent(content, state, chapterIndex, provider)
  if (!validation.valid) {
    logger.warn(`[MuseFlow] 第 ${chapterIndex + 1} 章句子级修复产出校验失败：${validation.error}`)
    return {
      pendingIssues: [
        ...state.pendingIssues,
        buildFixValidationFailureIssue(chapterIndex, validation.error ?? '未知错误'),
        ...fixIssues,
      ],
    }
  }

  await writeStagedChapterContent(state.story.outputDir, chapterIndex + 1, content)

  const newChapters = [...state.chapters]
  newChapters[chapterIndex] = updatedChapter

  const { events, issues: eventIssues } = refreshDraftChapterEventsAfterFix(
    state.draftChapterEvents,
    content,
    chapterIndex
  )
  const newIssues = [...fixIssues, ...eventIssues]

  return {
    chapters: newChapters,
    draftChapterEvents: events,
    ...(newIssues.length > 0 ? { pendingIssues: [...state.pendingIssues, ...newIssues] } : {}),
  }
}

export async function runParagraphFix(
  agent: FixAgent,
  provider: ModelProvider,
  state: ReducedGraphState,
  existingContent: string,
  paragraphs: string[],
  affectedIndices: number[],
  chapterIndex: number,
  outlineItem: { description?: string } | undefined,
  previousChapters: string,
  timelineSnapshot: string,
  nextBoundaryHint: string
): Promise<Partial<ReducedGraphState>> {
  const paragraphFixes = affectedIndices.map((idx) => {
    const paragraphContent = paragraphs[idx]
    if (!paragraphContent) {
      throw new Error(`段落索引 ${idx} 超出范围`)
    }
    return {
      index: idx,
      content: paragraphContent,
      issues: state.pendingIssues,
    }
  })

  const contextIndices = new Set<number>()
  for (const idx of affectedIndices) {
    if (idx > 0) contextIndices.add(idx - 1)
    if (idx < paragraphs.length - 1) contextIndices.add(idx + 1)
  }
  for (const idx of affectedIndices) {
    contextIndices.delete(idx)
  }

  const contextParagraphs = Array.from(contextIndices)
    .sort((a, b) => a - b)
    .map((idx) => paragraphs[idx])
  const context = contextParagraphs.join('\n\n')

  const { reconciledState } = await prepareStoryStateForChapter(state, chapterIndex, provider)
  const storyStateStr = formatStoryState(reconciledState, state.storyMemory?.entities)

  const {
    merged: effectiveCharacters,
    outline: outlineCharacters,
    established: establishedCharacters,
  } = buildEffectiveCharactersList(state, chapterIndex)

  const agentState: FixAgentInput = {
    idea: state.idea,
    genre: state.genre,
    totalChapters: state.totalChapters,
    chapterIndex,
    issues: state.pendingIssues,
    chapterContent: existingContent,
    previousChapters,
    timelineSnapshot,
    ...(storyStateStr ? { storyState: storyStateStr } : {}),
    ...(nextBoundaryHint ? { nextChapterBoundary: nextBoundaryHint } : {}),
    charactersList: effectiveCharacters,
    outlineCharacters,
    establishedCharacters,
    paragraphFix: {
      paragraphs: paragraphFixes,
      context,
    },
  }

  const output = await agent.run(agentState)

  const {
    content,
    chapterMeta: updatedChapter,
    issues: fixIssues,
  } = agent.processOutput(
    output,
    existingContent,
    paragraphs,
    affectedIndices,
    state.story.id,
    chapterIndex + 1
  )

  const validation = await validateMergedFixContent(content, state, chapterIndex, provider)
  if (!validation.valid) {
    logger.warn(`[MuseFlow] 第 ${chapterIndex + 1} 章段落级修复产出校验失败：${validation.error}`)
    return {
      pendingIssues: [
        ...state.pendingIssues,
        buildFixValidationFailureIssue(chapterIndex, validation.error ?? '未知错误'),
        ...fixIssues,
      ],
    }
  }

  await writeStagedChapterContent(state.story.outputDir, chapterIndex + 1, content)

  const newChapters = [...state.chapters]
  newChapters[chapterIndex] = updatedChapter

  const { events, issues: eventIssues } = refreshDraftChapterEventsAfterFix(
    state.draftChapterEvents,
    content,
    chapterIndex
  )
  const newIssues = [...fixIssues, ...eventIssues]

  return {
    chapters: newChapters,
    draftChapterEvents: events,
    ...(newIssues.length > 0 ? { pendingIssues: [...state.pendingIssues, ...newIssues] } : {}),
  }
}

export async function runLegacyFix(
  agent: FixAgent,
  provider: ModelProvider,
  state: ReducedGraphState,
  existingContent: string,
  chapterIndex: number,
  outlineItem: { description?: string } | undefined,
  previousChapters: string,
  timelineSnapshot: string,
  nextBoundaryHint: string
): Promise<Partial<ReducedGraphState>> {
  const { reconciledState } = await prepareStoryStateForChapter(state, chapterIndex, provider)
  const storyStateStr = formatStoryState(reconciledState, state.storyMemory?.entities)

  const {
    merged: effectiveCharacters,
    outline: outlineCharacters,
    established: establishedCharacters,
  } = buildEffectiveCharactersList(state, chapterIndex)

  const agentState: FixAgentInput = {
    idea: state.idea,
    genre: state.genre,
    totalChapters: state.totalChapters,
    chapterIndex,
    issues: state.pendingIssues,
    chapterContent: existingContent,
    previousChapters,
    timelineSnapshot,
    ...(storyStateStr ? { storyState: storyStateStr } : {}),
    ...(nextBoundaryHint ? { nextChapterBoundary: nextBoundaryHint } : {}),
    characters: charactersToString(state.characters),
    charactersList: effectiveCharacters,
    outlineCharacters,
    establishedCharacters,
    outline: state.outline.map((o, i) => `第${i + 1}章：${o.title}\n${o.description}`).join('\n\n'),
  }

  const output = await agent.run(agentState)

  if (!output.success && output.error) {
    throw new Error(`第 ${chapterIndex + 1} 章重写失败：${output.error}`)
  }

  let rawContent = output.content ?? ''
  if (!rawContent || rawContent.trim().length === 0) {
    throw new Error(
      `第 ${chapterIndex + 1} 章重写后内容为空，AI 未返回有效内容。请检查模型配置或重试。`
    )
  }

  const bounds = getChapterWordCountBounds(state.genre)

  const validation = await validateFixedChapterContent(
    rawContent,
    {
      chapterIndex,
      minWordCount: bounds.min,
      maxWordCount: bounds.max,
      enforceWordCount: false,
    },
    provider
  )

  if (!validation.valid) {
    throw new Error(`第 ${chapterIndex + 1} 章重写后内容校验失败：${validation.error}`)
  }

  rawContent = validation.content ?? rawContent
  const paragraphs = splitIntoParagraphs(existingContent)
  const {
    content,
    chapterMeta: updatedChapter,
    issues: fixIssues,
  } = agent.processOutput(
    { ...output, content: rawContent },
    existingContent,
    paragraphs,
    [],
    state.story.id,
    chapterIndex + 1
  )

  await writeStagedChapterContent(state.story.outputDir, chapterIndex + 1, content)

  const newChapters = [...state.chapters]
  newChapters[chapterIndex] = updatedChapter

  const { events, issues: eventIssues } = refreshDraftChapterEventsAfterFix(
    state.draftChapterEvents,
    content,
    chapterIndex
  )
  const newIssues = [...fixIssues, ...eventIssues]

  return {
    chapters: newChapters,
    draftChapterEvents: events,
    ...(newIssues.length > 0 ? { pendingIssues: [...state.pendingIssues, ...newIssues] } : {}),
  }
}
