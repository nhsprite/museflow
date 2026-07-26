import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = process.cwd()

function listTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return listTypeScriptFiles(path)
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : []
  })
}

const runtimeSourceFiles = listTypeScriptFiles(join(repoRoot, 'src'))

const forbiddenRuntimeIdentifiers = [
  'hashIssueDescription',
  'deriveAliases',
  'canonicalizeItemName',
  'resolveCanonicalItemGroup',
  "actualValue.includes(' ')",
  "expectedValue.includes(' ')",
  'charactersList?.[0]?.name',
]

const forbiddenForeshadowProseDecisionSnippets = [
  '.text.includes(',
  '.text.startsWith(',
  '.text.endsWith(',
  '.text.match(',
  '.text.replace(',
  '.text.split(',
  'normalizeTextForMatch',
  'extractSemanticKeywords',
]

const forbiddenRuntimeSnippets: Record<string, string[]> = {
  'src/graph/services/foreshadow-equivalence/detector.ts': forbiddenForeshadowProseDecisionSnippets,
  'src/graph/services/foreshadow-equivalence/reconcile.ts':
    forbiddenForeshadowProseDecisionSnippets,
  'src/story-memory/foreshadow-alias.ts': forbiddenForeshadowProseDecisionSnippets,
  'src/story-memory/foreshadow-introduction.ts': forbiddenForeshadowProseDecisionSnippets,
  'src/utils/story-memory-constraints.ts': forbiddenForeshadowProseDecisionSnippets,
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
    'getMandatoryBeatIdByText',
  ],
  'src/core/runner.ts': [
    'isForeshadowLikelyPolluted',
    'sentenceDelimiters',
    'text.split(sentenceDelimiters)',
    'issueIds.has(issue.id)',
  ],
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
  'src/cli/commands/adjust-act.ts': [
    'description.includes(`第',
    'suggestion?.includes',
    'issue.id.startsWith',
    'issue.id === `act-',
  ],
  'src/graph/services/finalization/act-progress.ts': [
    'normalizeVerifiedBeats',
    'findIssueMandatoryBeat',
    'getClaimedBeatTexts',
    'updateActProgressFromOutline',
    'verifiedBeats.includes',
    'mandatoryBeats.includes',
  ],
  'src/graph/services/finalization/chapter.ts': [
    'newIssueIds',
    'actBoundaryIssueIds',
    'newIssueIds.has(i.id)',
    'storyArc.keyBeats.length === 0',
  ],
  'src/story-memory/projector.ts': ['storyArc.keyBeats.length === 0'],
  'src/graph/nodes/validation.ts': ['pendingIssues.map((i) => i.id)'],
  'src/graph/nodes/repair-state.ts': ['repairedIssueIds'],
  'src/core/act-progress-projection.ts': ['findClaimedMandatoryBeatForId'],
  'src/core/rewrite-state.ts': [
    'getTrustedOutlineVerifiedBeatsForRewrite',
    'findClaimedMandatoryBeatForId',
    'mandatoryBeats.includes',
  ],
  'src/agents/chapter-outline.ts': ['getMandatoryBeatIdByText'],
  'src/utils/mandatory-beat-ids.ts': ['getMandatoryBeatIdByText'],
  'src/utils/story-arc.ts': [
    'matchMandatoryBeat',
    'normalizeTextForMatch',
    'judgeMandatoryBeatCoverage',
    'AUTO_ADJUST_MAX_EXTENSION',
    'AUTO_ADJUST_MAX_CUMULATIVE_EXTENSION',
    'AUTO_ADJUST_MAX_GLOBAL_EXTENSION_RATIO',
    'progress.consumed.includes(kb.beat)',
  ],
}

describe('runtime semantic decisions avoid prose string matching', () => {
  it('keeps retired prose-based identity and fingerprint helpers out of all runtime source', () => {
    const matches = runtimeSourceFiles.flatMap((path) => {
      const source = readFileSync(path, 'utf-8')
      return forbiddenRuntimeIdentifiers
        .filter((identifier) => source.includes(identifier))
        .map((identifier) => `${relative(repoRoot, path)}: ${identifier}`)
    })

    expect(matches, `retired runtime constructs found:\n${matches.join('\n')}`).toEqual([])
  })

  for (const [relativePath, snippets] of Object.entries(forbiddenRuntimeSnippets)) {
    it(`${relativePath} does not contain known prose-matching decision helpers`, () => {
      const source = readFileSync(join(repoRoot, relativePath), 'utf-8')
      for (const snippet of snippets) {
        expect(source, `${relativePath} still contains ${snippet}`).not.toContain(snippet)
      }
    })
  }
})

// 正向扫描：禁止以散文接收者（description/prose/summary/paragraph/sentence/text/content）
// 调用字符串谓词做语义决策。与上面的退役清单（防已知债务回归）互补，本扫描防新增。
// 命中的行必须是显式机器格式解析（协议标记、Markdown 标题、字符类计数、句子索引切分），
// 并按 文件 -> 行内容 列入豁免清单；新增豁免需在 code review 中确认该行不触碰散文语义。
const proseDecisionLinePattern =
  /\b(?:description|prose|summary|paragraph|sentence|text|content)(?:\?\.|\.)(?:includes|startsWith|endsWith|match|matchAll|indexOf)\(/

const proseDecisionAllowlist: Record<string, string[]> = {
  'src/agents/fix.ts': [
    'const chapterContentMatch = content.match(/===\\s*CHAPTER_CONTENT\\s*===([\\s\\S]*)/i)',
    'const headingMatch = content.match(CHAPTER_TITLE_ONLY_PATTERN)',
    'const startIndex = content.indexOf(markerStart)',
    'const endIndex = content.indexOf(markerEnd, startIndex + markerStart.length)',
  ],
  'src/agents/summary.ts': [
    'const summaryMatch = content.match(/<chapter_summary>([\\s\\S]*?)<\\/chapter_summary>/i)',
    'const handoffMatch = content.match(/<chapter_handoff>([\\s\\S]*?)<\\/chapter_handoff>/i)',
    'const eventsMatch = content.match(/<story_events>([\\s\\S]*?)<\\/story_events>/i)',
  ],
  'src/agents/chapter.ts': [
    'const standardPreWriteMatch = content.match(',
    'const standardContentMatch = content.match(/===\\s*CHAPTER_CONTENT\\s*===([\\s\\S]*)/i)',
    'const match = text.match(CHAPTER_TITLE_ONLY_PATTERN)',
  ],
  'src/utils/text.ts': [
    'const chineseChars = (text.match(/[\\u4e00-\\u9fff\\u3400-\\u4dbf]/g) ?? []).length',
    'const englishWords = (text.match(/[a-zA-Z]+/g) ?? []).length',
  ],
  'src/story-memory/parser.ts': [
    'const match = text.match(/=== STORY_EVENTS ===\\n([\\s\\S]*?)\\n=== CHAPTER_CONTENT ===/)',
    'const match = text.match(FINAL_STATE_BLOCK_PATTERN)',
  ],
  'src/graph/utils/text-patching.ts': [
    'const matches = [...paragraph.matchAll(/[^。！？\\n]+[。！？\\n]?/g)]',
  ],
}

describe('prose-anchored string predicates require explicit allowlist entries', () => {
  it('finds no prose-anchored string decisions outside the allowlist', () => {
    const hits = runtimeSourceFiles.flatMap((path) => {
      const relativePath = relative(repoRoot, path)
      const allowed = new Set(proseDecisionAllowlist[relativePath] ?? [])
      return readFileSync(path, 'utf-8')
        .split('\n')
        .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
        .filter(({ line }) => proseDecisionLinePattern.test(line))
        .filter(({ line }) => !allowed.has(line))
        .map(({ line, lineNumber }) => `${relativePath}:${lineNumber}: ${line}`)
    })

    expect(hits, `prose-anchored string decisions found:\n${hits.join('\n')}`).toEqual([])
  })
})
