# MuseFlow Chapter Content Storage and Validation Design

> Date: 2026-04-17
> Status: Proposed
> Scope: Chapter content filesystem storage + validate_chapter node

## 1. Problem

`ChapterAgent.processOutput()` creates a `ChapterMeta` skeleton but never stores the actual chapter content. The draft text lives only in LLM output until it evaporates. Additionally, there is no word-count gate between `draft_chapter` and the review pipeline, meaning short or bloated chapters waste tokens on downstream agents.

## 2. Design Goals

- Store each chapter's full text content in the filesystem, matching the dual-storage architecture from the design doc.
- Add a `validate_chapter` node as the first step after `draft_chapter` to enforce word-count bounds.
- Word-count thresholds are configurable per genre via `GenreSkill`.
- Failure during validation feeds into the existing `pendingIssues` / rewrite flow without requiring new graph infrastructure.

## 3. Chapter Content Storage

### 3.1 Path Convention

```
books/{story_id}/chapter_{n}.md
```

Where `n` is 0-indexed (`chapter_0.md`, `chapter_1.md`, … `chapter_{N-1}.md`).

### 3.2 Storage Operations

Expose two functions in `src/storage/filesystem/writer.ts`:

```typescript
// Write chapter content to filesystem
writeChapterContent(storyId: string, chapterIndex: number, content: string): Promise<void>

// Read chapter content from filesystem
readChapterContent(storyId: string, chapterIndex: number): Promise<string>
```

`writeChapterContent` creates the story directory and all chapter files if they do not exist. Files are overwritten safely (idempotent write).

### 3.3 Schema Extension

No schema changes. The `chapter` table already stores `id`, `story_id`, `number`, `title`, `outline`, `summary`, `foreshadows`, `status`, `created_at`, `updated_at`. The filesystem is the content store.

### 3.4 Node Responsibility: `draft_chapter`

After LLM generates content, `draft_chapter` writes it to the filesystem before returning:

```typescript
const content = output.content ?? ''
await writeChapterContent(state.story.id, chapterIndex, content)
```

`ChapterMeta` remains unchanged; content is not stored in SQLite.

## 4. Word-Count Thresholds in GenreSkill

### 4.1 Type Extension

```typescript
// src/types/genre.ts
interface GenreSkill {
  // ... existing fields ...
  chapterWordCountMin?: number  // default 1500
  chapterWordCountMax?: number  // default 8000
}
```

### 4.2 Defaults

If a genre does not specify thresholds:

- `chapterWordCountMin`: `1500`
- `chapterWordCountMax`: `8000`

## 5. validate_chapter Node

### 5.1 Position in Graph

```
draft_chapter → validate_chapter → quality_pass → detect_foreshadowing → ...
```

`validate_chapter` runs **after** the content is written and **before** any review or foreshadowing detection.

### 5.2 Node Logic

```typescript
async function validate_chapter(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  const chapterIndex = state.currentChapterIndex
  const content = await readChapterContent(state.story.id, chapterIndex)
  const wordCount = countChineseWords(content)  // counts Chinese chars + English words

  const genre = getGenreSkill(state.genre)
  const min = genre?.chapterWordCountMin ?? 1500
  const max = genre?.chapterWordCountMax ?? 8000

  const issues: Issue[] = []
  if (wordCount < min) {
    issues.push({
      type: 'word_count',
      severity: 'error',
      description: `第 ${chapterIndex + 1} 章字数 ${wordCount} 低于最低要求 ${min} 字`,
    })
  } else if (wordCount > max) {
    issues.push({
      type: 'word_count',
      severity: 'warning',  // warning, not error — excess is less critical
      description: `第 ${chapterIndex + 1} 章字数 ${wordCount} 超过建议上限 ${max} 字`,
    })
  }

  return { pendingIssues: [...state.pendingIssues, ...issues] }
}
```

### 5.3 Word-Count Algorithm

```typescript
function countChineseWords(text: string): number {
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) ?? []).length
  const englishWords = (text.match(/[a-zA-Z]+/g) ?? []).length
  return chineseChars + englishWords
}
```

Chinese characters count as 1 word each; English alphabetic tokens count as 1 word each. This approximation is sufficient for gate-keeping without needing a full segmentation library.

### 5.4 Outcome Routing

`should_start_chapters` already checks `state.pendingIssues.length > 0`. If `validate_chapter` added an **error**-severity issue, the graph routes to `request_rewrite` and interrupts as usual.

Warning-level issues do not block flow but are surfaced to the user via `continue` output.

## 6. Graph Update

In `src/graph/novel.graph.ts`:

```typescript
import { validate_chapter } from './nodes.js'

// in buildNovelGraph():
builder.addNode({ validate_chapter })

// edge from draft_chapter now goes to validate_chapter
b1.addEdge('draft_chapter', 'validate_chapter')
b1.addEdge('validate_chapter', 'quality_pass')
```

The conditional edge from `detect_consistency` continues to use `should_start_chapters` unchanged.

## 7. Error Handling

| Situation | Behavior |
|-----------|----------|
| File not found when validating | Treat word count as 0, add error issue → rewrite |
| Write fails during draft_chapter | Propagate exception; story status set to `'error'` |
| Thresholds not set in genre | Use defaults (1500 / 8000) |

## 8. Testing Expectations

- **Unit**: `countChineseWords` edge cases (pure Chinese, pure English, mixed, empty)
- **Unit**: `validate_chapter` with content below min, within range, above max
- **Integration**: `draft_chapter` → `validate_chapter` flow writes file then validates
- **Integration**: Validation error routes graph to `request_rewrite`

## 9. Interaction with Ending Mode

Ending mode (from the separate ending-mode design) is orthogonal to this node. `validate_chapter` runs regardless of phase. Ending-mode prompt adjustments affect what the LLM writes; this node only checks what was already written.

## 10. Summary

| Change | Where |
|--------|-------|
| `writeChapterContent` / `readChapterContent` | `src/storage/filesystem/writer.ts` |
| `draft_chapter` calls `writeChapterContent` after generation | `src/graph/nodes.ts` |
| `chapterWordCountMin` / `chapterWordCountMax` added to `GenreSkill` | `src/types/genre.ts` |
| `validate_chapter` node with `countChineseWords` | `src/graph/nodes.ts` |
| `validate_chapter` wired between `draft_chapter` and `quality_pass` | `src/graph/novel.graph.ts` |
| Tests for word count, validation, file read/write | `tests/storage/filesystem/writer.test.ts`, `tests/graph/nodes.test.ts` |
