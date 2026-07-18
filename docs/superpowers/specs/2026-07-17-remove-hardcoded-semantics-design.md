# Remove Hard-Coded Story Semantics Design

## Goal

Remove the runtime hard-coded heuristics and duplicated policy values found in the MuseFlow audit.
All behavior that changes story state, issue routing, or chapter acceptance must use explicit
structured fields and a single configuration source.

This is an intentionally breaking change. Existing stories and checkpoints are not supported by
the new schema, and the implementation must not edit `books/` to make them appear compatible.

## Scope

The change covers:

- stable issue identity without hashing prose;
- explicit character aliases and protagonist roles;
- exact EntityId-based item and character identity;
- state repair context built only from structured entity references;
- mandatory-beat planning, proof, progress, and issue cleanup keyed by stable beat IDs;
- shared configuration for outline shape, act count, word-count tolerance, closing phases, and
  retry/convergence and automatic act-boundary budgets;
- prompt, validation, routing, finalization, and report consumers using that shared configuration;
- repository guards that reject the removed heuristic patterns.

The change does not redesign StoryMemory event types, alter the JSON/filesystem storage
architecture, or modify generated story data in `books/`.

## Structured Identity

### Issues

`Issue` gains a required `ruleId: string`. A rule ID identifies the validator rule that produced
the issue and must remain stable across retries. Issue producers may continue to generate unique
`id` values for individual occurrences, but routing and deduplication must not use `id` or prose.

The issue fingerprint is composed from:

- `ruleId`;
- `type`;
- `dimension`;
- `source`;
- `subject`;
- `conflictAttribute`;
- `locationRef.paragraphIndex`;
- `locationRef.sentenceIndex`.

Missing optional components use fixed machine markers. `description`, `suggestion`, `location`,
`actualValue`, and `expectedValue` never participate in the fingerprint.

Every runtime issue producer must provide a stable rule ID. Dynamic identifiers may be appended
only from structured IDs or indexes, such as a mandatory beat ID, ForeshadowId, EntityId, chapter
index, paragraph index, or sentence index.

### Characters

`Character` gains two required fields:

```ts
aliases: string[]
isProtagonist: boolean
```

The character agent output uses the machine-readable keys `name`, `description`,
`dialogueStyle`, `aliases`, and `isProtagonist`. Its parser rejects a response when:

- a character lacks `name`, `aliases`, or `isProtagonist`;
- aliases are not an array of non-empty strings;
- the complete response contains no protagonist.

The character registry maps exact `name` and exact explicit aliases to the character's EntityId. It
does not derive aliases from string length, surname conventions, punctuation, or substrings.
Official names take precedence over aliases. A reference declared by more than one character is
ambiguous and is not resolved; the character agent rejects cross-character name/alias collisions.
Sanitization writes the resolved EntityId into StoryState rather than retaining a display name.

Chapter prompts render all characters whose `isProtagonist` is true. The prompt rules refer to a
protagonist list rather than assuming `charactersList[0]` is the protagonist.

### Items and Canonical Facts

StoryMemory and projected StoryState already use EntityIds as map keys. Runtime reconciliation must
preserve those exact keys.

`canonicalizeItemName`, decorative-wrapper stripping, canonical item grouping, and “later name
wins” merging are removed. State maps merge by exact key only. Canonical fact lookup uses exact
`subject` equality. Two different subject strings remain different entities.

### State Repair

State repair derives relevant facts only from `issue.subject` after verifying that the subject is
in StoryMemory's known EntityId set. It never promotes `actualValue` or `expectedValue` to an entity
reference based on whitespace or text shape.

The displayed actual and expected values remain available to the model as evidence, but they have
no effect on which canonical facts are selected.

### Mandatory Beats

Every mandatory beat is identified by `A{actIndex}-M{oneBasedBeatIndex}`. Beat prose is display
content only and must not be used to infer, verify, remove, or restore progress.

- Chapter-outline output claims mandatory beats through `claimedMandatoryBeatIds`.
- StoryMemory registers mandatory IDs independently of whether the story declares any global key
  beats.
- Finalized proof is read from StoryMemory plot-advance events and
  `verifiedMandatoryBeatIds`.
- Rewrite recomputes progress from stable proof IDs and discards target/future proof.
- Outline-coverage issues use a stable beat ID in `subject`.
- Cleanup and CLI adjustment use `ruleId + subject`; occurrence `id` prefixes are never parsed.

`claimedBeats`, `verifiedBeats`, and evidence quotes may still be rendered for authors, but they do
not drive state or control flow. No compatibility mapping from those text fields is retained.

## Shared Policy Configuration

`ChapterPlanningConfig` remains the single policy object and gains:

```ts
storyActCountMin: number
storyActCountMax: number
chapterWordCountToleranceRatio: number
bookClosingPhaseRatio: number
actClosingPhaseRatio: number
maxAutoFixAttempts: number
maxStateRepairAttempts: number
rewriteStallSimilarityThreshold: number
rewriteStallMinRounds: number
actBoundaryAutoAdjustmentMaxChapters: number
actBoundaryAutoAdjustmentMaxCumulativeChapters: number
actBoundaryAutoAdjustmentMaxGlobalRatio: number
```

The existing `closingPhaseRatio` field is replaced by `bookClosingPhaseRatio`. No compatibility
alias is retained.

The existing fields below become active inputs rather than unused declarations:

- `outlineDescriptionLengthMin`;
- `outlineDescriptionLengthMax`;
- `outlineDescriptionSentenceCountMin`;
- `outlineDescriptionSentenceCountMax`;
- `maxErrorRewriteAttempts`.

Default values preserve the current intended policy where it is internally consistent:

- acts: 3 through 5;
- word-count tolerance: 10%;
- book closing phase: 15%;
- act closing phase: 20%;
- automatic fixes: 3;
- state repairs: 2;
- rewrite stall similarity: 70%;
- rewrite stall rounds: 3.
- automatic act-boundary adjustment per operation: 3 chapters;
- automatic cumulative extension per act: 3 chapters;
- automatic cumulative extension across the story: 15% of the original chapter count, with the
  per-operation allowance as the minimum usable cap.

Custom GenreSkill values override these defaults.

## Data Flow

### Story Arc and Outline

The story-arc prompt receives `storyActCountMin` and `storyActCountMax`. Numeric examples that can
bias chapter or act boundaries are replaced with symbolic placeholders.

The chapter-outline prompt receives all four outline-description constraints. These are writing
instructions only: runtime code does not split or semantically inspect description prose to count
sentences. Existing structural retry and model validation remain responsible for unusable output.

### Word Count

One helper computes:

```ts
tolerance = Math.round(bounds.max * chapterWordCountToleranceRatio)
effectiveMax = bounds.max + tolerance
```

The chapter prompt displays the configured ratio. Draft-stage validation and comprehensive
validation call the same helper with the same GenreSkill-derived config. The absolute 300-character
floor is removed.

### Closing Phases

Book-level closing logic always receives `bookClosingPhaseRatio`. Act-level pressure and blocking
logic always receives `actClosingPhaseRatio`. The two concepts remain separate and are named
accordingly.

### Retry and Reporting

Routing reads automatic-fix, state-repair, stall, and error-rewrite limits from
`ChapterPlanningConfig`. Chapter report convergence uses the same `maxErrorRewriteAttempts` value
as routing. Comments and user-visible messages interpolate configured limits rather than naming
fixed counts.

Automatic act-boundary application receives its three limits from the same planning config. It
fails closed when a proposal exceeds the available per-operation, per-act cumulative, or
whole-story cumulative allowance; it never partially applies an oversized extension.

## Error Handling

Because compatibility is explicitly out of scope:

- missing new required fields are validation errors;
- no fallback infers aliases, protagonists, issue identity, or entity references;
- no command rewrites old checkpoints;
- no special compatibility branch is added to runtime code.

The CLI may surface the existing parse/type failure when an old checkpoint is loaded. A dedicated
legacy-migration UX is not part of this change.

## Testing

Implementation follows test-driven development. Each behavior is introduced by a failing test.

Required coverage:

1. Issue fingerprints remain identical when only description, suggestion, or display location
   wording changes.
2. Issue fingerprints differ when rule ID, structured subject, attribute, or evidence indexes
   differ.
3. Character aliases are accepted only when explicitly declared and resolve to EntityIds.
4. Character output without a protagonist is rejected.
5. Chapter prompts list all explicit protagonists and never select the first array element by
   position.
6. Decorated and undecorated item subjects remain distinct.
7. State repair does not treat actual or expected prose values as entity IDs.
8. Custom act-count and outline-shape settings appear in prompts.
9. Draft and comprehensive word-count checks produce the same result at the tolerance boundary.
10. Custom book/act closing ratios and retry budgets affect their respective consumers.
11. Chapter reports use the same rewrite limit as routing.
12. Smoke guards reject description hashing, derived-name aliases, text-shape entity inference,
    and runtime item-name canonicalization.
13. Cross-character alias collisions are rejected and ambiguous aliases do not resolve.
14. Mandatory beat claims and progress ignore text-only fields and use stable mandatory IDs.
15. Rewrite keeps only stable proof before the rewrite target.
16. Outline-coverage issue replacement and removal use `ruleId + subject`, not occurrence IDs.
17. Custom automatic act-boundary limits control whether an extension is applied or requires
    manual resolution.
18. Mandatory beat registration and plot-event filtering remain active when `keyBeats` is empty.

After targeted tests pass, verification runs typecheck, lint, format check, build, smoke tests, and
the full Vitest suite.

## Acceptance Criteria

- Runtime semantic decisions do not hash or parse story/issue prose.
- Character identity and protagonist status are explicit.
- Mandatory beat state and issue lifecycle use stable IDs end to end.
- Projected state and canonical facts use exact structured subjects without name normalization.
- Every policy value named in this design has one source in `ChapterPlanningConfig`.
- Prompts and validators use the same configured limits.
- No `books/` file is changed.
- The full test suite and all static checks pass.
