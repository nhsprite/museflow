# JIT Outline Conflict Escalation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep disposable JIT outline conflicts inside bounded automatic recovery while reserving author decisions and adoptable proposals for validated, persistent conflicts.

**Architecture:** Add an explicit proposal-generation mode to canonical-state preparation, then replace the current same-candidate revision loop with a provenance-aware coordinator in `outline-expander.ts`. Persisted outlines are never silently rewritten; temporary JIT candidates may use a validated revision or be discarded and regenerated up to three times. Escalation uses exact structured conflict fingerprints only.

**Tech Stack:** TypeScript ESM, LangGraph reduced state, Vitest, existing `BlockingConflictError` and reconciliation services.

---

### Task 1: Add proposal-free conflict validation

**Files:**
- Modify: `src/graph/utils/reconciler/index.ts`
- Test: `tests/graph/utils/reconciler.test.ts`

- [ ] **Step 1: Write the failing reconciler test**

Add a test beside the existing proposal attachment test:

```ts
it('does not generate a nested proposal when proposalMode is omit', async () => {
  const state = makeState()
  const provider = createBlockingConflictProvider()
  vi.mocked(contextJudge.batchExtractEntityChanges).mockResolvedValue([])

  await expect(
    prepareStoryStateForChapter(state, 0, provider, { proposalMode: 'omit' })
  ).rejects.toMatchObject({ proposal: undefined })
  expect(outlineRevision.generateOutlineRevisionProposal).not.toHaveBeenCalled()
})
```

Use the same blocking provider response already used by the adjacent tests; extract `createBlockingConflictProvider` locally only if it removes duplicated test setup.

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
npm test -- tests/graph/utils/reconciler.test.ts
```

Expected: TypeScript/Vitest failure because `prepareStoryStateForChapter` does not accept the fourth argument and still generates a proposal.

- [ ] **Step 3: Implement the proposal mode**

Add the option and preserve the current default:

```ts
export interface PrepareStoryStateOptions {
  proposalMode?: 'generate' | 'omit'
}

export async function prepareStoryStateForChapter(
  state: ReducedGraphState,
  chapterIndex: number,
  provider: ModelProvider,
  options: PrepareStoryStateOptions = {}
): Promise<PreparedStoryState> {
```

Replace unconditional proposal generation with:

```ts
const proposal =
  options.proposalMode === 'omit'
    ? null
    : await generateOutlineRevisionProposal(
        state.outline,
        chapterIndex,
        undecidedBlockingConflicts,
        reconciledState,
        provider
      )
```

Continue throwing `BlockingConflictError` with `proposal ?? undefined`.

- [ ] **Step 4: Run the reconciler tests and verify GREEN**

Run:

```bash
npm test -- tests/graph/utils/reconciler.test.ts
```

Expected: all reconciler tests pass, including default proposal attachment and proposal omission.

- [ ] **Step 5: Commit**

```bash
git add src/graph/utils/reconciler/index.ts tests/graph/utils/reconciler.test.ts
git commit -m "fix: support proposal-free outline validation"
```

### Task 2: Replace same-candidate revision with provenance-aware recovery

**Files:**
- Modify: `src/core/outline-expander.ts`
- Rewrite focused tests: `tests/core/outline-expander-auto-revision.test.ts`

- [ ] **Step 1: Write failing tests for persisted outlines**

Replace the old tests that expect silent persisted-outline revision with these behaviors:

```ts
it('does not silently rewrite a persisted outline and exposes a validated proposal', async () => {
  const conflict = createConflict()
  const proposal = {
    revisedDescription: '修订后的描述。',
    explanation: '解释',
  }
  prepareStoryStateForChapterMock
    .mockRejectedValueOnce(new BlockingConflictError([conflict], 1, proposal))
    .mockResolvedValueOnce({ reconciledState: {}, stateConflicts: '', itemLocationConflicts: [] })

  await expect(expandOutlineForChapter(baseState, 1, createMockProvider())).rejects.toMatchObject({
    conflicts: [conflict],
    proposal,
  })
  expect(prepareStoryStateForChapterMock.mock.calls[1]?.[3]).toEqual({ proposalMode: 'omit' })
  expect(planChapterWithOverrideMock).not.toHaveBeenCalled()
})

it('does not expose a persisted-outline proposal that still conflicts', async () => {
  const conflict = createConflict()
  const proposal = { revisedDescription: '仍冲突。', explanation: '解释' }
  prepareStoryStateForChapterMock
    .mockRejectedValueOnce(new BlockingConflictError([conflict], 1, proposal))
    .mockRejectedValueOnce(new BlockingConflictError([conflict], 1))

  await expect(expandOutlineForChapter(baseState, 1, createMockProvider())).rejects.toMatchObject({
    proposal: undefined,
  })
})
```

- [ ] **Step 2: Write failing tests for disposable JIT candidates**

Create a helper that copies `baseState` with an empty target outline description. Add tests that prove:

```ts
it('discards a conflicting JIT candidate and succeeds with an independent candidate', async () => {
  chapterOutlineRunMock
    .mockResolvedValueOnce({ success: true, data: { title: '候选一', description: '冲突候选。' } })
    .mockResolvedValueOnce({ success: true, data: { title: '候选二', description: '有效候选。' } })
  prepareStoryStateForChapterMock
    .mockRejectedValueOnce(new BlockingConflictError([createConflict()], 1))
    .mockResolvedValueOnce({ reconciledState: {}, stateConflicts: '', itemLocationConflicts: [] })

  const result = await expandOutlineForChapter(createJitState(), 1, createMockProvider())

  expect(chapterOutlineRunMock).toHaveBeenCalledTimes(2)
  expect(result.outline?.[1]?.description).toBe('有效候选。')
})

it('uses a validated revision of a JIT candidate without regenerating', async () => {
  const proposal = { revisedDescription: '有效修订。', explanation: '解释' }
  prepareStoryStateForChapterMock
    .mockRejectedValueOnce(new BlockingConflictError([createConflict()], 1, proposal))
    .mockResolvedValueOnce({ reconciledState: {}, stateConflicts: '', itemLocationConflicts: [] })

  const result = await expandOutlineForChapter(createJitState(), 1, createMockProvider())

  expect(chapterOutlineRunMock).toHaveBeenCalledTimes(1)
  expect(result.outline?.[1]?.description).toBe('有效修订。')
})
```

Add two exhaustion tests: three identical structured conflict sets must reject with `BlockingConflictError`; three differing structured fingerprints must reject with a normal `Error` whose name is not `BlockingConflictError`.

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```bash
npm test -- tests/core/outline-expander-auto-revision.test.ts
```

Expected: persisted outlines are currently silently rewritten, JIT candidates are not independently regenerated, and unvalidated proposals remain attached.

- [ ] **Step 4: Implement structured conflict fingerprints**

Remove `MAX_AUTO_REVISION_ATTEMPTS`, `conflictsEqual`, and the direct proposal-generator import from `outline-expander.ts`. Add:

```ts
const MAX_JIT_CONFLICT_CANDIDATES = 3

function conflictFingerprint(conflicts: readonly Conflict[]): string {
  return JSON.stringify(
    conflicts
      .map(({ type, subject, attribute, oldValue, newValue }) => ({
        type,
        subject,
        attribute,
        oldValue,
        newValue,
      }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  )
}
```

This serializes typed conflict records; it does not inspect prose descriptions.

- [ ] **Step 5: Implement immutable proposal validation**

Add a helper that applies a proposal to a copied outline and validates it without nested proposal generation:

```ts
function stateWithOutlineProposal(
  state: ReducedGraphState,
  chapterIndex: number,
  proposal: OutlineRevisionProposal
): ReducedGraphState {
  const outline = [...state.outline]
  const current = outline[chapterIndex]
  outline[chapterIndex] = {
    ...current,
    number: current?.number ?? chapterIndex + 1,
    title: proposal.revisedTitle ?? current?.title ?? `第${chapterIndex + 1}章`,
    description: proposal.revisedDescription,
  }
  return { ...state, outline }
}
```

Validate that copied state with:

```ts
await prepareStoryStateForChapter(proposedState, chapterIndex, provider, {
  proposalMode: 'omit',
})
```

Return the proposed state only on success. On a blocking failure, discard it.

- [ ] **Step 6: Implement persisted and JIT coordinators**

For persisted outlines, validate once, validate the attached proposal when present, and always throw a new `BlockingConflictError` carrying either the validated proposal or `undefined`.

For JIT outlines, start every independent attempt from the original state whose target description is empty. Generate, validate, and either use a validated revision or record the candidate failure. After three failures:

```ts
const fingerprints = failures.map((error) => conflictFingerprint(error.conflicts))
const stable = fingerprints.every((fingerprint) => fingerprint === fingerprints[0])
if (stable) {
  const last = failures.at(-1)!
  throw new BlockingConflictError([...last.conflicts], chapterIndex)
}
throw new Error(
  `第 ${chapterIndex + 1} 章连续 ${MAX_JIT_CONFLICT_CANDIDATES} 个临时大纲候选均未通过权威事实校验，且冲突集合不稳定；请重新运行本章生成。`
)
```

Only carry `pendingIssues` from the candidate that succeeds.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run:

```bash
npm test -- tests/core/outline-expander-auto-revision.test.ts tests/core/outline-expander.test.ts
```

Expected: all outline-expander tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/core/outline-expander.ts tests/core/outline-expander-auto-revision.test.ts
git commit -m "fix: defer JIT outline conflicts before author escalation"
```

### Task 3: Verify CLI behavior and policy boundaries

**Files:**
- Test: `tests/cli/rewrite-feedback.test.ts` only if an assertion is needed to preserve the existing adopted-outline retry contract
- Test: `tests/smoke/no-prose-matching.test.ts` unchanged

- [ ] **Step 1: Run CLI and policy-focused tests**

Run:

```bash
npm test -- tests/cli/rewrite-feedback.test.ts tests/smoke/no-prose-matching.test.ts
```

Expected: the CLI still preserves an explicitly adopted outline, and the semantic-string guard passes.

- [ ] **Step 2: Add only a missing regression assertion if RED reveals a contract gap**

If the existing CLI test does not prove adopted revisions are preserved, add this exact assertion to its existing test:

```ts
expect(runOneChapterMock.mock.calls[1]?.[1]).toEqual(
  expect.objectContaining({ preserveTargetOutline: true })
)
```

Do not change CLI production code unless the focused test demonstrates an actual regression.

- [ ] **Step 3: Commit any test-only adjustment**

If Step 2 changed a test:

```bash
git add tests/cli/rewrite-feedback.test.ts
git commit -m "test: preserve adopted outline conflict resolution"
```

If no file changed, do not create an empty commit.

### Task 4: Full verification

**Files:**
- No production changes expected

- [ ] **Step 1: Run the full suite**

```bash
npm test
```

Expected: 108 test files pass with the new tests included.

- [ ] **Step 2: Run typecheck and build**

```bash
npm run typecheck
npm run build
```

Expected: both commands exit 0.

- [ ] **Step 3: Run repository hygiene checks**

```bash
git diff --check
git status --short
git log -4 --oneline --decorate
```

Expected: no whitespace errors, no uncommitted files, and the design plus implementation commits at branch head.

