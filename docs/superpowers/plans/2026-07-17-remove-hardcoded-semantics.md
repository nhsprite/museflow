# Remove Hard-Coded Story Semantics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace MuseFlow's prose/name heuristics and duplicated policy constants with required
structured identity fields and one GenreSkill-derived planning configuration.

**Architecture:** Issue, character, item, and repair identity flow through explicit typed fields.
`ChapterPlanningConfig` owns every writing/routing limit covered by the design, and prompt,
validation, routing, finalization, and reporting consumers receive the merged config rather than
declaring local constants. This is a breaking schema change with no old-checkpoint compatibility.

**Tech Stack:** Node.js 20+, TypeScript strict ESM, LangGraph, Vitest, zod, Prettier, ESLint.

**Design:** `docs/superpowers/specs/2026-07-17-remove-hardcoded-semantics-design.md`

---

## File Structure

- `src/types/agent.ts`: required stable issue identity.
- `src/utils/agent-output.ts`: normalize model issues with explicit rule IDs.
- `src/utils/context-judge.ts`: structured-only issue fingerprints.
- `src/types/character.ts`: explicit aliases and protagonist marker.
- `src/agents/character.ts`, `src/agents/prompts/character-prompt.ts`: breaking character output
  contract.
- `src/utils/character-whitelist.ts`: exact structured name/alias-to-EntityId registry.
- `src/utils/items.ts`: exact-key record merging only.
- `src/utils/canonical-facts.ts`, `src/graph/utils/reconciler/*`: exact EntityId reconciliation.
- `src/types/genre.ts`, `src/utils/chapter-planning.ts`: central policy schema and defaults.
- `src/agents/prompts/*`, `src/graph/nodes/*`, `src/core/chapter-generation/routing/*`,
  `src/graph/services/finalization/*`: policy consumers.
- `tests/smoke/no-prose-matching.test.ts`: regression guard for removed heuristics.

---

### Task 1: Make issue fingerprints independent of prose

**Files:**
- Modify: `src/types/agent.ts`
- Modify: `src/utils/agent-output.ts`
- Modify: `src/utils/context-judge.ts`
- Modify: `src/agents/consistency.ts`
- Test: `tests/utils/context-judge.test.ts`
- Test: `tests/utils/issue-deduplication.test.ts`
- Test: `tests/agents/consistency.test.ts`
- Test: `tests/graph/nodes/validation.test.ts`

- [ ] **Step 1: Write failing structured-fingerprint tests**

Replace the tests that expect different descriptions to produce different fingerprints with:

```ts
it('ignores all prose fields when generating a fingerprint', () => {
  const base: Issue = {
    id: 'round-1',
    ruleId: 'consistency.character-location',
    type: 'consistency',
    severity: 'error',
    description: 'first wording',
    suggestion: 'first suggestion',
    location: 'first display location',
    dimension: 'space',
    source: 'consistency',
    subject: 'char-1',
    conflictAttribute: 'location',
    locationRef: { paragraphIndex: 2, sentenceIndex: 1 },
  }
  const rewritten: Issue = {
    ...base,
    id: 'round-2',
    description: 'completely different wording',
    suggestion: 'different suggestion',
    location: 'different display location',
  }

  expect(generateIssueFingerprint(base)).toBe(generateIssueFingerprint(rewritten))
})

it('distinguishes structured rule identity and evidence', () => {
  const base = makeIssue({
    ruleId: 'consistency.character-location',
    subject: 'char-1',
    locationRef: { paragraphIndex: 2 },
  })
  expect(generateIssueFingerprint({ ...base, ruleId: 'consistency.character-status' })).not.toBe(
    generateIssueFingerprint(base)
  )
  expect(generateIssueFingerprint({ ...base, subject: 'char-2' })).not.toBe(
    generateIssueFingerprint(base)
  )
  expect(
    generateIssueFingerprint({ ...base, locationRef: { paragraphIndex: 3 } })
  ).not.toBe(generateIssueFingerprint(base))
})
```

Update normalize-issue tests to pass a rule-ID resolver and assert the resulting issue contains the
resolver's value:

```ts
const issues = await normalizeIssues(rawIssues, 'consistency', undefined, {
  ruleId: (raw, mappedType) => `${mappedType}.${raw.aspect ?? 'general'}`,
})
expect(issues[0]?.ruleId).toBe('consistency.space')
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
npx vitest run tests/utils/context-judge.test.ts tests/utils/issue-deduplication.test.ts tests/agents/consistency.test.ts tests/graph/nodes/validation.test.ts
```

Expected: TypeScript/Vitest failures because `Issue.ruleId` and `NormalizeIssuesOptions.ruleId` do
not exist, and the current fingerprint changes when description changes.

- [ ] **Step 3: Add the required issue identity contract**

Add to `Issue`:

```ts
export interface Issue {
  id: string
  ruleId: string
  // existing fields remain
}
```

Add to normalize options:

```ts
export interface NormalizeIssuesOptions {
  ruleId: (issue: RawIssue, mappedType: IssueType) => string
  filter?: (issue: RawIssue) => boolean
  mapType?: (issue: RawIssue) => IssueType
  defaultSeverity?: IssueSeverity
}
```

When constructing a normalized issue, call `options.ruleId(issue, mappedType)`. In
`ConsistencyAgent.processOutput`, supply:

```ts
ruleId: (issue, mappedType) =>
  `consistency.${mappedType}.${issue.aspect ?? 'general'}.${issue.type ?? 'unspecified'}`,
```

The fields used in the string are structured agent fields defined by the consistency output
contract; do not use description, suggestion, or display location.

- [ ] **Step 4: Replace the fingerprint implementation**

Delete `hashIssueDescription`. Implement:

```ts
export function generateIssueFingerprint(issue: Issue): string {
  const paragraphIndex = issue.locationRef?.paragraphIndex ?? -1
  const sentenceIndex = issue.locationRef?.sentenceIndex ?? -1
  return [
    issue.ruleId,
    issue.type,
    issue.dimension ?? 'none',
    issue.source ?? 'none',
    issue.subject ?? 'none',
    issue.conflictAttribute ?? 'none',
    `p${paragraphIndex}`,
    `s${sentenceIndex}`,
  ].join(':')
}
```

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run the Step 2 command.

Expected: all focused tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/types/agent.ts src/utils/agent-output.ts src/utils/context-judge.ts \
  src/agents/consistency.ts tests/utils/context-judge.test.ts \
  tests/utils/issue-deduplication.test.ts tests/agents/consistency.test.ts \
  tests/graph/nodes/validation.test.ts
git commit -m "[Core] Add structured issue rule identity"
```

---

### Task 2: Give every runtime issue producer a stable rule ID

**Files:**
- Modify: `src/agents/fix.ts`
- Modify: `src/core/chapter-commit.ts`
- Modify: `src/core/outline-expander.ts`
- Modify: `src/core/runner.ts`
- Modify: `src/core/chapter-generation/routing/structured-issues.ts`
- Modify: `src/graph/nodes/planning.ts`
- Modify: `src/graph/nodes/story-creation.ts`
- Modify: `src/graph/nodes/validation.ts`
- Modify: `src/graph/services/finalization/act-progress.ts`
- Modify: `src/graph/services/finalization/chapter.ts`
- Modify: `src/graph/services/fix/execution.ts`
- Modify: `tests/agents/chapter-planner.test.ts`
- Modify: `tests/agents/chapter.test.ts`
- Modify: `tests/agents/consistency.test.ts`
- Modify: `tests/agents/fix.test.ts`
- Modify: `tests/cli/adjust-act.test.ts`
- Modify: `tests/cli/fix-rewrite-state.test.ts`
- Modify: `tests/cli/rewrite-feedback.test.ts`
- Modify: `tests/cli/set-foreshadow-policy.test.ts`
- Modify: `tests/cli/waive-foreshadow.test.ts`
- Modify: `tests/cli/write.test.ts`
- Modify: `tests/core/chapter-commit.test.ts`
- Modify: `tests/core/chapter-generation-structural.test.ts`
- Modify: `tests/core/chapter-generation/routing/fingerprint.test.ts`
- Modify: `tests/core/chapter-generation/routing/state-repair-routing.test.ts`
- Modify: `tests/core/chapter-generation/routing/structured-issues.test.ts`
- Modify: `tests/core/chapter-generation/routing/structured-validation-routing.test.ts`
- Modify: `tests/core/outline-expander.test.ts`
- Modify: `tests/core/runner-revalidation.test.ts`
- Modify: `tests/graph/chapter-report.test.ts`
- Modify: `tests/graph/consistency-context.test.ts`
- Modify: `tests/graph/fix-chapter.test.ts`
- Modify: `tests/graph/legacy-fix-validation.test.ts`
- Modify: `tests/graph/nodes/chapter-orchestration.test.ts`
- Modify: `tests/graph/nodes/planning.test.ts`
- Modify: `tests/graph/nodes/repair-state.test.ts`
- Modify: `tests/graph/nodes/validation-chapter.test.ts`
- Modify: `tests/graph/nodes/validation-source.test.ts`
- Modify: `tests/graph/nodes/validation.test.ts`
- Modify: `tests/graph/rewrite-flow.test.ts`
- Modify: `tests/graph/services/chapter-orchestration/preparation.test.ts`
- Modify: `tests/graph/services/finalization/chapter.test.ts`
- Modify: `tests/graph/services/state-repair/state-repair.test.ts`
- Modify: `tests/utils/context-judge.test.ts`
- Modify: `tests/utils/issue-deduplication.test.ts`
- Modify: `tests/utils/retry-strategy.test.ts`

- [ ] **Step 1: Add rule-ID assertions to producer tests**

In the existing tests for structured issues, validation, outline expansion, finalization, and fix
merge issues, add these assertions where the corresponding issue is constructed:

```ts
expect(issues.map((issue) => issue.ruleId)).toContain('structured.state-conflict')
expect(issue.ruleId).toBe('word-count.bounds')
expect(issue.ruleId).toBe('outline-coverage.unverified-mandatory-beat')
```

Use the following production mapping:

| Producer | Rule ID |
|---|---|
| structured state conflict | `structured.state-conflict` |
| unproven structured beat | `structured.beat-unproven` |
| false foreshadow fulfillment | `structured.foreshadow-false-fulfillment` |
| invalid foreshadow deadline | `structured.foreshadow-invalid-deadline` |
| missing/unexpected/evidence event | `structured.event-missing`, `structured.event-unexpected`, `structured.event-evidence-missing`, `structured.event-evidence-invalid` |
| word-count bound | `word-count.bounds` |
| previous-chapter variance | `word-count.chapter-variance` |
| opening continuity | `continuity.opening` |
| outline missing/gap/range/coverage/beats/deadline | `story-arc.missing`, `story-arc.gap`, `story-arc.range`, `story-arc.coverage`, `story-arc.empty-beats`, `story-arc.invalid-deadline` |
| outline foreshadow compliance | `outline.foreshadow-compliance` |
| outline density | `outline.density` |
| planner event contract | `planning.event-contract` |
| finalization state extraction | `finalization.state-extraction` |
| mandatory beat verification | `outline-coverage.unverified-mandatory-beat` |
| foreshadow equivalence/boundary/final-act | `foreshadow.equivalence`, `foreshadow.boundary`, `foreshadow.final-act-introduction` |
| fix merge/uncovered paragraph | `fix.merge-output`, `fix.uncovered-paragraph` |

Append stable EntityId, BeatId, ForeshadowId, chapter index, or evidence index to `ruleId` only when
one producer can emit multiple independent instances of the same rule.

- [ ] **Step 2: Run typecheck and focused tests to verify RED**

Run:

```bash
npm run typecheck
npx vitest run tests/core/chapter-generation/routing/structured-issues.test.ts \
  tests/graph/nodes/validation.test.ts tests/graph/services/finalization/chapter.test.ts \
  tests/graph/services/finalization/act-progress.test.ts tests/agents/fix.test.ts
```

Expected: missing `ruleId` errors in production and test Issue literals, plus failed new assertions.

- [ ] **Step 3: Populate production rule IDs**

Add `ruleId` to every `Issue` literal and to every `createIssue` partial using the mapping above.
For dynamic instances use machine IDs:

```ts
ruleId: `outline-coverage.unverified-mandatory-beat:${beatId}`
ruleId: `foreshadow.boundary:${foreshadowId}`
ruleId: `structured.event-evidence-invalid:${eventId}`
```

Do not use description or suggestion fragments.

- [ ] **Step 4: Update test factories and fixtures**

Update test helpers to default to a stable machine rule:

```ts
function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'issue-1',
    ruleId: 'test.rule',
    type: 'consistency',
    severity: 'error',
    description: 'display text',
    ...overrides,
  }
}
```

For fixtures whose routing behavior depends on issue identity, assign distinct rule IDs explicitly
instead of deriving identity from descriptions.

- [ ] **Step 5: Verify GREEN**

Run `npm run typecheck` and the Step 2 Vitest command.

Expected: typecheck passes and focused tests pass.

- [ ] **Step 6: Commit**

```bash
git add src tests
git commit -m "[Core] Assign stable rule IDs to runtime issues"
```

---

### Task 3: Replace character heuristics with explicit aliases and protagonists

**Files:**
- Modify: `src/types/character.ts`
- Modify: `src/agents/prompts/character-prompt.ts`
- Modify: `src/agents/character.ts`
- Modify: `src/utils/character-whitelist.ts`
- Modify: `src/graph/utils/reconciler/sanitize.ts`
- Modify: `src/agents/chapter.ts`
- Modify: `src/agents/prompts/chapter-prompt.ts`
- Create: `tests/agents/character.test.ts`
- Modify: `tests/utils/character-whitelist.test.ts`
- Modify: `tests/agents/chapter.test.ts`
- Modify: `tests/graph/utils/reconciler.test.ts`
- Modify: `tests/agents/summary.test.ts`
- Modify: `tests/graph/canonical-facts.test.ts`
- Modify: `tests/graph/story-creation.integration.test.ts`
- Modify: `tests/utils/outline-characters.test.ts`

- [ ] **Step 1: Write failing character-contract tests**

Add agent tests that expose `processOutput` and assert:

```ts
expect(
  agent.processOutput(
    {
      success: true,
      data: [
        {
          name: '甲',
          description: '主角',
          dialogueStyle: '简短',
          aliases: ['阿甲'],
          isProtagonist: true,
        },
      ],
    },
    'story-1'
  )
).toEqual([
  expect.objectContaining({
    name: '甲',
    aliases: ['阿甲'],
    isProtagonist: true,
  }),
])
```

Add rejection cases for missing `aliases`, missing `isProtagonist`, and a complete array with no
protagonist. Replace derived-alias tests with:

```ts
const registry = buildCharacterWhitelist([
  makeCharacter({ id: 'char-1', name: '林黛玉', aliases: ['黛玉'], isProtagonist: true }),
])
expect(registry.canonical('黛玉')).toBe('char-1')
expect(registry.canonical('林姑娘')).toBeUndefined()
```

Add a chapter prompt test with a supporting character first and two protagonists later. Assert both
protagonists appear in the protagonist rule and the first supporting character is not labeled a
protagonist.

- [ ] **Step 2: Verify RED**

Run:

```bash
npx vitest run tests/agents/character.test.ts tests/utils/character-whitelist.test.ts \
  tests/agents/chapter.test.ts tests/graph/utils/reconciler.test.ts
```

Expected: missing fields, old derived alias behavior, and first-array-element protagonist behavior
fail.

- [ ] **Step 3: Add the breaking Character schema**

Change the interface to:

```ts
export interface Character {
  id: string
  storyId: string
  name: string
  aliases: string[]
  isProtagonist: boolean
  description: string | null
  dialogueStyle: string | null
  createdAt: number
}
```

Change the character prompt to require the English JSON fields `name`, `description`,
`dialogueStyle`, `aliases`, and `isProtagonist`, and require at least one protagonist.

- [ ] **Step 4: Validate character output without fallbacks**

Remove Chinese-key and first-array fallbacks from `CharacterAgent.processOutput`. Accept only objects
with a non-empty name, an array of non-empty aliases, and a boolean protagonist marker. Return an
empty array for an invalid batch or a batch with no protagonist.

- [ ] **Step 5: Resolve exact names and aliases to EntityIds**

Delete `deriveAliases`. Register each character ID, exact name, and exact declared aliases:

```ts
idByReference.set(character.id, character.id)
idByReference.set(character.name.trim(), character.id)
for (const alias of character.aliases) {
  idByReference.set(alias.trim(), character.id)
}
```

Make `canonical(reference)` return the EntityId. In sanitization, write resolved EntityIds as map
keys. Do not retain display names as state keys.

- [ ] **Step 6: Render an explicit protagonist list**

Replace `charactersList?.[0]` with:

```ts
const protagonistNames = (state.charactersList ?? [])
  .filter((character) => character.isProtagonist)
  .map((character) => character.name)
```

Update the chapter prompt template to render a protagonist list and require consistency for every
listed protagonist.

- [ ] **Step 7: Update fixtures and verify GREEN**

Run `npm run typecheck`, then the Step 2 test command.

Expected: typecheck and tests pass.

- [ ] **Step 8: Commit**

```bash
git add src tests
git commit -m "[Core] Use explicit character aliases and protagonist roles"
```

---

### Task 4: Remove item-name normalization and repair value guessing

**Files:**
- Modify: `src/utils/items.ts`
- Modify: `src/utils/canonical-facts.ts`
- Modify: `src/graph/utils/reconciler/format.ts`
- Modify: `src/graph/utils/reconciler/state-merge.ts`
- Modify: `src/graph/utils/reconciler/sanitize.ts`
- Modify: `src/graph/services/state-repair/index.ts`
- Modify: `tests/graph/utils/reconciler.test.ts`
- Modify: `tests/graph/services/state-repair/state-repair.test.ts`
- Modify: `tests/graph/canonical-facts.test.ts`

- [ ] **Step 1: Write failing exact-identity tests**

Add:

```ts
it('keeps decorated and undecorated item subjects distinct', () => {
  expect(
    mergeItemRecordsExact(
      { item_plain: 'loc-a' },
      { '《item_plain》': 'loc-b' }
    )
  ).toEqual({
    item_plain: 'loc-a',
    '《item_plain》': 'loc-b',
  })
})
```

In reconciler tests, assert sanitization does not report or merge `item_plain` and
`《item_plain》`. In state-repair tests, create actual/expected values that match known EntityIds but
set `issue.subject` to a different entity. Capture the repair prompt and assert facts for the value
IDs are absent.

- [ ] **Step 2: Verify RED**

Run:

```bash
npx vitest run tests/graph/utils/reconciler.test.ts \
  tests/graph/services/state-repair/state-repair.test.ts
```

Expected: current item canonicalization merges the keys and state repair includes value-shaped IDs.

- [ ] **Step 3: Replace item helpers with exact-key merging**

Remove wrapper pairs, `canonicalizeItemName`, and `resolveCanonicalItemGroup`. Export:

```ts
export function mergeItemRecordsExact(
  base: Record<string, string>,
  delta: Record<string, string>,
  options: MergeCanonicalRecordsOptions = {}
): Record<string, string> {
  const result = { ...base }
  for (const [entityId, value] of Object.entries(delta)) {
    if (!value || value === options.ignoreValue) continue
    result[entityId] = value
  }
  return result
}
```

Update canonical fact lookup, rendering, state merge, and sanitization to use exact subject/key
equality. Remove canonical item grouping and return empty ambiguity arrays rather than inferring
identity from display names.

- [ ] **Step 4: Restrict repair context to verified subjects**

Build `involvedSubjects` as:

```ts
const involvedSubjects = new Set(
  input.issues
    .map((issue) => issue.subject)
    .filter((subject): subject is string => subject !== undefined && knownEntityIds.has(subject))
)
```

Do not inspect or split actual/expected values.

- [ ] **Step 5: Verify GREEN**

Run `npm run typecheck` and the Step 2 tests.

Expected: exact identities remain distinct and repair context includes only verified subjects.

- [ ] **Step 6: Commit**

```bash
git add src tests
git commit -m "[Core] Remove prose-based entity normalization"
```

---

### Task 5: Centralize all audited policy values

**Files:**
- Modify: `src/types/genre.ts`
- Modify: `src/utils/chapter-planning.ts`
- Modify: `tests/core/chapter-generation/routing/fingerprint.test.ts`
- Modify: `tests/core/chapter-generation/routing/issue-policy.test.ts`
- Modify: `tests/core/chapter-generation/routing/state-repair-routing.test.ts`
- Modify: `tests/core/chapter-generation/routing/structured-validation-routing.test.ts`
- Modify: `tests/genres/registry.test.ts`
- Create: `tests/utils/chapter-planning.test.ts`

- [ ] **Step 1: Write a failing merged-config test**

Add a test that installs or mocks a GenreSkill override and expects:

```ts
expect(getChapterPlanningConfig('custom')).toMatchObject({
  storyActCountMin: 2,
  storyActCountMax: 7,
  chapterWordCountToleranceRatio: 0.05,
  bookClosingPhaseRatio: 0.1,
  actClosingPhaseRatio: 0.25,
  maxAutoFixAttempts: 4,
  maxStateRepairAttempts: 1,
  rewriteStallSimilarityThreshold: 0.8,
  rewriteStallMinRounds: 4,
})
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npx vitest run tests/genres/registry.test.ts tests/utils/chapter-planning.test.ts
```

Expected: the new fields are absent.

- [ ] **Step 3: Extend the config type and defaults**

Add the fields from the design and replace `closingPhaseRatio` with
`bookClosingPhaseRatio`. Use defaults:

```ts
storyActCountMin: 3,
storyActCountMax: 5,
chapterWordCountToleranceRatio: 0.1,
bookClosingPhaseRatio: 0.15,
actClosingPhaseRatio: 0.2,
maxAutoFixAttempts: 3,
maxStateRepairAttempts: 2,
rewriteStallSimilarityThreshold: 0.7,
rewriteStallMinRounds: 3,
```

Keep `maxErrorRewriteAttempts: 3`.

- [ ] **Step 4: Rename all book-closing consumers**

Replace every `planningConfig.closingPhaseRatio` use with
`planningConfig.bookClosingPhaseRatio`. Do not change act-closing logic yet; Task 8 wires the
separate act value.

- [ ] **Step 5: Verify GREEN**

Run `npm run typecheck` and the Step 2 test command.

- [ ] **Step 6: Commit**

```bash
git add src tests
git commit -m "[Config] Centralize narrative policy limits"
```

---

### Task 6: Render act-count and outline-shape configuration in prompts

**Files:**
- Modify: `src/agents/prompts/story-arc-prompt.ts`
- Modify: `src/agents/story-arc.ts`
- Modify: `src/agents/prompts/chapter-outline-prompt.ts`
- Modify: `src/agents/chapter-outline.ts`
- Modify: `tests/agents/story-arc.test.ts`
- Modify: `tests/agents/chapter-outline.test.ts`

- [ ] **Step 1: Write failing prompt tests**

Expose prompt builders through existing test subclasses. Register a custom genre with act limits
2–7 and outline limits 80–120 characters / 2–4 sentences. Assert:

```ts
expect(storyArcPrompt).toContain('划分为 2-7 幕')
expect(storyArcPrompt).not.toContain('3-5 幕')
expect(chapterOutlinePrompt).toContain('2–4 句描述（80–120 字）')
expect(chapterOutlinePrompt).not.toContain('1–2 句描述（30–60 字）')
```

Assert the story-arc illustrative structure no longer contains fixed `endChapter: 10` or
`deadlineAct: 2`.

- [ ] **Step 2: Verify RED**

Run:

```bash
npx vitest run tests/agents/story-arc.test.ts tests/agents/chapter-outline.test.ts
```

Expected: current hard-coded prompt text fails.

- [ ] **Step 3: Add prompt placeholders**

Render:

```ts
STORY_ACT_COUNT_MIN
STORY_ACT_COUNT_MAX
OUTLINE_DESCRIPTION_LENGTH_MIN
OUTLINE_DESCRIPTION_LENGTH_MAX
OUTLINE_DESCRIPTION_SENTENCE_COUNT_MIN
OUTLINE_DESCRIPTION_SENTENCE_COUNT_MAX
```

Resolve values with `getChapterPlanningConfig(state.genre)`. Replace numeric JSON examples with
descriptive symbolic values and keep the surrounding output-field requirements explicit.

Do not split description prose or make runtime semantic decisions from sentence delimiters.

- [ ] **Step 4: Verify GREEN**

Run the Step 2 command and `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/agents tests/agents
git commit -m "[Prompts] Render configurable story structure limits"
```

---

### Task 7: Use one word-count tolerance policy everywhere

**Files:**
- Modify: `src/utils/chapter-content-validation.ts`
- Modify: `src/agents/prompts/chapter-prompt.ts`
- Modify: `src/agents/chapter.ts`
- Modify: `src/graph/nodes/draft.ts`
- Modify: `src/graph/nodes/validation.ts`
- Modify: `tests/utils/chapter-content-validation.test.ts`
- Modify: `tests/graph/nodes/draft.test.ts`
- Modify: `tests/graph/nodes/validation-chapter.test.ts`
- Modify: `tests/agents/chapter.test.ts`

- [ ] **Step 1: Write failing shared-boundary tests**

Add:

```ts
const policy = getChapterWordCountPolicy('custom-genre')
expect(policy).toEqual({
  min: 100,
  max: 1000,
  tolerance: 50,
  effectiveMax: 1050,
  toleranceRatio: 0.05,
})
expect(validateWordCount(contentWithWords(1050), policy).valid).toBe(true)
expect(validateWordCount(contentWithWords(1051), policy).valid).toBe(false)
```

At node level, feed the same boundary content to draft validation and comprehensive validation and
assert both accept 1050 and reject 1051. Assert the prompt displays 5%, not 10%.

- [ ] **Step 2: Verify RED**

Run:

```bash
npx vitest run tests/utils/chapter-content-validation.test.ts \
  tests/graph/nodes/draft.test.ts tests/graph/nodes/validation-chapter.test.ts \
  tests/agents/chapter.test.ts
```

Expected: draft and comprehensive validation disagree and prompt tolerance is fixed.

- [ ] **Step 3: Implement one policy helper**

Add:

```ts
export interface ChapterWordCountPolicy extends ChapterWordCountBounds {
  toleranceRatio: number
  tolerance: number
  effectiveMax: number
}

export function getChapterWordCountPolicy(genre: string | undefined): ChapterWordCountPolicy {
  const bounds = getChapterWordCountBounds(genre)
  const config = getChapterPlanningConfig(genre ?? 'default')
  const tolerance = Math.round(bounds.max * config.chapterWordCountToleranceRatio)
  return {
    ...bounds,
    toleranceRatio: config.chapterWordCountToleranceRatio,
    tolerance,
    effectiveMax: bounds.max + tolerance,
  }
}
```

Make `validateWordCount` accept this policy and remove independently supplied tolerance values.
Make fixed-content validation, draft, and comprehensive validation use this helper.

- [ ] **Step 4: Render the configured tolerance**

Replace “约 10%” with a template variable computed from the policy. Ensure `ChapterAgent` passes
the value used by validation.

- [ ] **Step 5: Verify GREEN**

Run the Step 2 tests and `npm run typecheck`.

- [ ] **Step 6: Commit**

```bash
git add src tests
git commit -m "[Validation] Unify chapter word-count tolerance"
```

---

### Task 8: Wire closing-phase and retry budgets through routing and reports

**Files:**
- Modify: `src/utils/story-arc.ts`
- Modify: `src/graph/services/finalization/act-progress.ts`
- Modify: `src/graph/services/finalization/chapter.ts`
- Modify: `src/core/chapter-generation/routing/index.ts`
- Modify: `src/core/chapter-generation/routing/types.ts`
- Modify: `src/graph/services/chapter-orchestration/routing.ts`
- Modify: `tests/utils/story-arc.test.ts`
- Modify: `tests/graph/services/finalization/act-progress.test.ts`
- Modify: `tests/core/chapter-generation/routing/state-repair-routing.test.ts`
- Modify: `tests/core/chapter-generation/routing/fingerprint.test.ts`
- Modify: `tests/graph/chapter-report.test.ts`

- [ ] **Step 1: Write failing custom-policy tests**

Add routing tests with:

```ts
planningConfig: {
  ...DEFAULT_CHAPTER_PLANNING_CONFIG,
  maxAutoFixAttempts: 1,
  maxStateRepairAttempts: 1,
  rewriteStallSimilarityThreshold: 0.9,
  rewriteStallMinRounds: 4,
  maxErrorRewriteAttempts: 5,
}
```

Assert:

- an automatic fix is not scheduled after one attempt;
- a state repair is not scheduled after one attempt;
- three similar rounds do not stall when four are configured;
- four rounds below 90% similarity do not stall;
- report convergence remains `manual-rewrite-requested` at three error rewrites and becomes
  `max-attempts-reached` at five.

Add act-progress tests proving a custom `actClosingPhaseRatio` controls pressure at the boundary.

- [ ] **Step 2: Verify RED**

Run:

```bash
npx vitest run tests/core/chapter-generation/routing/state-repair-routing.test.ts \
  tests/core/chapter-generation/routing/fingerprint.test.ts \
  tests/graph/services/finalization/act-progress.test.ts \
  tests/graph/chapter-report.test.ts tests/utils/story-arc.test.ts
```

Expected: fixed 2/3/0.7/3/0.2 values override the custom policy.

- [ ] **Step 3: Remove local retry constants**

In routing, use:

```ts
config.maxStateRepairAttempts
config.maxAutoFixAttempts
config.rewriteStallSimilarityThreshold
config.rewriteStallMinRounds
config.maxErrorRewriteAttempts
```

Pass stall values into both similarity and subset stall helpers. Subset stall uses the configured
round window instead of `lastThree`.

- [ ] **Step 4: Pass act-closing policy into finalization**

Resolve `getChapterPlanningConfig(state.genre)` at the finalization service boundary. Replace every
`<= 0.2` act-closing check with a helper receiving `config.actClosingPhaseRatio`.

Require book-closing callers of `isClosingPhase` and `buildClosingPhaseConstraint` to pass
`config.bookClosingPhaseRatio`; remove the default ratio argument so missing propagation is a
typecheck failure.

- [ ] **Step 5: Use configured convergence reporting**

In `inferConvergence`, resolve the planning config from `state.genre` and compare
`errorRewriteAttempts` with `maxErrorRewriteAttempts`.

- [ ] **Step 6: Verify GREEN**

Run the Step 2 tests and `npm run typecheck`.

- [ ] **Step 7: Commit**

```bash
git add src tests
git commit -m "[Routing] Use configured convergence and closing budgets"
```

---

### Task 9: Strengthen hard-coding regression guards

**Files:**
- Modify: `tests/smoke/no-prose-matching.test.ts`
- Modify: `tests/smoke/project-smoke.test.ts`

- [ ] **Step 1: Add failing guards for every removed heuristic**

Add repository assertions that reject:

```ts
const forbiddenRuntimeIdentifiers = [
  'hashIssueDescription',
  'deriveAliases',
  'canonicalizeItemName',
  'resolveCanonicalItemGroup',
  "actualValue.includes(' ')",
  "expectedValue.includes(' ')",
  'charactersList?.[0]?.name',
]
```

Add prompt guard assertions rejecting:

```ts
'3-5 幕'
'1–2 句描述（30–60 字）'
'约 10% 以内'
```

Scan all `src/**/*.ts`, not a preselected file map, for these exact retired constructs. Keep the
existing focused blacklist for older technical debt.

- [ ] **Step 2: Verify the guard would have failed on the baseline**

Before deleting any remaining retired construct, run:

```bash
npx vitest run tests/smoke/no-prose-matching.test.ts tests/smoke/project-smoke.test.ts
```

Expected: failure naming any construct not yet removed.

- [ ] **Step 3: Remove remaining occurrences and verify GREEN**

Use:

```bash
rg -n "hashIssueDescription|deriveAliases|canonicalizeItemName|resolveCanonicalItemGroup|charactersList\\?\\.\\[0\\]\\?\\.name|3-5 幕|1–2 句描述（30–60 字）|约 10% 以内" src
```

Expected after cleanup: no matches. Re-run the Step 2 tests; both pass.

- [ ] **Step 4: Commit**

```bash
git add tests/smoke src
git commit -m "[Tests] Guard against runtime semantic hardcoding"
```

---

### Task 10: Full verification and review

**Files:**
- Review all changed production and test files

- [ ] **Step 1: Format changed files**

Run:

```bash
npm run format
```

Expected: Prettier completes successfully.

- [ ] **Step 2: Run static verification**

Run:

```bash
npm run typecheck
npm run lint
npm run format:check
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 3: Run build and full tests**

Run:

```bash
npm run build
npm test
```

Expected: build succeeds and all test files pass.

- [ ] **Step 4: Verify scope and data integrity**

Run:

```bash
git status --short
git diff --name-only d520f97...HEAD
git diff --stat d520f97...HEAD
```

Confirm no path under `books/`, `output/`, or `.museflow/` is present. Confirm package-lock changes
are absent unless a dependency was intentionally added; this plan adds no dependency.

- [ ] **Step 5: Request code review**

Review specifically for:

- any runtime decision using issue/story prose;
- any missing or unstable issue `ruleId`;
- any new fallback for old checkpoints;
- any prompt/validation policy mismatch;
- accidental edits to user data or unrelated files.

- [ ] **Step 6: Fix review findings with focused tests**

For each finding, add or adjust one failing targeted test, verify RED, implement the minimal fix,
and verify GREEN before proceeding.

- [ ] **Step 7: Re-run the full verification**

Repeat Steps 2 and 3. Expected: every command exits 0.

- [ ] **Step 8: Commit final review fixes**

```bash
git add src tests
git commit -m "[Core] Complete structured hardcoding removal"
```
