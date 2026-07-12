import type { ModelProvider } from '../model/provider.js'
import { BaseAgent, type AgentOutput } from './base.js'
import type { FixAgentInput } from './types.js'
import type { ChapterMeta } from '../types/chapter.js'
import type { Issue } from '../types/agent.js'
import { generateId } from '../utils/id.js'
import { toDisplayChapterNumber } from '../utils/chapter-display.js'
import { CHAPTER_TITLE_ONLY_PATTERN } from '../utils/chapter-content-validation.js'
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

  private buildSentencePrompt(
    state: FixAgentInput,
    displayChapterNumber: string
  ): import('../model/provider.js').Message[] {
    const { sentences, context } = state.sentenceFix!
    const targetSection = buildSentenceTargetSection(sentences)
    const sections = buildFixPromptSections(state, targetSection)

    const userContent = buildSentenceUserPrompt({ ...sections, context }, { displayChapterNumber })

    return [this.systemMessage(buildFixSystemPrompt('sentence')), this.userMessage(userContent)]
  }

  private buildParagraphPrompt(
    state: FixAgentInput,
    displayChapterNumber: string
  ): import('../model/provider.js').Message[] {
    const { paragraphs, context } = state.paragraphFix!
    const issueIndexMap = new Map(state.issues?.map((issue, idx) => [issue, idx + 1]) ?? [])
    const targetSection = buildParagraphTargetSection(paragraphs, issueIndexMap)
    const sections = buildFixPromptSections(state, targetSection)

    const userContent = buildParagraphUserPrompt({ ...sections, context }, { displayChapterNumber })

    return [this.systemMessage(buildFixSystemPrompt('paragraph')), this.userMessage(userContent)]
  }

  private buildLegacyPrompt(
    state: FixAgentInput,
    displayChapterNumber: string
  ): import('../model/provider.js').Message[] {
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

    // The model sometimes emits a pre-write checklist before the actual chapter heading.
    // Strip it so downstream validation does not mistake it for machine artifacts in the body.
    extractedContent = this.stripPreWriteArtifacts(extractedContent)

    const sentencePattern =
      /【段落\s*(\d+)\s*·\s*第\s*(\d+)\s*句】\s*([\s\S]*?)(?=\s*【段落\s*\d+\s*·\s*第\s*\d+\s*句】|$)/g
    const modifiedSentences: Array<{
      paragraphIndex: number
      sentenceIndex: number
      content: string
    }> = []

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

  private stripPreWriteArtifacts(content: string): string {
    // If the model wrapped the real body in a CHAPTER_CONTENT marker, prefer that.
    const chapterContentMatch = content.match(/===\s*CHAPTER_CONTENT\s*===([\s\S]*)/i)
    if (chapterContentMatch && chapterContentMatch[1]) {
      return chapterContentMatch[1].trim()
    }

    if (!/===\s*PRE_WRITE_CHECK\s*===/i.test(content)) {
      return content
    }

    const headingMatch = content.match(CHAPTER_TITLE_ONLY_PATTERN)
    if (headingMatch && headingMatch.index !== undefined && headingMatch.index > 0) {
      return content.slice(headingMatch.index).trim()
    }

    return content
  }

  processOutput(
    output: AgentOutput,
    existingContent: string,
    paragraphs: string[],
    affectedIndices: number[],
    _storyId: string,
    _chapterIndex: number
  ): { content: string; chapterMeta: ChapterMeta; issues: Issue[] } {
    const { content, issues } = this.buildFixedContent(
      output,
      existingContent,
      paragraphs,
      affectedIndices
    )

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

    return { content, chapterMeta, issues }
  }

  private buildFixedContent(
    output: AgentOutput,
    existingContent: string,
    paragraphs: string[],
    affectedIndices: number[]
  ): { content: string; issues: Issue[] } {
    const issues: Issue[] = []

    if (
      output.data &&
      (
        output.data as {
          modifiedSentences?: Array<{
            paragraphIndex: number
            sentenceIndex: number
            content: string
          }>
        }
      ).modifiedSentences
    ) {
      const modifiedSentences = (
        output.data as {
          modifiedSentences: Array<{
            paragraphIndex: number
            sentenceIndex: number
            content: string
          }>
        }
      ).modifiedSentences
      const modifiedParagraphs = new Map<number, Array<{ index: number; content: string }>>()

      for (const s of modifiedSentences) {
        if (!modifiedParagraphs.has(s.paragraphIndex)) {
          modifiedParagraphs.set(s.paragraphIndex, [])
        }
        modifiedParagraphs
          .get(s.paragraphIndex)!
          .push({ index: s.sentenceIndex, content: s.content })
      }

      const affectedSet = new Set(affectedIndices)
      const coveredParagraphs = new Set<number>()
      const resultParagraphs = [...paragraphs]
      for (const [pIdx, sentences] of modifiedParagraphs) {
        const originalParagraph = paragraphs[pIdx]
        if (!originalParagraph) {
          issues.push(
            buildFixMergeIssue(`模型返回了超出范围的段落索引 ${pIdx}，已忽略该修改`, {
              patchable: false,
            })
          )
          continue
        }
        if (!affectedSet.has(pIdx)) {
          issues.push(
            buildFixMergeIssue(`模型返回了未受影响段落 ${pIdx} 的修改，已按范围过滤忽略`, {
              patchable: false,
            })
          )
          continue
        }
        resultParagraphs[pIdx] = mergeSentenceFixes(originalParagraph, sentences)
        coveredParagraphs.add(pIdx)
      }
      for (const idx of affectedIndices) {
        if (!coveredParagraphs.has(idx)) {
          issues.push(buildUncoveredParagraphIssue(idx))
        }
      }
      return { content: resultParagraphs.join('\n\n'), issues }
    }

    if (
      output.data &&
      (output.data as { modifiedParagraphs?: Array<{ index: number; content: string }> })
        .modifiedParagraphs
    ) {
      const modifiedParagraphs = (
        output.data as { modifiedParagraphs: Array<{ index: number; content: string }> }
      ).modifiedParagraphs
      const merge = mergeParagraphFixes(paragraphs, modifiedParagraphs, affectedIndices)
      for (const skip of merge.skipped) {
        issues.push(
          buildFixMergeIssue(
            skip.reason === 'empty_content'
              ? `模型对段落 ${skip.index} 返回了空内容，已保留原文以避免静默删段`
              : `模型返回了超出范围的段落索引 ${skip.index}，已忽略该修改`,
            skip.reason === 'empty_content' ? { paragraphIndex: skip.index, patchable: true } : {}
          )
        )
      }
      for (const idx of merge.uncoveredIndices) {
        issues.push(buildUncoveredParagraphIssue(idx))
      }
      return { content: merge.content, issues }
    }

    if (!output.success && output.error) {
      throw new Error(`修复失败：${output.error}`)
    }

    let content = output.content ?? ''
    if (!content || content.trim().length === 0) {
      throw new Error(`修复后内容为空，AI 未返回有效内容。请检查模型配置或重试。`)
    }

    return {
      content: applyParagraphDiffProtection(existingContent, content, affectedIndices),
      issues,
    }
  }
}

/**
 * 修复合并阶段的警告 issue。
 * patchable=true 时携带结构化 locationRef，使下一轮 fix 能再次定位该段落；
 * patchable=false 时标记为 quality 维度且无 locationRef，仅记录不触发再修复。
 */
function buildFixMergeIssue(
  description: string,
  options: { paragraphIndex?: number; patchable?: boolean } = {}
): Issue {
  const patchable = options.patchable ?? false
  return {
    id: generateId(),
    type: 'consistency',
    severity: 'warning',
    description,
    ...(patchable ? { retryStrategy: 'fix' as const } : { dimension: 'quality' }),
    ...(options.paragraphIndex !== undefined
      ? { locationRef: { paragraphIndex: options.paragraphIndex } }
      : {}),
  }
}

function buildUncoveredParagraphIssue(paragraphIndex: number): Issue {
  return {
    id: generateId(),
    type: 'consistency',
    severity: 'warning',
    description: `受影响段落 ${paragraphIndex} 未被模型修改，相关问题可能仍未解决`,
    retryStrategy: 'fix',
    locationRef: { paragraphIndex },
  }
}
