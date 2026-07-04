import type { ModelProvider } from '../model/provider.js'
import { BaseAgent, type AgentOutput } from './base.js'
import type { FixAgentInput } from './types.js'
import type { ChapterMeta } from '../types/chapter.js'
import { generateId } from '../utils/id.js'
import { toDisplayChapterNumber } from '../utils/chapter-display.js'
import {
  buildFixSystemPrompt,
  buildFixPromptSections,
  buildSentenceTargetSection,
  buildParagraphTargetSection,
  buildSentenceUserPrompt,
  buildParagraphUserPrompt,
  buildLegacyUserPrompt,
} from './prompts/fix-prompt.js'
import {
  mergeSentenceFixes,
  mergeParagraphFixes,
  applyParagraphDiffProtection,
} from '../graph/utils/text-patching.js'

export class FixAgent extends BaseAgent<FixAgentInput> {
  constructor(provider: ModelProvider) {
    super(provider, 0.5)
  }

  protected buildPrompt(state: FixAgentInput): import('../model/provider.js').Message[] {
    const chapterIndex = state.chapterIndex ?? 0
    const displayChapterNumber = String(toDisplayChapterNumber(chapterIndex))

    if (state.sentenceFix && state.sentenceFix.sentences.length > 0) {
      return this.buildSentencePrompt(state, displayChapterNumber)
    }

    if (state.paragraphFix && state.paragraphFix.paragraphs.length > 0) {
      return this.buildParagraphPrompt(state, displayChapterNumber)
    }

    return this.buildLegacyPrompt(state, displayChapterNumber)
  }

  private buildSentencePrompt(state: FixAgentInput, displayChapterNumber: string): import('../model/provider.js').Message[] {
    const { sentences, context } = state.sentenceFix!
    const targetSection = buildSentenceTargetSection(sentences)
    const sections = buildFixPromptSections(state, targetSection)

    const userContent = buildSentenceUserPrompt({ ...sections, context }, { displayChapterNumber })

    return [this.systemMessage(buildFixSystemPrompt('sentence')), this.userMessage(userContent)]
  }

  private buildParagraphPrompt(state: FixAgentInput, displayChapterNumber: string): import('../model/provider.js').Message[] {
    const { paragraphs, context } = state.paragraphFix!
    const issueIndexMap = new Map(state.issues?.map((issue, idx) => [issue, idx + 1]) ?? [])
    const targetSection = buildParagraphTargetSection(paragraphs, issueIndexMap)
    const sections = buildFixPromptSections(state, targetSection)

    const userContent = buildParagraphUserPrompt({ ...sections, context }, { displayChapterNumber })

    return [this.systemMessage(buildFixSystemPrompt('paragraph')), this.userMessage(userContent)]
  }

  private buildLegacyPrompt(state: FixAgentInput, displayChapterNumber: string): import('../model/provider.js').Message[] {
    const sections = buildFixPromptSections(state, '')
    const userContent = buildLegacyUserPrompt(sections, { displayChapterNumber })

    return [this.systemMessage(buildFixSystemPrompt('legacy')), this.userMessage(userContent)]
  }

  protected parse(content: string): AgentOutput {
    const markerStart = '=== FIXED_CHAPTER ==='
    const markerEnd = '=== END_FIXED_CHAPTER ==='
    let extractedContent: string

    const startIndex = content.indexOf(markerStart)
    if (startIndex !== -1) {
      const endIndex = content.indexOf(markerEnd, startIndex + markerStart.length)
      const sliceEnd = endIndex !== -1 ? endIndex : content.length
      extractedContent = content.slice(startIndex + markerStart.length, sliceEnd).trim()
    } else {
      extractedContent = content.trim()
    }

    const sentencePattern = /【段落\s*(\d+)\s*·\s*第\s*(\d+)\s*句】\s*([\s\S]*?)(?=\s*【段落\s*\d+\s*·\s*第\s*\d+\s*句】|$)/g
    const modifiedSentences: Array<{ paragraphIndex: number; sentenceIndex: number; content: string }> = []

    let sentenceMatch
    while ((sentenceMatch = sentencePattern.exec(extractedContent)) !== null) {
      const paragraphIndex = parseInt(sentenceMatch[1] ?? '0', 10)
      const sentenceIndex = parseInt(sentenceMatch[2] ?? '0', 10) - 1
      const sentenceContent = (sentenceMatch[3] ?? '').trim()
      modifiedSentences.push({ paragraphIndex, sentenceIndex, content: sentenceContent })
    }

    if (modifiedSentences.length > 0) {
      return { success: true, content: extractedContent, data: { modifiedSentences } }
    }

    const paragraphPattern = /【段落\s*(\d+)】\s*([\s\S]*?)(?=\s*【段落\s*\d+】|$)/g
    const modifiedParagraphs: Array<{ index: number; content: string }> = []

    let match
    while ((match = paragraphPattern.exec(extractedContent)) !== null) {
      const index = parseInt(match[1] ?? '0', 10)
      const paragraphContent = (match[2] ?? '').trim()
      modifiedParagraphs.push({ index, content: paragraphContent })
    }

    if (modifiedParagraphs.length > 0) {
      return { success: true, content: extractedContent, data: { modifiedParagraphs } }
    }

    return { success: true, content: extractedContent }
  }

  processOutput(
    output: AgentOutput,
    existingContent: string,
    paragraphs: string[],
    affectedIndices: number[],
    _storyId: string,
    _chapterIndex: number
  ): { content: string; chapterMeta: ChapterMeta } {
    const content = this.buildFixedContent(output, existingContent, paragraphs, affectedIndices)

    const now = Date.now()
    const chapterMeta: ChapterMeta = {
      id: generateId(),
      storyId: _storyId,
      number: _chapterIndex,
      title: null,
      outline: null,
      summary: null,
      foreshadows: null,
      status: 'drafting',
      createdAt: now,
      updatedAt: now,
    }

    return { content, chapterMeta }
  }

  private buildFixedContent(
    output: AgentOutput,
    existingContent: string,
    paragraphs: string[],
    affectedIndices: number[]
  ): string {
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
      return resultParagraphs.join('\n\n')
    }

    if (output.data && (output.data as { modifiedParagraphs?: Array<{ index: number; content: string }> }).modifiedParagraphs) {
      const modifiedParagraphs = (output.data as { modifiedParagraphs: Array<{ index: number; content: string }> }).modifiedParagraphs
      return mergeParagraphFixes(paragraphs, modifiedParagraphs, affectedIndices)
    }

    if (!output.success && output.error) {
      throw new Error(`修复失败：${output.error}`)
    }

    let content = output.content ?? ''
    if (!content || content.trim().length === 0) {
      throw new Error(`修复后内容为空，AI 未返回有效内容。请检查模型配置或重试。`)
    }

    return applyParagraphDiffProtection(existingContent, content, affectedIndices)
  }
}
