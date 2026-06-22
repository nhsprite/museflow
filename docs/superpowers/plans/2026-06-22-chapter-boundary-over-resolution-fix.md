# Fix Chapter Boundary Over-Resolution in Rewrite Loop

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent paragraph-level fixes from resolving the next chapter's core events, which causes `outline_violation` failures after consistency repairs.

**Architecture:** Inject the existing `<next_chapter_boundary>` hint into `FixAgent` prompts, tighten `OutlineComplianceAgent` criteria for "probe vs resolution", and fix the rewrite escalation detector so it is not fooled by per-type issue deduplication.

**Tech Stack:** TypeScript, Vitest, MuseFlow agent pipeline.

---

## Background

During `museflow rewrite story_mqoope2735602be08dfa` for chapter 4:

1. Consistency errors (cross-chapter timeline mismatches) triggered paragraph-level fixes.
2. `FixAgent` repaired the consistency issues by expanding the chapter, including:
   - The prince replying with a concrete meeting time (`初六午后花厅赐见`).
   - The protagonist predicting the prince's exact demands (`军需、粮台、西北饷银调度`).
3. These details belong to chapter 5 (`初会亲王`), so `OutlineComplianceAgent` flagged `outline_violation`.
4. The retry loop hit `maxRewriteAttempts` and gave up.

Root causes:
- `FixAgent` never receives the `<next_chapter_boundary>` hint that `ChapterAgent` gets.
- `OutlineComplianceAgent` prompt does not explicitly define "probe / deliver petition" vs "receive reply / negotiate terms".
- The escalation detector in `chapter-generation.ts` compares error counts *after* per-type deduplication (max 3 per type), hiding error growth and preventing `forceStructuralRewrite` from triggering.

---

## Task 1: Add `nextChapterBoundary` to `AgentState` and FixAgent calls

**Files:**
- Modify: `src/agents/base.ts:111`
- Modify: `src/graph/nodes.ts:647-661`, `764-778`, `838-851`

- [ ] **Step 1: Add optional field to `AgentState`**

```typescript
export interface AgentState {
  // ... existing fields ...
  nextChapterBoundary?: string
}
```

- [ ] **Step 2: Compute boundary hint in `fix_chapter` helper calls**

In `src/graph/nodes.ts`, import `buildNextChapterBoundaryHint` from `../utils/outline-boundary.js` (already available via `formatChapterOutlineForAgent`).

Pass the boundary hint to all three FixAgent calls (`runSentenceFix`, `runParagraphFix`, `runLegacyFix`):

```typescript
const nextBoundaryHint = buildNextChapterBoundaryHint(state.outline, chapterIndex)

const agentState: AgentState = {
  // ... existing fields ...
  ...(nextBoundaryHint ? { nextChapterBoundary: nextBoundaryHint } : {}),
}
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: no new errors.

---

## Task 2: Render boundary hint in FixAgent prompts

**Files:**
- Modify: `src/agents/fix.ts:26-96`, `98-170`, `172-240`

- [ ] **Step 1: Build a reusable boundary section**

Add a private helper near the top of `FixAgent`:

```typescript
private buildBoundarySection(state: Required<AgentState>): string {
  if (!state.nextChapterBoundary) return ''
  return `<next_chapter_boundary>
${state.nextChapterBoundary}
</next_chapter_boundary>`
}
```

- [ ] **Step 2: Insert into `buildSentencePrompt`**

After `<instruction>` and before `</constraints>`, insert:

```typescript
const boundarySection = this.buildBoundarySection(state)
// ...
${boundarySection}

<constraints>
  <constraint priority="critical">本章只能修复上述问题，不得借机推进到后续章节的核心事件。如果修复会越界，请宁可保留原文。</constraint>
```

- [ ] **Step 3: Insert into `buildParagraphPrompt`**

Same placement: after `<instruction>`, before `</constraints>`, with the same critical constraint.

- [ ] **Step 4: Insert into `buildLegacyPrompt`**

After `</constraints>` or inside it, add the boundary section and the critical constraint.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no new errors.

---

## Task 3: Strengthen `OutlineComplianceAgent` criteria

**Files:**
- Modify: `src/agents/outline-compliance.ts:35-70`

- [ ] **Step 1: Update system prompt to emphasize boundary**

Append to the system message:

```
特别注意：本章只能包含当前大纲要求的事件。你必须对照下一章大纲，判断本章是否把下一章才应出现的核心结果（如对方的明确回应、条件交换、真相揭示、事件收束等）提前完成。如果本章提前落地了下一章的核心结果，必须判为 outline_violation。
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: no new errors.

---

## Task 4: Fix rewrite escalation detector

**Files:**
- Modify: `src/core/chapter-generation.ts:112-114`, `282-301`

- [ ] **Step 1: Track pre-dedup error count**

Add a new variable near the top of the `while` loop:

```typescript
let previousRawErrorCount = 0
```

- [ ] **Step 2: Compare raw counts instead of deduped counts**

Before deduplication, compute:

```typescript
const currentRawErrorCount = workingState.pendingIssues.filter(i => i.severity === 'error').length
```

Replace the convergence check:

```typescript
if (rewriteAttempts > 1) {
  if (currentRawErrorCount > previousRawErrorCount) {
    console.log(`[MuseFlow] 检测到问题数量上升（${previousRawErrorCount} -> ${currentRawErrorCount}），修复未收敛，下次尝试将强制完整重写...`)
    forceStructuralRewrite = true
  } else if (similarity >= 0.5 && errorCountAfterDedup > 0) {
    console.log(`[MuseFlow] 检测到问题高度重复（相似度 ${Math.round(similarity * 100)}%），修复未收敛，将保留全部问题反馈并强制完整重写...`)
    forceStructuralRewrite = true
    workingState = { ...workingState, pendingIssues: workingState.pendingIssues }
  } else if (onlyInterpretiveErrors && rewriteAttempts >= maxRewriteAttempts - 1) {
    // ... existing logic ...
  }
}
previousErrorCount = errorCountAfterDedup
previousRawErrorCount = currentRawErrorCount
previousErrorDescriptions = currentErrorDescriptions
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: no new errors.

---

## Task 5: Update / add tests

**Files:**
- Modify: `tests/agents/outline-compliance.test.ts` (if exists) or create
- Modify: `tests/agents/fix.test.ts` (if exists) or create
- Modify: `tests/core/chapter-generation.test.ts` (if exists) or create

- [ ] **Step 1: Check existing test files**

Run:
```bash
ls tests/agents/ tests/core/
```

- [ ] **Step 2: Add test for `OutlineComplianceAgent` boundary detection**

If no test file exists, create `tests/agents/outline-compliance.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { OutlineComplianceAgent } from '../../src/agents/outline-compliance.js'

describe('OutlineComplianceAgent', () => {
  it('flags over-resolution of next chapter event', () => {
    const agent = new OutlineComplianceAgent()
    const output = {
      success: true,
      data: {
        is_compliant: false,
        deviations: [
          {
            type: 'extra_event',
            severity: 'error',
            description: '本章已让亲王明确回帖约定会面时间，替代了下一章“初会亲王”的核心事件',
          },
        ],
      },
    }
    const { issues, isCompliant } = agent.processOutput(output)
    expect(isCompliant).toBe(false)
    expect(issues.some(i => i.type === 'outline_deviation' && i.severity === 'error')).toBe(true)
  })
})
```

- [ ] **Step 3: Add test for `isStructuralIssue` escalation**

In `tests/core/chapter-generation.test.ts` (or create):

```typescript
import { describe, it, expect } from 'vitest'
import { isStructuralIssue } from '../../src/core/chapter-generation.js'
import type { Issue } from '../../src/types/agent.js'

describe('isStructuralIssue', () => {
  it('treats outline_violation as structural', () => {
    const issue: Issue = {
      id: '1',
      type: 'outline_violation',
      severity: 'error',
      description: '缺少大纲情节点',
    }
    expect(isStructuralIssue(issue)).toBe(true)
  })
})
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all tests pass (or only pre-existing failures).

---

## Task 6: Final verification

- [ ] **Step 1: Run full typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: no new lint errors.

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/agents/base.ts src/agents/fix.ts src/agents/outline-compliance.ts src/core/chapter-generation.ts src/graph/nodes.ts tests/
git commit -m "fix: prevent paragraph fixes from over-resolving next chapter events"
```

---

## Self-Review

1. **Spec coverage:** The plan addresses boundary hints (Task 1-2), compliance criteria (Task 3), retry escalation (Task 4), and verification (Task 5-6).
2. **Placeholder scan:** No TBD/TODO placeholders; all code blocks are concrete.
3. **Type consistency:** `nextChapterBoundary?: string` added to `AgentState`; all call sites pass it via conditional spread.
