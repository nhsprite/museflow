import type { ReducedGraphState } from '../../state.js'
import type { FixAgentInput, SentenceFix } from '../../../agents/types.js'
import type { FixAgent } from '../../../agents/index.js'
import type { ModelProvider } from '../../../model/provider.js'
import { writeChapterContent } from '../../../storage/filesystem/writer.js'
import { getGenreSkill } from '../../../genres/registry.js'
import {
  DEFAULT_CHAPTER_WORD_COUNT_MIN,
  DEFAULT_CHAPTER_WORD_COUNT_MAX,
} from '../../../types/genre.js'
import { validateFixedChapterContent } from '../../../utils/chapter-content-validation.js'
import { formatStoryState, prepareStoryStateForChapter } from '../../utils/reconciler/index.js'
import { buildEffectiveCharactersList, charactersToString } from '../../utils/characters.js'
import { splitIntoParagraphs } from '../../utils/text-patching.js'

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
  const storyStateStr = formatStoryState(reconciledState)

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
  const { content, chapterMeta: updatedChapter } = agent.processOutput(
    output,
    existingContent,
    paragraphs,
    affectedIndices,
    state.story.id,
    chapterIndex + 1
  )

  await writeChapterContent(state.story.outputDir, chapterIndex + 1, content)

  const newChapters = [...state.chapters]
  newChapters[chapterIndex] = updatedChapter

  return { chapters: newChapters }
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
  const storyStateStr = formatStoryState(reconciledState)

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

  const { content, chapterMeta: updatedChapter } = agent.processOutput(
    output,
    existingContent,
    paragraphs,
    affectedIndices,
    state.story.id,
    chapterIndex + 1
  )

  await writeChapterContent(state.story.outputDir, chapterIndex + 1, content)

  const newChapters = [...state.chapters]
  newChapters[chapterIndex] = updatedChapter

  return {
    chapters: newChapters,
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
  const storyStateStr = formatStoryState(reconciledState)

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

  const genre = getGenreSkill(state.genre)
  const min = genre?.chapterWordCountMin ?? DEFAULT_CHAPTER_WORD_COUNT_MIN
  const max = genre?.chapterWordCountMax ?? DEFAULT_CHAPTER_WORD_COUNT_MAX

  const validation = await validateFixedChapterContent(
    rawContent,
    {
      chapterIndex,
      minWordCount: min,
      maxWordCount: max,
    },
    provider
  )

  if (!validation.valid) {
    throw new Error(`第 ${chapterIndex + 1} 章重写后内容校验失败：${validation.error}`)
  }

  rawContent = validation.content ?? rawContent
  const paragraphs = splitIntoParagraphs(existingContent)
  const { content, chapterMeta: updatedChapter } = agent.processOutput(
    { ...output, content: rawContent },
    existingContent,
    paragraphs,
    [],
    state.story.id,
    chapterIndex + 1
  )

  await writeChapterContent(state.story.outputDir, chapterIndex + 1, content)

  const newChapters = [...state.chapters]
  newChapters[chapterIndex] = updatedChapter

  return {
    chapters: newChapters,
  }
}
