import type { Issue } from '../../../types/agent.js'
import type { SentenceFix } from '../../../agents/base.js'
import {
  findAffectedSentences,
  splitParagraphIntoSentences,
} from '../../utils/text-patching.js'

export function buildSentenceFixes(
  paragraphs: string[],
  affectedIndices: number[],
  issues: Issue[]
): SentenceFix[] {
  const sentenceFixes: SentenceFix[] = []

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
