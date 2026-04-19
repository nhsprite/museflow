# Timeline Snapshot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add timeline snapshot feature that tracks story state after each chapter completion, stored in meta.json timeline array and passed as context to subsequent chapters.

**Architecture:** Add `timeline: StateSnapshot[]` field to StoryMeta. Each chapter completion generates a snapshot (via AI) that tracks characters, locations, key items, plots, and mood. Snapshots are persisted to meta.json and injected into next chapter's context.

**Tech Stack:** TypeScript, MuseFlow storage layer, ChapterAgent

---

## File Map

**Create:**
- `src/types/timeline.ts` - StateSnapshot interface
- `src/storage/database/dao/timeline.ts` - timeline DAO functions

**Modify:**
- `src/storage/database/index.ts` - add timeline to StoryMeta interface
- `src/graph/nodes.ts` - add snapshot generation in finalize_chapter
- `src/agents/chapter.ts` - inject timeline context into chapter prompt
- `src/graph/state.ts` - add timelineSnapshot field to GraphState (optional, for graph-level tracking)

---

## Task 1: Create Timeline Type Definition

**Files:**
- Create: `src/types/timeline.ts`

```typescript
export interface StateSnapshot {
  id: string
  storyId: string
  chapterNumber: number | null  // null for story-level snapshots
  snapshotType: 'chapter_complete' | 'story_init' | 'checkpoint'

  // Story state at this point
  currentChapterIndex: number
  chapterTitle: string | null
  chapterSummary: string | null
  wordCount: number | null

  // AI-generated state summary (characters, locations, key items, plots, mood)
  stateSummary: string | null

  // Quality metrics at this point
  issuesResolved: number
  issuesPending: number

  // Metadata
  createdAt: number
  stateJson: string | null  // Full serialized state for recovery (optional, can be large)
}
```

---

## Task 2: Add Timeline to StoryMeta Interface

**Files:**
- Modify: `src/storage/database/index.ts:42-46`

Add `timeline: StateSnapshot[]` to StoryMeta interface:

```typescript
export interface StoryMeta {
  story: { ... }
  world: WorldContent | null
  characters: Character[]
  outline: ChapterOutline[]
  chapters: ChapterMeta[]
  timeline: StateSnapshot[]  // <-- ADD THIS
  contextSnapshot: ContextSnapshot | null
}
```

Also add import for StateSnapshot type at top of file.

---

## Task 3: Create Timeline DAO

**Files:**
- Create: `src/storage/database/dao/timeline.ts`

```typescript
import type { StateSnapshot } from '../../../types/timeline.js'
import { generateId } from '../../../utils/id.js'
import { readMetaJsonSync, writeMetaJsonSync } from '../index.js'
import type { StoryStatus } from '../../../types/story.js'

export function appendTimelineSnapshot(
  storyId: string,
  snapshot: Omit<StateSnapshot, 'id' | 'storyId' | 'createdAt'>
): StateSnapshot {
  const meta = readMetaJsonSync(storyId)
  if (!meta) throw new Error(`Story ${storyId} not found`)

  const fullSnapshot: StateSnapshot = {
    id: generateId('ts'),
    storyId,
    createdAt: Date.now(),
    ...snapshot,
  }

  if (!meta.timeline) meta.timeline = []
  meta.timeline.push(fullSnapshot)
  writeMetaJsonSync(storyId, meta)
  return fullSnapshot
}

export function getTimeline(storyId: string): StateSnapshot[] {
  const meta = readMetaJsonSync(storyId)
  return meta?.timeline ?? []
}

export function getLatestSnapshot(storyId: string): StateSnapshot | null {
  const timeline = getTimeline(storyId)
  return timeline[timeline.length - 1] ?? null
}
```

---

## Task 4: Generate Timeline Snapshot in finalize_chapter

**Files:**
- Modify: `src/graph/nodes.ts` - add snapshot generation to finalize_chapter

In `finalize_chapter`, after chapter processing completes:

```typescript
export async function finalize_chapter(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  const chapterIndex = state.currentChapterIndex
  const chapter = state.chapters[chapterIndex]

  // ... existing code for chapterSummaries ...

  // Generate timeline snapshot for this chapter
  const snapshot = appendTimelineSnapshot(state.story.id, {
    chapterNumber: chapterIndex + 1,
    snapshotType: 'chapter_complete',
    currentChapterIndex: chapterIndex,
    chapterTitle: state.outline[chapterIndex]?.title ?? null,
    chapterSummary: chapter?.summary ?? null,
    wordCount: null,  // TODO: calculate from chapter content
    stateSummary: null,  // TODO: AI generates this
    issuesResolved: state.pendingIssues.filter(i => i.severity !== 'error').length,
    issuesPending: state.pendingIssues.filter(i => i.severity === 'error').length,
    stateJson: null,
  })

  const nextIndex = state.currentChapterIndex + 1
  if (nextIndex < state.totalChapters) {
    console.log(`\n[MuseFlow] 第 ${nextIndex + 1}/${state.totalChapters} 章处理完成`)
  }

  return {
    currentChapterIndex: nextIndex,
    pendingIssues: [],
    rewriteRequested: false,
    rewriteApproved: false,
    chapterSummaries: state.chapterSummaries,
  }
}
```

---

## Task 5: Add StateSummary Generation via AI

**Files:**
- Create: `src/agents/summary.ts` - new SummaryAgent for generating chapter state summaries

```typescript
import { BaseAgent, type AgentState, type AgentOutput } from './base.js'

export class SummaryAgent extends BaseAgent {
  constructor() {
    super(undefined, 0.3)  // low temperature for extraction
  }

  protected buildPrompt(state: AgentState): Message[] {
    return [
      this.systemMessage('你是一位故事结构分析专家，擅长从章节内容中提取关键信息。'),
      this.userMessage(`请分析以下章节内容，生成状态快照：

章节标题：${state.chapterContent?.substring(0, 100) ?? '未知'}...
章节摘要：${state.chapterContent?.substring(0, 500) ?? ''}

请提取并返回以下信息（JSON格式）：
{
  "characters": ["角色名: 当前状态描述"],
  "locations": ["地点: 描述"],
  "keyItems": ["物品: 描述"],
  "activePlots": ["当前进行中的情节线"],
  "mood": "本章整体氛围/情绪"
}

只返回JSON，不要其他内容。`)
    ]
  }

  protected parse(content: string): AgentOutput {
    const trimmed = content.trim()
    const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
    if (codeBlockMatch) {
      try {
        return { success: true, data: JSON.parse(codeBlockMatch[1]!.trim()) }
      } catch { }
    }
    try {
      return { success: true, data: JSON.parse(trimmed) }
    } catch {
      return { success: false, error: 'JSON解析失败' }
    }
  }
}

export function processSummaryOutput(output: AgentOutput): string | null {
  if (!output.success || !output.data) return null
  const data = output.data as Record<string, unknown>
  return JSON.stringify({
    characters: data['characters'] ?? [],
    locations: data['locations'] ?? [],
    keyItems: data['keyItems'] ?? [],
    activePlots: data['activePlots'] ?? [],
    mood: data['mood'] ?? '',
  })
}
```

**Note:** This is a simplified version. For production, you might want more robust parsing.

---

## Task 6: Inject Timeline Context into ChapterAgent

**Files:**
- Modify: `src/agents/chapter.ts` - add timeline section to buildPrompt

In `buildPrompt`, add timeline context:

```typescript
protected buildPrompt(state: AgentState): Message[] {
  // ... existing code ...

  const timelineSection = state.timelineSnapshot
    ? `上一章结束时的状态：
${state.timelineSnapshot}

请在继续写作时保持与上述状态的一致性。`
    : ''

  const context = `
${state.world ? `世界观设定：\n${state.world}` : ''}

人物设定：
${state.characters || '（尚未创建）'}

本章大纲：
${chapterInfo.title}
${chapterInfo.description}

${timelineSection}

${previousSummary}

${chapterSupplement}

写作要求：
...`

  return [
    this.systemMessage('你是一位擅长长篇小说写作的作家，...'),
    this.userMessage(context),
  ]
}
```

---

## Task 7: Connect Timeline in draft_chapter Node

**Files:**
- Modify: `src/graph/nodes.ts` - pass timeline snapshot to ChapterAgent

In `draft_chapter`:

```typescript
const latestSnapshot = getLatestSnapshot(state.story.id)
const timelineSnapshot = latestSnapshot?.stateSummary ?? null

const agentState: AgentState = {
  // ... existing fields ...
  chapterSummaries: state.chapterSummaries,
  timelineSnapshot,  // <-- ADD THIS
}
```

---

## Task 8: Update GraphState Interface

**Files:**
- Modify: `src/graph/state.ts` - add timelineSnapshot to GraphState (optional)

If you want graph-level tracking of the latest timeline:

```typescript
export const GraphState = Annotation.Root({
  // ... existing fields ...
  lastTimelineSnapshot: Annotation<string | null>,
})
```

---

## Verification

After implementation:
1. Run `npm run typecheck` - should pass
2. Run `npm test` - should pass
3. Manual test: create a new story, write a chapter, check `books/{story_id}/meta.json` for `timeline` array with one entry

---

## Execution Options

**Plan complete and saved.** Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
