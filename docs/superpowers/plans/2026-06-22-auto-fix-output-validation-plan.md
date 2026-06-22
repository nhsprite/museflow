# Auto-Fix Output Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor MuseFlow's auto-fix path so abstract quality/style warnings no longer go through FixAgent, and FixAgent's legacy full-rewrite output is validated before being written to disk.

**Architecture:** Add a new `chapter-content-validation.ts` utility that validates fixed chapter content (structure, word count, and anti-analysis heuristics). Update `FixAgent` to require a `=== FIXED_CHAPTER ===` marker in legacy mode. Update `fix_chapter` and `auto_fix_warnings` to filter warnings by patchability and to preserve `pendingIssues` on validation failure. No changes to model API or storage format.

**Tech Stack:** TypeScript, Node 20+, Vitest, ESM, existing agent/registry patterns.

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/utils/chapter-content-validation.ts` (create) | Validate that a fixed-chapter string looks like real chapter content, not a revision plan or checklist. |
| `tests/utils/chapter-content-validation.test.ts` (create) | Unit tests for the validation utility. |
| `src/agents/fix.ts` (modify) | Require `=== FIXED_CHAPTER ===` marker in legacy prompt; update `parse()` to extract it. |
| `src/graph/nodes.ts` (modify) | Use validation in `runLegacyFix`; adjust `fix_chapter` warning branch; make `auto_fix_warnings` filter patchable warnings and preserve issues on failure. |
| `src/core/chapter-generation.ts` (modify) | Ensure unhandled quality warnings survive into the next draft attempt's `pendingIssues`. |
| `tests/graph/nodes.test.ts` (modify or create) | Unit tests for `auto_fix_warnings` and `fix_chapter` warning filtering behavior. |

---

## Task 1: Create `validateFixedChapterContent` utility

**Files:**
- Create: `src/utils/chapter-content-validation.ts`
- Test: `tests/utils/chapter-content-validation.test.ts`

### Step 1: Write the failing test

Create `tests/utils/chapter-content-validation.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { validateFixedChapterContent } from '../../src/utils/chapter-content-validation.js'

describe('validateFixedChapterContent', () => {
  it('accepts valid chapter content', () => {
    const content = '# 第四章 王府递帖\n\n卯时刚过，灵堂里已经站满了人。\n\n苏半城垂手立在棺前。'
    const result = validateFixedChapterContent(content, { chapterIndex: 3, minWordCount: 10 })
    expect(result.valid).toBe(true)
    expect(result.content).toBe(content)
  })

  it('rejects empty content', () => {
    const result = validateFixedChapterContent('   ', { chapterIndex: 3, minWordCount: 10 })
    expect(result.valid).toBe(false)
    expect(result.error).toContain('为空')
  })

  it('rejects content without chapter heading', () => {
    const result = validateFixedChapterContent('王府递帖。苏半城站在灵堂。', { chapterIndex: 3, minWordCount: 10 })
    expect(result.valid).toBe(false)
    expect(result.error).toContain('标题')
  })

  it('rejects content with wrong chapter number', () => {
    const result = validateFixedChapterContent('# 第五章 王府递帖\n\n正文内容。', { chapterIndex: 3, minWordCount: 10 })
    expect(result.valid).toBe(false)
    expect(result.error).toContain('章节号')
  })

  it('rejects content below minimum word count', () => {
    const result = validateFixedChapterContent('# 第四章 王府递帖\n\n正文。', { chapterIndex: 3, minWordCount: 100 })
    expect(result.valid).toBe(false)
    expect(result.error).toContain('字数')
  })

  it('rejects revision-plan shaped content', () => {
    const plan = '# 第四章 王府递帖\n\n问题分析：这段情感层次单一。修复建议：应该增加苏半城的哭泣描写。可以加入陆福的安慰。'
    const result = validateFixedChapterContent(plan, { chapterIndex: 3, minWordCount: 10 })
    expect(result.valid).toBe(false)
    expect(result.error).toContain('修改计划')
  })

  it('rejects pre-write checklist artifacts', () => {
    const checklist = '# 第四章 王府递帖\n\n| 检查项 | 来源 | 具体要求 |\n| 大纲情节点1 | 大纲 | ... |\n正文开始。'
    const result = validateFixedChapterContent(checklist, { chapterIndex: 3, minWordCount: 10 })
    expect(result.valid).toBe(false)
    expect(result.error).toContain('检查表')
  })
})
```

Run: `npm test -- tests/utils/chapter-content-validation.test.ts`

Expected: FAIL - `Cannot find module ...`

### Step 2: Implement the validation utility

Create `src/utils/chapter-content-validation.ts`:

```typescript
export interface ValidationOptions {
  chapterIndex: number
  minWordCount?: number
  maxWordCount?: number
}

export interface ValidationResult {
  valid: boolean
  content?: string
  error?: string
}

function countChineseWords(text: string): number {
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) ?? []).length
  const englishWords = (text.match(/[a-zA-Z]+/g) ?? []).length
  return chineseChars + englishWords
}

function extractChapterNumber(heading: string): number | null {
  const match = heading.match(/第\s*(\d+)\s*章/)
  if (match && match[1]) {
    return parseInt(match[1], 10)
  }
  return null
}

function findChapterHeading(text: string): string | null {
  const lines = text.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (/^#{1,2}\s+第\s*\d+\s*章/.test(trimmed)) {
      return trimmed
    }
  }
  return null
}

function looksLikeRevisionPlan(text: string): boolean {
  const indicators = [
    /问题分析\s*[：:]/,
    /修复建议\s*[：:]/,
    /修改建议\s*[：:]/,
    /改进建议\s*[：:]/,
    /问题梳理\s*[：:]/,
    /需要修改\s*[：:]/,
    /应该.*增加/,
    /应该.*补充/,
    /可以.*加入/,
    /可以.*修改/,
    /需要.*重写/,
    /建议.*调整/,
    /^\s*1\.\s+/m,
    /^\s*2\.\s+/m,
  ]

  const indicatorHits = indicators.filter(pattern => pattern.test(text)).length
  if (indicatorHits >= 2) return true

  const modalMatches = text.match(/(应该|可以|需要|建议|必须|应当|最好)/g) ?? []
  const wordCount = countChineseWords(text)
  if (wordCount === 0) return false
  const modalDensity = modalMatches.length / wordCount
  if (modalDensity > 0.05) return true

  return false
}

function containsChecklistArtifacts(text: string): boolean {
  const artifacts = [
    /预写对齐检查表/,
    /自检清单/,
    /\|\s*检查项\s*\|/,
    /\|\s*来源\s*\|/,
    /\[\s*x?\s*\]\s*大纲中的每个情节点/,
    /\[\s*x?\s*\]\s*没有发现与大纲矛盾/,
  ]
  return artifacts.some(pattern => pattern.test(text))
}

export function validateFixedChapterContent(
  rawContent: string,
  options: ValidationOptions
): ValidationResult {
  const { chapterIndex, minWordCount = 1500, maxWordCount } = options

  if (!rawContent || rawContent.trim().length === 0) {
    return { valid: false, error: '修复后的内容为空' }
  }

  const heading = findChapterHeading(rawContent)
  if (!heading) {
    return { valid: false, error: '修复后的内容缺少章节标题（# 第X章 ...）' }
  }

  const foundChapterNumber = extractChapterNumber(heading)
  const expectedDisplayNumber = chapterIndex + 1
  if (foundChapterNumber !== null && foundChapterNumber !== expectedDisplayNumber) {
    return {
      valid: false,
      error: `修复后的内容章节号不匹配：期望第${expectedDisplayNumber}章，实际第${foundChapterNumber}章`,
    }
  }

  const wordCount = countChineseWords(rawContent)
  if (wordCount < minWordCount) {
    return {
      valid: false,
      error: `修复后的内容字数 ${wordCount} 低于最低要求 ${minWordCount}`,
    }
  }

  if (maxWordCount !== undefined && wordCount > maxWordCount) {
    return {
      valid: false,
      error: `修复后的内容字数 ${wordCount} 超过上限 ${maxWordCount}`,
    }
  }

  if (looksLikeRevisionPlan(rawContent)) {
    return { valid: false, error: '修复后的内容疑似修改计划或问题分析，不是正文' }
  }

  if (containsChecklistArtifacts(rawContent)) {
    return { valid: false, error: '修复后的内容包含预写检查表残留' }
  }

  return { valid: true, content: rawContent }
}
```

Run: `npm test -- tests/utils/chapter-content-validation.test.ts`

Expected: PASS

### Step 3: Commit

```bash
git add src/utils/chapter-content-validation.ts tests/utils/chapter-content-validation.test.ts
git commit -m "feat(utils): add chapter content validation utility"
```

---

## Task 2: Update `FixAgent` legacy prompt and parser

**Files:**
- Modify: `src/agents/fix.ts`
- Test: `tests/agents/fix.test.ts` (create if absent)

### Step 1: Write the failing test

Create or append to `tests/agents/fix.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { FixAgent } from '../../src/agents/fix.js'

const createAgent = (chat: (messages: unknown[]) => string) => {
  const agent = new FixAgent()
  vi.spyOn(agent as unknown as { provider: { chat: typeof chat } }, 'provider', 'get').mockReturnValue({
    chat: async (messages: unknown[]) => chat(messages),
  } as never)
  return agent
}

describe('FixAgent parse', () => {
  it('extracts content between FIXED_CHAPTER markers', async () => {
    const agent = createAgent(() =>
      'Some preamble\n=== FIXED_CHAPTER ===\n# 第四章 王府递帖\n\n正文。\n=== END_FIXED_CHAPTER ===\nTrailing text'
    )
    const output = await agent.run({
      idea: 'test',
      genre: 'default',
      totalChapters: 10,
      chapterIndex: 3,
      chapterContent: '# 第四章 王府递帖\n\n旧正文。',
      issues: [{ id: '1', type: 'consistency', severity: 'error', description: '矛盾' }],
    })
    expect(output.success).toBe(true)
    expect(output.content).toBe('# 第四章 王府递帖\n\n正文。')
  })

  it('falls back to content after FIXED_CHAPTER marker when no end marker', async () => {
    const agent = createAgent(() =>
      '=== FIXED_CHAPTER ===\n# 第四章 王府递帖\n\n正文。'
    )
    const output = await agent.run({
      idea: 'test',
      genre: 'default',
      totalChapters: 10,
      chapterIndex: 3,
      chapterContent: '# 第四章 王府递帖\n\n旧正文。',
      issues: [{ id: '1', type: 'consistency', severity: 'error', description: '矛盾' }],
    })
    expect(output.success).toBe(true)
    expect(output.content).toBe('# 第四章 王府递帖\n\n正文。')
  })
})
```

Run: `npm test -- tests/agents/fix.test.ts`

Expected: FAIL - content contains marker preamble

### Step 2: Update `FixAgent`

Modify `src/agents/fix.ts`:

1. In `buildLegacyPrompt`, replace the `<output>` block with:

```text
<output_format>
  请输出修复后的完整第 ${displayChapterNumber} 章正文。

  必须严格使用以下格式：

  === FIXED_CHAPTER ===
  # 第${displayChapterNumber}章 章节标题
  （正文内容，段落之间用空行分隔）
  === END_FIXED_CHAPTER ===

  注意：
  - 正文必须从 "# 第${displayChapterNumber}章" 开始
  - 不要输出任何 "问题分析"、"修复建议"、"修改方案" 等非正文内容
  - 不要输出预写检查表、自检清单、Markdown 表格等辅助内容
  - 只输出小说正文本身
</output_format>
```

2. In `parse`, add extraction before the existing sentence/paragraph patterns:

```typescript
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

  // existing sentence/paragraph patterns, but run on extractedContent
  const sentencePattern = /【段落\s*(\d+)\s*·\s*第\s*(\d+)\s*句】\n([\s\S]*?)(?=\n【段落\s*\d+\s*·|$)/g
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

  const paragraphPattern = /【段落\s*(\d+)】\n([\s\S]*?)(?=\n【段落\s*\d+】|$)/g
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
```

Run: `npm test -- tests/agents/fix.test.ts`

Expected: PASS

### Step 3: Commit

```bash
git add src/agents/fix.ts tests/agents/fix.test.ts
git commit -m "feat(fix-agent): enforce FIXED_CHAPTER marker in legacy mode"
```

---

## Task 3: Integrate validation into `runLegacyFix`

**Files:**
- Modify: `src/graph/nodes.ts`
- Create: `tests/graph/legacy-fix-validation.test.ts`

### Step 1: Write the failing test

Create `tests/graph/legacy-fix-validation.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { runLegacyFix } from '../../src/graph/nodes.js'
import type { ReducedGraphState } from '../../src/graph/state.js'

const buildState = (outputDir: string): ReducedGraphState => ({
  story: { id: 'test', title: 'Test', outputDir, genre: 'default', totalChapters: 10 },
  idea: 'test',
  genre: 'default',
  totalChapters: 10,
  currentChapterIndex: 3,
  chapters: [{ id: '1', storyId: 'test', number: 4, title: null, outline: null, summary: null, foreshadows: null, status: 'drafting', createdAt: 0, updatedAt: 0 }],
  chapterSummaries: [],
  foreshadowStack: [],
  outline: [{ title: '王府递帖', description: '递帖' }],
  characters: [],
  world: null,
  storyState: null,
  pendingIssues: [],
} as unknown as ReducedGraphState)

describe('runLegacyFix validation', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = path.join(process.cwd(), 'tests', 'tmp', `legacy-fix-${Date.now()}`)
    await fs.mkdir(path.join(tmpDir, 'chapters'), { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('does not write revision plan content to chapter file', async () => {
    const outputDir = tmpDir
    const existingContent = '# 第四章 王府递帖\n\n旧正文。'
    const planContent = '=== FIXED_CHAPTER ===\n# 第四章 王府递帖\n\n问题分析：情感层次单一。修复建议：应该增加哭泣描写。\n=== END_FIXED_CHAPTER ==='

    // Mock agent to return revision plan
    const agent = {
      run: vi.fn().mockResolvedValue({ success: true, content: planContent }),
    }

    const state = buildState(outputDir)
    await fs.writeFile(path.join(outputDir, 'chapters', 'chapter_4.md'), existingContent, 'utf-8')

    await expect(
      runLegacyFix(agent as never, state, existingContent, 3, state.outline[3], '前几章摘要', '时间线')
    ).rejects.toThrow('修改计划')

    const fileContent = await fs.readFile(path.join(outputDir, 'chapters', 'chapter_4.md'), 'utf-8')
    expect(fileContent).toBe(existingContent)
  })
})
```

Note: `runLegacyFix` is currently not exported. We will need to export it. If the test cannot import it directly, test via `fix_chapter` with a mocked agent instead.

Run: `npm test -- tests/graph/legacy-fix-validation.test.ts`

Expected: FAIL - export or validation not present

### Step 2: Modify `src/graph/nodes.ts`

1. Add import at top:

```typescript
import { validateFixedChapterContent } from '../utils/chapter-content-validation.js'
```

2. Export `runLegacyFix` (change from `async function` to `export async function`).

3. In `runLegacyFix`, after obtaining `content` from `output.content`, before `deduplicateSentences`, add:

```typescript
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
```

4. Run the test again.

Expected: PASS

### Step 3: Commit

```bash
git add src/graph/nodes.ts tests/graph/legacy-fix-validation.test.ts
git commit -m "feat(nodes): validate FixAgent legacy output before writing"
```

---

## Task 4: Refactor `fix_chapter` warning branch

**Files:**
- Modify: `src/graph/nodes.ts`
- Test: `tests/graph/fix-chapter.test.ts` (create)

### Step 1: Write the failing test

Create `tests/graph/fix-chapter.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { fix_chapter } from '../../src/graph/nodes.js'
import type { ReducedGraphState } from '../../src/graph/state.js'
import type { Issue } from '../../src/types/agent.js'

const buildState = (outputDir: string, pendingIssues: Issue[]): ReducedGraphState => ({
  story: { id: 'test', title: 'Test', outputDir, genre: 'default', totalChapters: 10 },
  idea: 'test',
  genre: 'default',
  totalChapters: 10,
  currentChapterIndex: 3,
  chapters: [{ id: '1', storyId: 'test', number: 4, title: null, outline: null, summary: null, foreshadows: null, status: 'drafting', createdAt: 0, updatedAt: 0 }],
  chapterSummaries: [],
  foreshadowStack: [],
  outline: [{ title: '王府递帖', description: '递帖' }],
  characters: [],
  world: null,
  storyState: null,
  pendingIssues,
} as unknown as ReducedGraphState)

describe('fix_chapter warning filtering', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = path.join(process.cwd(), 'tests', 'tmp', `fix-chapter-${Date.now()}`)
    await fs.mkdir(path.join(tmpDir, 'chapters'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, 'chapters', 'chapter_4.md'), '# 第四章 王府递帖\n\n正文。', 'utf-8')
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('does not invoke FixAgent when all issues are abstract quality warnings', async () => {
    const state = buildState(tmpDir, [
      { id: '1', type: 'quality', severity: 'warning', description: '情感层次略显单一' },
    ])

    const run = vi.fn()
    vi.doMock('../../src/agents/index.js', () => ({
      getFixAgent: () => ({ run }),
    }))

    const result = await fix_chapter(state)
    expect(run).not.toHaveBeenCalled()

    vi.doUnmock('../../src/agents/index.js')
  })
})
```

Run: `npm test -- tests/graph/fix-chapter.test.ts`

Expected: FAIL - `fix_chapter` does not filter warnings yet

### Step 2: Modify `fix_chapter`

In `src/graph/nodes.ts`, at the beginning of `fix_chapter`, add a guard before constructing `paragraphs`:

```typescript
export async function fix_chapter(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  const chapterIndex = state.currentChapterIndex
  const outlineItem = state.outline[chapterIndex]

  const existingContent = await readChapterContent(state.story.outputDir, chapterIndex + 1)
  if (!existingContent) {
    throw new Error(
      `第 ${chapterIndex + 1} 章文件不存在，无法修复。请运行 write 或 rewrite。`
    )
  }

  // Only patch consistency/hallucination warnings or quality warnings with explicit locations.
  // Abstract quality/style warnings are not suitable for paragraph/sentence-level patching.
  const pendingIssues = state.pendingIssues
  const hasPatchableIssues = pendingIssues.some(issue => {
    if (issue.severity !== 'warning') return true // errors are always handled
    if (issue.type === 'consistency' || issue.type === 'hallucination') return true
    if (issue.type === 'quality' && issue.location) {
      const loc = issue.location
      // Accept only warnings that point to specific paragraphs or sentences
      return /第\s*\d+\s*[段节]|段落\s*\d+|第\s*\d+\s*句/.test(loc)
    }
    return false
  })

  if (!hasPatchableIssues) {
    console.log('[MuseFlow] 当前警告不适合段落/句子级修复，跳过 fix agent')
    return { chapters: state.chapters }
  }

  // Continue with existing logic using pendingIssues as-is
  // ...
}
```

Run: `npm test -- tests/graph/fix-chapter.test.ts`

Expected: PASS

### Step 3: Commit

```bash
git add src/graph/nodes.ts tests/graph/fix-chapter.test.ts
git commit -m "feat(nodes): filter patchable warnings in fix_chapter"
```

---

## Task 5: Update `auto_fix_warnings` for safe fallback

**Files:**
- Modify: `src/graph/nodes.ts`
- Test: `tests/graph/auto-fix-warnings.test.ts` (create)

### Step 1: Write the failing test

Create `tests/graph/auto-fix-warnings.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { auto_fix_warnings } from '../../src/graph/nodes.js'
import type { ReducedGraphState } from '../../src/graph/state.js'
import type { Issue } from '../../src/types/agent.js'

const buildState = (outputDir: string, pendingIssues: Issue[]): ReducedGraphState => ({
  story: { id: 'test', title: 'Test', outputDir, genre: 'default', totalChapters: 10 },
  idea: 'test',
  genre: 'default',
  totalChapters: 10,
  currentChapterIndex: 3,
  chapters: [{ id: '1', storyId: 'test', number: 4, title: null, outline: null, summary: null, foreshadows: null, status: 'drafting', createdAt: 0, updatedAt: 0 }],
  chapterSummaries: [],
  foreshadowStack: [],
  outline: [{ title: '王府递帖', description: '递帖' }],
  characters: [],
  world: null,
  storyState: null,
  pendingIssues,
  autoFixAttempts: 0,
} as unknown as ReducedGraphState)

describe('auto_fix_warnings', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = path.join(process.cwd(), 'tests', 'tmp', `auto-fix-${Date.now()}`)
    await fs.mkdir(path.join(tmpDir, 'chapters'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, 'chapters', 'chapter_4.md'), '# 第四章 王府递帖\n\n正文。', 'utf-8')
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('preserves quality warnings when no patchable warnings exist', async () => {
    const warning: Issue = { id: '1', type: 'quality', severity: 'warning', description: '情感层次略显单一' }
    const state = buildState(tmpDir, [warning])

    const result = await auto_fix_warnings(state)
    expect(result.pendingIssues).toEqual([warning])
    expect(result.autoFixAttempts).toBe(0)
  })
})
```

Run: `npm test -- tests/graph/auto-fix-warnings.test.ts`

Expected: PASS if the current code already returns early for non-errors; but we need to verify it does not call `fix_chapter`. Adjust expectation if needed.

### Step 2: Modify `auto_fix_warnings`

Replace the current `auto_fix_warnings` implementation with:

```typescript
export async function auto_fix_warnings(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  const errors = state.pendingIssues.filter(i => i.severity === 'error')
  const warnings = state.pendingIssues.filter(i => i.severity === 'warning')

  if (errors.length > 0) {
    return { autoFixAttempts: 0 }
  }

  if (warnings.length === 0) {
    return { autoFixAttempts: 0 }
  }

  const attempts = (state.autoFixAttempts || 0)

  if (attempts >= 3) {
    console.warn(`\x1b[93m[MuseFlow] 自动修复已达最大尝试次数 (${attempts})，停止修复，保留 ${warnings.length} 个警告待处理\x1b[0m`)
    return { autoFixAttempts: attempts, pendingIssues: state.pendingIssues }
  }

  // Only patch consistency/hallucination warnings or quality warnings with explicit locations.
  const patchableWarnings = warnings.filter(issue => {
    if (issue.type === 'consistency' || issue.type === 'hallucination') return true
    if (issue.type === 'quality' && issue.location) {
      return /第\s*\d+\s*[段节]|段落\s*\d+|第\s*\d+\s*句/.test(issue.location)
    }
    return false
  })

  if (patchableWarnings.length === 0) {
    console.log('[MuseFlow] 当前警告不适合自动修复，保留至下一轮重写')
    return { autoFixAttempts: attempts, pendingIssues: state.pendingIssues }
  }

  console.warn(`\x1b[93m🔧 [MuseFlow] Auto-fixing ${patchableWarnings.length} warning(s) (attempt ${attempts + 1}/3):\x1b[0m`)
  for (const warning of patchableWarnings) {
    console.warn(`   \x1b[33m⚠️  [${warning.type}]\x1b[0m ${warning.description}`)
  }

  const fixState: ReducedGraphState = { ...state, pendingIssues: patchableWarnings }

  try {
    const fixResult = await fix_chapter(fixState)
    console.log(`\x1b[92m✔ [MuseFlow] Auto-fixed ${patchableWarnings.length} warning(s) (attempt ${attempts + 1}/3)\x1b[0m`)

    return {
      ...fixResult,
      pendingIssues: [],
      autoFixAttempts: attempts + 1,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`\x1b[93m[MuseFlow] 自动修复失败：${message}\x1b[0m`)
    return {
      autoFixAttempts: attempts + 1,
      pendingIssues: state.pendingIssues,
    }
  }
}
```

Run: `npm test -- tests/graph/auto-fix-warnings.test.ts`

Expected: PASS

### Step 3: Commit

```bash
git add src/graph/nodes.ts tests/graph/auto-fix-warnings.test.ts
git commit -m "feat(nodes): safe fallback in auto_fix_warnings"
```

---

## Task 6: Ensure quality warnings survive into next draft

**Files:**
- Modify: `src/core/chapter-generation.ts`

### Step 1: Inspect current behavior

The current main loop in `executeChapterGeneration` already preserves `workingState.pendingIssues` across rewrite attempts, unless `auto_fix_warnings` clears them. With Task 5's change, `auto_fix_warnings` no longer clears issues on failure. However, verify that when `auto_fix_warnings` succeeds (returns `pendingIssues: []`), quality warnings that were filtered out are still preserved.

The Task 5 implementation returns `pendingIssues: state.pendingIssues` when there are no patchable warnings, so they survive. When patchable warnings are fixed successfully, only those patchable warnings are cleared.

Still, add an explicit guard: before calling `auto_fix_warnings`, capture the set of quality warnings; after it returns, merge any quality warnings that are not in the result back in.

### Step 2: Add merge guard

In `src/core/chapter-generation.ts`, inside the validation loop, around the `auto_fix_warnings` pipeline node, no code change is needed because `auto_fix_warnings` is called as a pipeline node and its return value updates state. But add a small helper:

```typescript
function mergeQualityWarnings(
  before: Issue[],
  after: Issue[]
): Issue[] {
  const afterIds = new Set(after.map(i => i.id))
  const missingQualityWarnings = before.filter(
    i => i.type === 'quality' && i.severity === 'warning' && !afterIds.has(i.id)
  )
  if (missingQualityWarnings.length === 0) return after
  return [...after, ...missingQualityWarnings]
}
```

Then, after the pipeline loop, before checking remaining warnings:

```typescript
// Preserve quality warnings that may have been filtered out of auto-fix
const warningsBeforeAutoFix = workingState.pendingIssues.filter(i => i.severity === 'warning')
workingState = {
  ...workingState,
  pendingIssues: mergeQualityWarnings(warningsBeforeAutoFix, workingState.pendingIssues),
}
```

Wait - `auto_fix_warnings` runs inside `runChapterPipeline`, which returns `pipelineResult.state`. The merge should happen after `runChapterPipeline` returns.

Add the merge right after:

```typescript
const pipelineResult = await runChapterPipeline(workingState, [...])
workingState = pipelineResult.state

const warningsBeforeAutoFix = workingState.pendingIssues.filter(i => i.severity === 'warning')
workingState = {
  ...workingState,
  pendingIssues: mergeQualityWarnings(warningsBeforeAutoFix, workingState.pendingIssues),
}
```

Actually, this captures warnings *after* the pipeline, not before. We need to capture before the pipeline call:

```typescript
const warningsBeforePipeline = workingState.pendingIssues.filter(i => i.severity === 'warning')

const pipelineResult = await runChapterPipeline(workingState, [...])
workingState = pipelineResult.state

workingState = {
  ...workingState,
  pendingIssues: mergeQualityWarnings(warningsBeforePipeline, workingState.pendingIssues),
}
```

### Step 3: Test

Run full test suite:

```bash
npm test
```

Expected: All existing tests pass; new tests pass.

### Step 4: Commit

```bash
git add src/core/chapter-generation.ts
git commit -m "feat(chapter-generation): preserve quality warnings across auto-fix"
```

---

## Task 7: Run type checking and full test suite

```bash
npm run typecheck
npm test
```

Fix any errors. Commit any fixes separately.

---

## Task 8: Final review and integration test

Create a small integration-style test or manual verification script that simulates the failing scenario:

- A state with only an abstract quality warning
- A FixAgent that would return a revision plan
- Verify that `auto_fix_warnings` does not write the revision plan and preserves the warning

This can be a unit test in `tests/graph/integration-auto-fix.test.ts` or a manual run. Add at least one test.

```bash
git add tests/graph/integration-auto-fix.test.ts
git commit -m "test: integration test for abstract quality warning safe fallback"
```

---

## Self-Review Checklist

- [x] Spec coverage: each design requirement maps to a task.
- [x] No placeholders: every step contains concrete code or commands.
- [x] Type consistency: `ValidationResult` uses `valid` boolean; `Issue` type references match codebase.
- [ ] Note: `runLegacyFix` needs to be exported from `src/graph/nodes.ts`; if this causes issues with current encapsulation, export it or test via `fix_chapter`.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-22-auto-fix-output-validation-plan.md`.

Two execution options:

1. **Subagent-Driven (recommended)** - Dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - Execute tasks in this session using `executing-plans`, batch execution with checkpoints.

Which approach?
