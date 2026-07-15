# Foreshadow Semantic Planning Root Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent legacy optional foreshadows and semantically false fulfillment plans from creating a non-converging chapter rewrite loop.

**Architecture:** Normalize legacy policy/deadline fields at the StoryMemory compatibility boundary, enrich typed planning obligations with the planted clue, and add a model-backed structured semantic gate after all chapter-plan rewrites. Negative non-mandatory judgments are structurally deferred; mandatory negative judgments force one bounded outline-and-plan regeneration, while post-draft false fulfillments discard the stale plan so the same gate runs again.

**Tech Stack:** Node.js 20+, TypeScript ESM, LangGraph state, JSON-schema structured model output, Vitest.

---

## File map

- `src/story-memory/resolution-policy.ts`: single compatibility authority for legacy policy and deadline normalization.
- `src/story-memory/event-contract.ts`: normalize legacy events while preserving strict validation for newly generated events.
- `src/story-memory/projector.ts`: replay unnormalized persisted legacy events through the compatibility authority.
- `src/agents/types.ts`: semantic planning obligation and rejection contracts.
- `src/agents/prompts/fragments/foreshadow-planning.ts`: render planted clue context and semantic rejection feedback.
- `src/graph/services/foreshadow-fulfillment/planning-verifier.ts`: focused pre-draft semantic verifier.
- `src/core/outline-expander.ts`: invoke the semantic gate, defer optional claims, and perform one bounded mandatory replan.
- `src/core/chapter-generation/routing/index.ts`: discard stale plans for post-draft false fulfillments.
- Mirrored test files under `tests/` cover each behavior before production changes.

### Task 1: Normalize legacy optional deadlines

**Files:**
- Modify: `tests/story-memory/resolution-policy.test.ts`
- Modify: `tests/story-memory/event-contract.test.ts`
- Modify: `tests/story-memory/projector.test.ts`
- Modify: `src/story-memory/resolution-policy.ts`
- Modify: `src/story-memory/event-contract.ts`
- Modify: `src/story-memory/projector.ts`

- [ ] **Step 1: Write failing compatibility tests**

Add cases proving the approved matrix and projected deadline:

```ts
it.each([
  [true, 12, 'must_resolve', 12],
  [false, 12, 'may_remain_open', null],
  [true, null, 'should_resolve', null],
  [false, null, 'may_remain_open', null],
  [undefined, 12, 'must_resolve', 12],
  [undefined, null, 'should_resolve', null],
] as const)(
  'normalizes required=%s deadline=%s to %s/%s',
  (required, deadline, expectedPolicy, expectedDeadline) => {
    expect(resolutionPolicy.normalizeLegacyForeshadowFields(required, deadline)).toEqual({
      resolutionPolicy: expectedPolicy,
      expectedFulfillChapter: expectedDeadline,
    })
  }
)
```

Also assert that legacy event normalization and projection turn `required: false` plus deadline `12` into `may_remain_open`, `required: false`, and deadline `null`, while strict explicit `may_remain_open` plus a finite deadline remains invalid.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npx vitest run tests/story-memory/resolution-policy.test.ts tests/story-memory/event-contract.test.ts tests/story-memory/projector.test.ts
```

Expected: FAIL because `normalizeLegacyForeshadowFields` does not exist and current replay projects `must_resolve` with deadline `12`.

- [ ] **Step 3: Implement the compatibility authority**

Add the normalized result type and helper, and make the policy-only helper delegate to it:

```ts
export interface NormalizedLegacyForeshadowFields {
  resolutionPolicy: ForeshadowResolutionPolicy
  expectedFulfillChapter: number | null
}

export function normalizeLegacyForeshadowFields(
  required: boolean | undefined,
  expectedFulfillChapter: number | null
): NormalizedLegacyForeshadowFields {
  if (required === false) {
    return { resolutionPolicy: 'may_remain_open', expectedFulfillChapter: null }
  }
  if (Number.isInteger(expectedFulfillChapter)) {
    return { resolutionPolicy: 'must_resolve', expectedFulfillChapter }
  }
  return { resolutionPolicy: 'should_resolve', expectedFulfillChapter: null }
}
```

Use this helper only when `resolutionPolicy` is absent. Explicit V2 policy/deadline pairs still go through `validatePolicyDeadline`. Update V1 migration and projector replay to persist both normalized fields.

- [ ] **Step 4: Run tests and verify GREEN**

Run the Task 1 command. Expected: all selected tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/story-memory/resolution-policy.ts src/story-memory/event-contract.ts src/story-memory/projector.ts tests/story-memory/resolution-policy.test.ts tests/story-memory/event-contract.test.ts tests/story-memory/projector.test.ts
git commit -m "fix(foreshadow): preserve legacy optional deadlines"
```

### Task 2: Give planning agents the planted clue

**Files:**
- Modify: `tests/agents/chapter-outline.test.ts`
- Modify: `tests/agents/chapter-planner.test.ts`
- Modify: `tests/core/outline-expander.test.ts`
- Modify: `src/agents/types.ts`
- Modify: `src/agents/prompts/fragments/foreshadow-planning.ts`
- Modify: `src/core/outline-expander.ts`

- [ ] **Step 1: Write failing prompt and wiring tests**

Construct obligations with the new fields and assert that both prompts contain the semantic context:

```ts
{
  id: 'fs-light',
  text: '角色闭眼后灯仍持续亮着',
  kind: 'plot',
  introducedChapter: 3,
  resolutionPolicy: 'must_resolve',
  deadlineChapter: 61,
  schedulingMode: 'mandatory',
  mustFulfillThisChapter: true,
}
```

Assert the rendered prompt contains `text=`, `kind=plot`, and `introducedChapter=3`. In `outline-expander.test.ts`, inspect both outline-agent and planner inputs and assert the obligation was populated from `StoryMemory`.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npx vitest run tests/agents/chapter-outline.test.ts tests/agents/chapter-planner.test.ts tests/core/outline-expander.test.ts
```

Expected: FAIL because the prompt and obligation builder omit the planted fields.

- [ ] **Step 3: Extend the typed obligation and renderer**

```ts
export interface ForeshadowPlanningObligation {
  id: ForeshadowId
  text: string
  kind: ForeshadowKind | null
  introducedChapter: number
  resolutionPolicy: ForeshadowResolutionPolicy
  deadlineChapter: number | null
  schedulingMode: 'mandatory' | 'opportunity' | 'ambient'
  mustFulfillThisChapter: boolean
}
```

Populate the fields from `ForeshadowMemory` in both mandatory and opportunity branches. Render the values as passive context and retain exact-ID instructions.

- [ ] **Step 4: Run tests and verify GREEN**

Run the Task 2 command. Expected: all selected tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/agents/types.ts src/agents/prompts/fragments/foreshadow-planning.ts src/core/outline-expander.ts tests/agents/chapter-outline.test.ts tests/agents/chapter-planner.test.ts tests/core/outline-expander.test.ts
git commit -m "fix(planning): include planted foreshadow context"
```

### Task 3: Add the structured planning verifier

**Files:**
- Create: `src/graph/services/foreshadow-fulfillment/planning-verifier.ts`
- Create: `tests/graph/services/foreshadow-fulfillment/planning-verifier.test.ts`

- [ ] **Step 1: Write failing verifier tests**

Cover: empty candidate set skips the provider; all candidates are checked in one call; planted text, outline, sections, and expected event reach the prompt; `not_fulfilled` and `uncertain` are returned; missing/duplicate/unknown IDs and provider failures produce `verification_failed`; missing StoryMemory records fail before the provider call.

Use this public contract:

```ts
const judgments = await verifyForeshadowPlan({
  provider,
  memory,
  outline: {
    number: 60,
    title: '最后一手',
    description: '灯没有亮，却声称回收灯持续亮着的伏笔。',
    fulfilledForeshadowIds: ['fs-light'],
  },
  plan,
  mandatoryIds: ['fs-light'],
})
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
npx vitest run tests/graph/services/foreshadow-fulfillment/planning-verifier.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the verifier**

Export:

```ts
export type ForeshadowPlanningVerdict =
  | 'fulfilled'
  | 'not_fulfilled'
  | 'uncertain'
  | 'verification_failed'

export interface ForeshadowPlanningJudgment {
  foreshadowId: string
  verdict: ForeshadowPlanningVerdict
  reason: string
  mandatory: boolean
}
```

Build candidate IDs structurally from outline declarations, plan declarations, and `foreshadow-fulfill` events. Call `chatStructured`/`chatStructuredFallback` with the same three semantic verdicts used by the post-draft verifier. TypeScript validates exact response cardinality and IDs only; it performs no prose matching.

- [ ] **Step 4: Run test and verify GREEN**

Run the Task 3 command. Expected: all planning-verifier tests pass.

- [ ] **Step 5: Run the prose-matching guard**

```bash
npx vitest run tests/smoke/no-prose-matching.test.ts
```

Expected: all smoke assertions pass.

- [ ] **Step 6: Commit**

```bash
git add src/graph/services/foreshadow-fulfillment/planning-verifier.ts tests/graph/services/foreshadow-fulfillment/planning-verifier.test.ts
git commit -m "feat(planning): verify foreshadow plans semantically"
```

### Task 4: Gate final plans and perform bounded replanning

**Files:**
- Modify: `tests/core/outline-expander.test.ts`
- Modify: `src/agents/types.ts`
- Modify: `src/agents/prompts/fragments/foreshadow-planning.ts`
- Modify: `src/core/outline-expander.ts`

- [ ] **Step 1: Write failing outline-expander regression tests**

Mock `verifyForeshadowPlan` with a default successful result. Add three focused cases:

1. A non-mandatory negative judgment removes the ID from outline/plan fulfillment arrays, removes its matching `foreshadow-fulfill` event, and adds it to `deferredForeshadowIds`.
2. A mandatory negative judgment invokes the outline agent despite an existing non-empty description, passes the current outline plus typed semantic rejection, discards the old plan, and returns the second semantically valid plan.
3. A second mandatory negative judgment throws before the chapter writer can be called.

The contradiction fixture must use a planted clue saying the light remained on and a planned event saying it did not light, while all runtime decisions use the mocked structured verdict rather than matching those sentences.

- [ ] **Step 2: Run test and verify RED**

```bash
npx vitest run tests/core/outline-expander.test.ts
```

Expected: the new deferral/revision assertions fail because no pre-draft gate is invoked.

- [ ] **Step 3: Extend typed rejection feedback**

```ts
export interface ForeshadowSemanticPlanningRejection {
  foreshadowId: ForeshadowId
  verdict: 'not_fulfilled' | 'uncertain'
  reason: string
}

export interface ForeshadowPlanningRejection {
  missingDeclarationIds: ForeshadowId[]
  missingEventIds: ForeshadowId[]
  incorrectlyDeferredIds: ForeshadowId[]
  semanticRejections?: ForeshadowSemanticPlanningRejection[]
  currentOutline?: { title: string; description: string }
}
```

Render the current outline and semantic reasons in `<foreshadow_planning_rejection>` without parsing them in runtime code.

- [ ] **Step 4: Add structural deferral helpers**

Implement a helper that updates all correlated fields by exact ID:

```ts
function deferForeshadowClaims(
  state: ReducedGraphState,
  chapterIndex: number,
  plan: ChapterPlan,
  ids: readonly string[]
): { state: ReducedGraphState; plan: ChapterPlan } {
  const deferredIds = new Set(ids)
  const outline = [...state.outline]
  const item = outline[chapterIndex]
  if (!item) return { state, plan }
  outline[chapterIndex] = {
    ...item,
    fulfilledForeshadowIds: (item.fulfilledForeshadowIds ?? []).filter(
      (id) => !deferredIds.has(id)
    ),
    deferredForeshadowIds: Array.from(
      new Set([...(item.deferredForeshadowIds ?? []), ...deferredIds])
    ),
  }
  return {
    state: { ...state, outline },
    plan: {
      ...plan,
      fulfilledForeshadowIds: plan.fulfilledForeshadowIds.filter(
        (id) => !deferredIds.has(id)
      ),
      expectedEvents: plan.expectedEvents.filter(
        (event) => event.type !== 'foreshadow-fulfill' || !deferredIds.has(event.foreshadowId)
      ),
    },
  }
}
```

Use it for both semantic deferral and the existing exhausted structural-evidence deferral.

- [ ] **Step 5: Add the final semantic gate and bounded retry**

Invoke `verifyForeshadowPlan` after time-anchor/budget replans and beat-contract reconciliation. Fail closed on `verification_failed`. For non-mandatory negative judgments, call `deferForeshadowClaims` and re-run capacity adjudication. For mandatory negatives, force `generateChapterOutlineIfNeeded` with typed feedback even when description is non-empty, validate the new outline through `reconcileOutlineCandidate`, clear `chapterPlan`, and recursively re-enter expansion with an internal attempt count capped at one retry. Pass the semantic rejection into both outline and planner inputs on the retry.

- [ ] **Step 6: Run tests and verify GREEN**

Run:

```bash
npx vitest run tests/core/outline-expander.test.ts tests/agents/chapter-outline.test.ts tests/agents/chapter-planner.test.ts tests/graph/services/foreshadow-fulfillment/planning-verifier.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/agents/types.ts src/agents/prompts/fragments/foreshadow-planning.ts src/core/outline-expander.ts tests/core/outline-expander.test.ts tests/agents/chapter-outline.test.ts tests/agents/chapter-planner.test.ts
git commit -m "fix(planning): reject false foreshadow plans before drafting"
```

### Task 5: Discard stale plans after post-draft false fulfillment

**Files:**
- Modify: `tests/core/chapter-generation/routing/structured-validation-routing.test.ts`
- Modify: `src/core/chapter-generation/routing/index.ts`

- [ ] **Step 1: Write the failing routing test**

For a state with a chapter file and `falseFulfillments: ['fs-1']`, assert:

```ts
expect(result.step).toMatchObject({
  kind: 'draft_chapter',
  discardPlan: true,
})
expect(result.sessionUpdate.forceStructuralRewrite).toBe(true)
```

Keep the existing state-conflict assertion at `discardPlan: false` to prove unrelated structured issues retain current behavior.

- [ ] **Step 2: Run test and verify RED**

```bash
npx vitest run tests/core/chapter-generation/routing/structured-validation-routing.test.ts
```

Expected: FAIL because the structured issue branch currently always sets `discardPlan: false`.

- [ ] **Step 3: Implement exact typed routing**

Add an issue-type helper based only on the structured enum:

```ts
function requiresForeshadowReplan(issues: readonly Issue[]): boolean {
  return issues.some((issue) => issue.type === 'foreshadow_false_fulfillment')
}
```

Use it in both draft branches to set `discardPlan` and `forceStructuralRewrite`. Do not inspect issue descriptions or prose.

- [ ] **Step 4: Run test and verify GREEN**

Run the Task 5 command. Expected: all routing tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/chapter-generation/routing/index.ts tests/core/chapter-generation/routing/structured-validation-routing.test.ts
git commit -m "fix(routing): replan false foreshadow fulfillments"
```

### Task 6: Full verification and handoff

**Files:**
- Inspect: all implementation and test files listed above.

- [ ] **Step 1: Run targeted regression suite**

```bash
npx vitest run tests/story-memory/resolution-policy.test.ts tests/story-memory/event-contract.test.ts tests/story-memory/projector.test.ts tests/agents/chapter-outline.test.ts tests/agents/chapter-planner.test.ts tests/graph/services/foreshadow-fulfillment/planning-verifier.test.ts tests/graph/services/foreshadow-fulfillment/semantic-verifier.test.ts tests/core/outline-expander.test.ts tests/core/chapter-generation/routing/structured-validation-routing.test.ts tests/smoke/no-prose-matching.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 2: Run static checks**

```bash
npm run typecheck
npm run lint
npm run format:check
```

Expected: every command exits 0.

- [ ] **Step 3: Run the full suite**

```bash
npm test
```

Expected: all test files and tests pass with zero failures.

- [ ] **Step 4: Inspect final scope**

```bash
git status --short
git diff --check
git diff --stat develop...HEAD
```

Expected: no whitespace errors, no changes under `books/`, and only the files listed in this plan plus the plan document are changed.
