# Foreshadow Capacity Scheduling Design

Date: 2026-07-11

## Problem

MuseFlow closes a foreshadow only when StoryMemory receives a structured
`foreshadow-fulfill` event with the exact `foreshadowId`. Existing generation
flows do not reliably schedule those IDs on or before their explicit
`expectedFulfillChapter`. The act-boundary validator therefore accumulates old
required foreshadows and can require a single boundary chapter to fulfill an
unbounded backlog.

For the reported story, chapter 26 has eleven required, unresolved foreshadows
whose explicit deadlines fall between chapters 5 and 18. The JIT outline agent
returns valid JSON, but cannot include every required ID in an executable
30–60-character outline. After three silent retries, the caller reports the
misleading error “未返回可执行大纲”.

The fix must preserve the explicit deadline semantics introduced by the prior
boundary correction, remain story- and genre-neutral, avoid prose matching for
control flow, and update runtime story data only through normal checkpointed
CLI execution.

## Goals

- Schedule explicit, due required foreshadows before they accumulate at an act
  boundary.
- Bound the number of foreshadows assigned to one chapter using genre
  configuration.
- Automatically extend the current act when its remaining chapter capacity is
  insufficient for the structured due backlog.
- Carry exact IDs through outline, plan, expected events, draft events, and
  StoryMemory projection.
- Give SummaryAgent the exact IDs planned for the chapter so it can provide a
  structured fallback when the draft omits an event.
- Report exact missing IDs when a model response cannot satisfy the selected
  obligations.
- Keep ordinary act-boundary finalization strict: an act cannot close while a
  required foreshadow with an explicit deadline at or before that boundary is
  unresolved.

## Non-goals

- Do not inspect story prose with keyword, regex, fuzzy, or similarity matching
  to decide whether a foreshadow was fulfilled.
- Do not hand-edit or migrate files under `books/`.
- Do not reinterpret `beatId` or beat descriptions as foreshadow deadlines.
- Do not automatically mark a foreshadow fulfilled merely because it was
  scheduled.
- Do not redesign the complete StoryMemory event model.

## Configuration

Add `foreshadowMaxFulfillmentsPerChapter` to `ChapterPlanningConfig`.

- Default: `3`.
- Genre skills may override it through their existing `chapterPlanning`
  configuration.
- Values used by scheduling must be normalized to a positive integer.

The limit applies only to required unresolved foreshadows selected for active
fulfillment. Optional, already fulfilled, invalid-deadline, and unscheduled
foreshadows do not consume this capacity.

## Structured Scheduling Policy

Introduce a shared policy function that returns required unresolved
foreshadows due by a 1-based chapter number. It must use only typed fields:

- `required === true`
- `fulfilledIn === null`
- a valid, finite `expectedFulfillChapter`
- `expectedFulfillChapter <= chapterNumber`

Sort candidates deterministically by:

1. `expectedFulfillChapter` ascending
2. `introducedIn` ascending
3. `id` ascending

The per-chapter scheduler selects the first
`foreshadowMaxFulfillmentsPerChapter` IDs. This selection runs for every
chapter, not only act boundaries and story end.

`getBoundaryBlockingForeshadows` remains an uncapped boundary invariant. It
continues to return every due required unresolved ID at an ordinary act
boundary, and every required unresolved ID at story end.

## Capacity-aware Act Extension

Before generating a JIT outline, calculate the current act's available chapter
capacity, including the current chapter. For the due backlog:

```
requiredChapterCount = ceil(dueCount / perChapterCapacity)
availableChapterCount = currentAct.endChapter - currentChapterNumber + 1
requiredExtension = max(0, requiredChapterCount - availableChapterCount)
```

Calculate the existing mandatory-beat extension independently. If both beats
and foreshadows need additional chapters, use the greater extension rather than
adding the two values. The two systems have independent per-chapter budgets and
may progress in the same chapter.

Apply the resulting proposal through the existing
`applyActBoundaryAdjustment` path so later act boundaries, `totalChapters`, the
outline scaffold, chapter scaffold, story metadata, and checkpoint state move
together. If automatic adjustment cannot be applied, stop before model calls
with the precise reason and the existing `adjust-act` command.

For the reported state, eleven due foreshadows at capacity three require four
chapters. Chapter 26 supplies one existing slot, so act 2 extends by three
chapters, from chapter 26 to chapter 29. Later acts and total chapters shift by
three, from 50 to 53.

## Generation Data Flow

For each chapter, the selected exact IDs flow through these layers:

1. JIT outline constraints list the selected IDs, deadlines, and display text.
2. `fulfilledForeshadowIds` in the outline must contain every selected ID.
3. Chapter planning must contain every selected ID in both
   `fulfilledForeshadowIds` and a corresponding `foreshadow-fulfill`
   `expectedEvents` entry.
4. The chapter writer receives the plan and emits evidence-backed
   `foreshadow-fulfill` events in its structured story-events block.
5. Finalization applies only validated events; scheduling alone never mutates
   `fulfilledIn`.
6. SummaryAgent receives the exact selected IDs and descriptions as a fallback
   event-extraction context. It may emit a missing fulfillment event only with
   paragraph evidence from the completed chapter.

The constraint text may render foreshadow descriptions for the model, but all
runtime selection, comparison, validation, and routing use exact IDs and typed
fields.

## Retry and Error Handling

When an outline or plan omits selected IDs:

- Log the attempt number and exact missing IDs.
- Retry with a structured correction constraint.
- Validate both `fulfilledForeshadowIds` and plan `expectedEvents`.
- After retry exhaustion, throw an error that names the missing IDs and the
  configured per-chapter capacity.

Do not reuse “未返回可执行大纲” for this case. That message remains appropriate
only when no candidate outline was produced for a reason unrelated to explicit
foreshadow obligations.

## Checkpoint and Rewrite Behavior

The rewrite command continues to start from the chapter marker checkpoint and
clean downstream state through existing code. Act extension and subsequent
fulfillment events are persisted only when the normal graph/checkpoint commit
path succeeds. A failed model attempt must not directly modify StoryMemory or
files under `books/`.

## Testing

Add focused tests for:

- deterministic due-foreshadow ordering and capacity selection;
- exclusion of optional, fulfilled, invalid-deadline, future, and unscheduled
  foreshadows;
- eleven due IDs at capacity three producing a three-chapter extension when
  only the current boundary chapter remains;
- taking the maximum, rather than the sum, of beat and foreshadow extension;
- per-chapter scheduling outside an act boundary;
- JIT outline retries that report exact missing IDs;
- chapter-plan validation requiring both selected IDs and fulfillment events;
- SummaryAgent prompt context containing only the exact planned fulfillment
  IDs;
- strict uncapped boundary validation after the scheduled batches complete;
- regression coverage showing the reported eleven-ID state no longer asks one
  outline to fulfill the entire backlog.

Run the focused Vitest suites during red-green cycles, followed by the complete
test suite, type check, build, formatting check, and the no-prose-matching smoke
test.

## Success Criteria

- Rewriting chapter 26 with the reported structured state first extends act 2
  to chapter 29 and schedules at most three due IDs for chapter 26.
- The JIT outline is not rejected for omitting any of the other eight IDs,
  because they are assigned to later capacity slots.
- Later chapters continue draining the backlog in deterministic batches.
- Act 2 cannot finalize at its new boundary while a due required ID remains
  unresolved.
- No production control flow depends on story-specific text or prose matching.
- No direct `books/` changes are part of the code change.
