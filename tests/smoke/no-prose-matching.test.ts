import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = process.cwd()

const forbiddenRuntimeSnippets: Record<string, string[]> = {
  'src/utils/agent-output.ts': [
    'isSelfWithdrawnIssue',
    'filterIssuesAgainstCanonicalFacts',
    'negationMarkers',
  ],
  'src/core/chapter-generation/issue-classifier.ts': [
    'INTERPRETIVE_KEYWORDS',
    'TASK_KEYWORDS',
    'looksInterpretive',
    'looksTaskRelated',
    'looksInventedCharacter',
    'looksItemLocationConflict',
    'looksOutlineStateConflict',
  ],
  'src/graph/utils/reconciler/sanitize.ts': ['referencesOfficialCharacter'],
  'src/core/outline-expander.ts': [
    'extractOutlineSupportKeywords',
    'claimedBeatSupportedByDescription',
    'findUnsupportedClaimedBeats',
    'isRecoverableJitOutlineConflict',
  ],
  'src/core/runner.ts': [
    'isForeshadowLikelyPolluted',
    'sentenceDelimiters',
    'text.split(sentenceDelimiters)',
  ],
  'src/utils/story-arc.ts': ['matchMandatoryBeat', 'normalizeTextForMatch'],
  'src/agents/foreshadowing.ts': [
    'normalizedChapter.includes',
    'isSemanticallyRelated(item.text!, chapterContent',
    'replace(/[^\\u4e00-\\u9fff]/g',
    'foreshadowMinLength',
    '剔除短文本叙事细节',
  ],
  'src/agents/summary.ts': [
    'subjectEmbedsFactPayload',
    'NOMINALIZED_FACT_LABELS',
    'ambiguousPronouns',
    'MAX_CANONICAL_FACT_SUBJECT_LENGTH',
    'isStructurallyValidCanonicalFactSubject',
  ],
  'src/agents/prompts/chapter-planner-prompt.ts': [
    "description.includes('角色遗漏')",
    '关键词重叠',
  ],
  'src/utils/summary-patch.ts': [
    'normalizeForMatch',
    'findSentenceContaining',
    '.replace(sentence',
  ],
  'src/utils/issue-deduplication.ts': [
    'STOP_WORDS',
    'extractCanonicalTerms',
    'normalizeNumberToken',
    'normalized.match',
    'issue.location ??',
  ],
  'src/utils/chapter-content-validation.ts': ['REVISION_PLAN_KEYWORDS', 'detectRevisionPlanShape'],
  'src/utils/items.ts': ['DESCRIPTIVE_SUFFIXES', '.replace(DESCRIPTIVE_SUFFIXES'],
  'src/utils/character-whitelist.ts': ['stripParentheticalAliases', 'replace(/（[^）]*）/g'],
  'src/utils/established-characters.ts': [
    'stripParentheticalAliases',
    'extractNameFromSummaryEntry',
    'split(/[:：]/)',
  ],
  'src/graph/utils/text-patching.ts': [
    'extractIssueKeywords',
    'keywords.some',
    'issue.description +',
    'issue.location ||',
    'parseChineseNumber',
    'paragraphPatterns',
    'sentencePatterns',
    'deduplicateSentences',
    'deduplicateParagraphBlocks',
    'seenBlocks',
  ],
  'src/utils/text.ts': ['tokenizeWords'],
  'src/graph/services/fix/execution.ts': ['extractIssueKeywords', 'paragraphContent.includes'],
  'src/graph/services/fix/decision.ts': ['issue.location)', '/第\\s*\\d+'],
  'src/core/chapter-generation/routing/index.ts': ['issue.location)', 'new RegExp(`第'],
  'src/agents/chapter.ts': [
    'state.characters.match',
    'extractChapterOutline',
    'split(/[。；',
    '预写对齐检查表',
    '自检清单',
  ],
  'src/graph/services/chapter-orchestration/routing.ts': [
    'issue.description.split',
    'description.slice(0, 20)',
  ],
  'src/graph/utils/reconciler/conflict.ts': [
    'isMentionedInSentence',
    'canonicalizeItemName',
    'outlineWords',
    'secretWords',
    'lastTwo',
    'lastThree',
    'isReliableRetconValue',
    'newValue.length <',
  ],
  'src/utils/outline-characters.ts': ['trimmed.length < 2', 'trimmed.length > 6'],
  'src/graph/utils/reconciler/timeline.ts': [
    'isSupersededFact',
    'text.includes(fact.subject)',
    'text.includes(old.oldValue)',
  ],
  'src/cli/commands/adjust-act.ts': ['description.includes(`第', 'suggestion?.includes'],
}

describe('runtime semantic decisions avoid prose string matching', () => {
  for (const [relativePath, snippets] of Object.entries(forbiddenRuntimeSnippets)) {
    it(`${relativePath} does not contain known prose-matching decision helpers`, () => {
      const source = readFileSync(join(repoRoot, relativePath), 'utf-8')
      for (const snippet of snippets) {
        expect(source, `${relativePath} still contains ${snippet}`).not.toContain(snippet)
      }
    })
  }
})
