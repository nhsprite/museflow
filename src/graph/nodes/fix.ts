import { logger } from '../../utils/logger.js'
import type { ReducedGraphState } from '../state.js'
import type { ChapterMeta } from '../../types/chapter.js'
import type { AgentState } from '../../agents/base.js'
import { getFixAgent } from '../agent-factory.js'
import { generateId } from '../../utils/id.js'
import { readChapterContent, writeChapterContent } from '../../storage/filesystem/writer.js'
import { getGenreSkill } from '../../genres/registry.js'
import { validateFixedChapterContent } from '../../utils/chapter-content-validation.js'
import { buildCharacterFactTimeline, formatStoryState } from '../utils/story-state.js'
import { prepareStoryStateForChapter } from '../utils/chapter-state-prep.js'
import { buildLayeredSummaries } from '../../utils/summary-compressor.js'
import { buildEffectiveCharactersList, charactersToString } from '../utils/characters.js'
import { buildNextChapterBoundaryHint } from '../../utils/outline-boundary.js'
import { toDisplayChapterNumber } from '../../utils/chapter-display.js'
import {
  splitIntoParagraphs,
  findAffectedParagraphs,
  extractIssueKeywords,
  findAffectedSentences,
  splitParagraphIntoSentences,
  mergeSentenceFixes,
  mergeParagraphFixes,
  applyParagraphDiffProtection,
  deduplicateSentences,
  deduplicateParagraphBlocks,
} from '../utils/text-patching.js'

export async function fix_chapter(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  const agent = getFixAgent()
  const chapterIndex = state.currentChapterIndex
  const outlineItem = state.outline[chapterIndex]

  const existingContent = await readChapterContent(state.story.outputDir, chapterIndex + 1)
  if (!existingContent) {
    throw new Error(
      `第 ${chapterIndex + 1} 章文件不存在，无法修复。请运行 write 或 rewrite。`
    )
  }

  const pendingIssues = state.pendingIssues
  const hasPatchableIssues = pendingIssues.some(issue => {
    if (issue.severity !== 'warning') return true
    if (issue.type === 'consistency' || issue.type === 'hallucination') return true
    if (issue.type === 'quality' && issue.location) {
      return /第\s*\d+\s*[段节]|段落\s*\d+|第\s*\d+\s*句/.test(issue.location)
    }
    return false
  })

  if (!hasPatchableIssues) {
    logger.info('[MuseFlow] 当前警告不适合段落/句子级修复，跳过 fix agent')
    return { chapters: state.chapters }
  }

  const paragraphs = splitIntoParagraphs(existingContent)
  const affectedIndices = findAffectedParagraphs(paragraphs, pendingIssues)

  const previousChapters = buildLayeredSummaries(state.chapterSummaries, chapterIndex)
  const timelineSnapshot = buildCharacterFactTimeline(state, chapterIndex)
  const nextBoundaryHint = buildNextChapterBoundaryHint(state.outline, chapterIndex)

  if (affectedIndices.length === 0) {
    logger.info('[MuseFlow] 未能定位到问题所在段落，将使用全文修复模式')
    return await runLegacyFix(agent, state, existingContent, chapterIndex, outlineItem, previousChapters, timelineSnapshot, nextBoundaryHint)
  }

  const hasErrors = pendingIssues.some(i => i.severity === 'error')
  const AFFECTED_PARAGRAPH_RATIO_THRESHOLD = hasErrors ? 0.4 : 0.65
  const AFFECTED_PARAGRAPH_ABSOLUTE_THRESHOLD = hasErrors ? 20 : 35
  const isConsistencyOrHallucination = pendingIssues.every(
    i => i.type === 'consistency' || i.type === 'hallucination'
  )
  const affectedRatio = paragraphs.length > 0 ? affectedIndices.length / paragraphs.length : 0
  if (
    !isConsistencyOrHallucination &&
    (affectedIndices.length > AFFECTED_PARAGRAPH_ABSOLUTE_THRESHOLD || affectedRatio > AFFECTED_PARAGRAPH_RATIO_THRESHOLD)
  ) {
    logger.info(`[MuseFlow] 问题涉及 ${affectedIndices.length}/${paragraphs.length} 个段落（占比 ${Math.round(affectedRatio * 100)}%），超过修复阈值，转为完整重写`)
    return await runLegacyFix(agent, state, existingContent, chapterIndex, outlineItem, previousChapters, timelineSnapshot, nextBoundaryHint)
  }

  const sentenceFixes = buildSentenceFixes(paragraphs, affectedIndices, pendingIssues)

  if (sentenceFixes.length > 0 && sentenceFixes.length <= 5) {
    logger.info(`[MuseFlow] 定位到 ${sentenceFixes.length} 个需修改的句子，使用句子级精准修复`)
    return await runSentenceFix(agent, state, existingContent, paragraphs, sentenceFixes, chapterIndex, outlineItem, previousChapters, timelineSnapshot, nextBoundaryHint)
  }

  logger.info(`[MuseFlow] 定位到 ${affectedIndices.length} 个需修改的段落，使用段落级修复`)
  return await runParagraphFix(agent, state, existingContent, paragraphs, affectedIndices, chapterIndex, outlineItem, previousChapters, timelineSnapshot, nextBoundaryHint)
}

function buildSentenceFixes(
  paragraphs: string[],
  affectedIndices: number[],
  issues: Array<import('../../types/agent.js').Issue>
): Array<import('../../agents/base.js').SentenceFix> {
  const sentenceFixes: Array<import('../../agents/base.js').SentenceFix> = []

  for (const idx of affectedIndices) {
    const paragraph = paragraphs[idx]
    if (!paragraph) continue

    for (const issue of issues) {
      const affectedSentences = findAffectedSentences(paragraph, issue)
      for (const sentenceIdx of affectedSentences) {
        const sentences = splitParagraphIntoSentences(paragraph)
        const original = sentences[sentenceIdx]
        if (original) {
          sentenceFixes.push({
            paragraphIndex: idx,
            sentenceIndex: sentenceIdx,
            original,
            issue,
          })
        }
      }
    }
  }

  return sentenceFixes
}

async function runSentenceFix(
  agent: import('../../agents/index.js').FixAgent,
  state: ReducedGraphState,
  existingContent: string,
  paragraphs: string[],
  sentenceFixes: Array<import('../../agents/base.js').SentenceFix>,
  chapterIndex: number,
  outlineItem: { description?: string } | undefined,
  previousChapters: string,
  timelineSnapshot: string,
  nextBoundaryHint: string
): Promise<Partial<ReducedGraphState>> {
  const affectedParagraphs = new Set(sentenceFixes.map(s => s.paragraphIndex))

  const contextIndices = new Set<number>()
  for (const idx of affectedParagraphs) {
    if (idx > 0) contextIndices.add(idx - 1)
    if (idx < paragraphs.length - 1) contextIndices.add(idx + 1)
  }
  for (const idx of affectedParagraphs) {
    contextIndices.delete(idx)
  }

  const contextParagraphs = Array.from(contextIndices).sort((a, b) => a - b).map(idx => paragraphs[idx])
  const context = contextParagraphs.join('\n\n')

  const { reconciledState } = prepareStoryStateForChapter(state, chapterIndex)
  const storyStateStr = formatStoryState(reconciledState)

  const { merged: effectiveCharacters, outline: outlineCharacters, established: establishedCharacters } = buildEffectiveCharactersList(state, chapterIndex)

  const agentState: AgentState = {
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

  let content = existingContent
  if (output.data && (output.data as { modifiedSentences?: Array<{ paragraphIndex: number; sentenceIndex: number; content: string }> }).modifiedSentences) {
    const modifiedSentences = (output.data as { modifiedSentences: Array<{ paragraphIndex: number; sentenceIndex: number; content: string }> }).modifiedSentences
    const modifiedParagraphs = new Map<number, Array<{ index: number; content: string }>>()

    for (const s of modifiedSentences) {
      if (!modifiedParagraphs.has(s.paragraphIndex)) {
        modifiedParagraphs.set(s.paragraphIndex, [])
      }
      modifiedParagraphs.get(s.paragraphIndex)!.push({ index: s.sentenceIndex, content: s.content })
    }

    const resultParagraphs = [...paragraphs]
    for (const [pIdx, sentences] of modifiedParagraphs) {
      const originalParagraph = paragraphs[pIdx]
      if (originalParagraph) {
        resultParagraphs[pIdx] = mergeSentenceFixes(originalParagraph, sentences)
      }
    }
    content = resultParagraphs.join('\n\n')
  } else {
    if (!output.success && output.error) {
      throw new Error(`第 ${chapterIndex + 1} 章修复失败：${output.error}`)
    }
    content = output.content ?? ''
    if (!content || content.trim().length === 0) {
      throw new Error(`第 ${chapterIndex + 1} 章修复后内容为空，AI 未返回有效内容。请检查模型配置或重试。`)
    }
    const affectedIndices = Array.from(new Set(sentenceFixes.map(s => s.paragraphIndex)))
    content = applyParagraphDiffProtection(existingContent, content, affectedIndices)
  }

  content = deduplicateSentences(content)
  content = deduplicateParagraphBlocks(content)
  await writeChapterContent(state.story.outputDir, chapterIndex + 1, content)

  const now = Date.now()
  const updatedChapter: ChapterMeta = {
    id: generateId(),
    storyId: state.story.id,
    number: toDisplayChapterNumber(chapterIndex),
    title: null,
    outline: outlineItem?.description || null,
    summary: null,
    foreshadows: null,
    status: 'drafting',
    createdAt: now,
    updatedAt: now,
  }

  const newChapters = [...state.chapters]
  newChapters[chapterIndex] = updatedChapter

  return { chapters: newChapters }
}

async function runParagraphFix(
  agent: import('../../agents/index.js').FixAgent,
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
  const paragraphFixes = affectedIndices.map(idx => {
    const paragraphContent = paragraphs[idx]
    if (!paragraphContent) {
      throw new Error(`段落索引 ${idx} 超出范围`)
    }
    return {
      index: idx,
      content: paragraphContent,
      issues: state.pendingIssues.filter(issue => {
        const keywords = extractIssueKeywords(issue)
        return keywords.some(kw => paragraphContent.includes(kw))
      }),
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

  const contextParagraphs = Array.from(contextIndices).sort((a, b) => a - b).map(idx => paragraphs[idx])
  const context = contextParagraphs.join('\n\n')

  const { reconciledState } = prepareStoryStateForChapter(state, chapterIndex)
  const storyStateStr = formatStoryState(reconciledState)

  const { merged: effectiveCharacters, outline: outlineCharacters, established: establishedCharacters } = buildEffectiveCharactersList(state, chapterIndex)

  const agentState: AgentState = {
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

  let content: string
  if (output.data && (output.data as { modifiedParagraphs?: Array<{ index: number; content: string }> }).modifiedParagraphs) {
    const modifiedParagraphs = (output.data as { modifiedParagraphs: Array<{ index: number; content: string }> }).modifiedParagraphs
    content = mergeParagraphFixes(paragraphs, modifiedParagraphs, affectedIndices)
  } else {
    if (!output.success && output.error) {
      throw new Error(`第 ${chapterIndex + 1} 章修复失败：${output.error}`)
    }
    content = output.content ?? ''
    if (!content || content.trim().length === 0) {
      throw new Error(`第 ${chapterIndex + 1} 章修复后内容为空，AI 未返回有效内容。请检查模型配置或重试。`)
    }
    content = applyParagraphDiffProtection(existingContent, content, affectedIndices)
  }

  content = deduplicateSentences(content)
  content = deduplicateParagraphBlocks(content)
  await writeChapterContent(state.story.outputDir, chapterIndex + 1, content)

  const now = Date.now()
  const updatedChapter: ChapterMeta = {
    id: generateId(),
    storyId: state.story.id,
    number: toDisplayChapterNumber(chapterIndex),
    title: null,
    outline: outlineItem?.description || null,
    summary: null,
    foreshadows: null,
    status: 'drafting',
    createdAt: now,
    updatedAt: now,
  }

  const newChapters = [...state.chapters]
  newChapters[chapterIndex] = updatedChapter

  return {
    chapters: newChapters,
  }
}

export async function runLegacyFix(
  agent: import('../../agents/index.js').FixAgent,
  state: ReducedGraphState,
  existingContent: string,
  chapterIndex: number,
  outlineItem: { description?: string } | undefined,
  previousChapters: string,
  timelineSnapshot: string,
  nextBoundaryHint: string
): Promise<Partial<ReducedGraphState>> {
  const { reconciledState } = prepareStoryStateForChapter(state, chapterIndex)
  const storyStateStr = formatStoryState(reconciledState)

  const { merged: effectiveCharacters, outline: outlineCharacters, established: establishedCharacters } = buildEffectiveCharactersList(state, chapterIndex)

  const agentState: AgentState = {
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

  let content = output.content ?? ''
  if (!content || content.trim().length === 0) {
    throw new Error(`第 ${chapterIndex + 1} 章重写后内容为空，AI 未返回有效内容。请检查模型配置或重试。`)
  }

  const genre = getGenreSkill(state.genre)
  const min = genre?.chapterWordCountMin ?? 1500
  const max = genre?.chapterWordCountMax ?? 8000

  const validation = validateFixedChapterContent(content, {
    chapterIndex,
    minWordCount: min,
    maxWordCount: max,
  })

  if (!validation.valid) {
    throw new Error(`第 ${chapterIndex + 1} 章重写后内容校验失败：${validation.error}`)
  }

  content = validation.content ?? content
  content = deduplicateSentences(content)
  content = deduplicateParagraphBlocks(content)
  await writeChapterContent(state.story.outputDir, chapterIndex + 1, content)

  const now = Date.now()
  const updatedChapter: ChapterMeta = {
    id: generateId(),
    storyId: state.story.id,
    number: toDisplayChapterNumber(chapterIndex),
    title: null,
    outline: outlineItem?.description || null,
    summary: null,
    foreshadows: null,
    status: 'drafting',
    createdAt: now,
    updatedAt: now,
  }

  const newChapters = [...state.chapters]
  newChapters[chapterIndex] = updatedChapter

  return {
    chapters: newChapters,
  }
}

// Re-export text-patching helpers used by tests and other modules
export {
  splitIntoParagraphs,
  extractLocationInfo,
  extractIssueKeywords,
  findAffectedParagraphs,
  splitParagraphIntoSentences,
  findAffectedSentences,
  mergeSentenceFixes,
  mergeParagraphFixes,
  applyParagraphDiffProtection,
  deduplicateSentences,
  deduplicateParagraphBlocks,
} from '../utils/text-patching.js'
