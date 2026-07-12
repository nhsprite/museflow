# Chapter Plan Event Index Normalization Design

## Problem

MuseFlow stores chapter indexes as zero-based values, while chapter numbers shown to users are one-based. The chapter planner prompt asks the model to plan a displayed chapter number, but its `expectedEvents` example uses a fixed `chapterIndex: 1` and does not provide the current internal index. The planner parser accepts any numeric event index. Downstream foreshadow scheduling validation, however, only accepts fulfillment events whose index exactly equals the current internal chapter index.

For displayed chapter 26, this allows the model to return otherwise valid fulfillment events with `chapterIndex: 26` or the example value `1`, while validation requires `25`. Retrying with the same ambiguous contract repeats the failure.

## Decision

Treat `ChapterPlan.expectedEvents` as current-chapter events by contract and normalize their `chapterIndex` at the planning boundary.

`runPlanChapter` already owns the authoritative current index and already overrides the plan-level `chapterIndex`. It will also copy every parsed expected event with `chapterIndex` set to that same authoritative value. Event IDs, types, entity IDs, foreshadow IDs, and all other semantic fields remain unchanged.

The chapter planner prompt will additionally:

- state that every expected event belongs to the current chapter;
- provide the exact zero-based internal index;
- use that actual index in the JSON output example instead of a fixed literal.

Runtime normalization is authoritative. Prompt clarification improves model output but is not relied upon for correctness.

## Alternatives Considered

### Prompt-only correction

This is smaller but still delegates a mechanical indexing invariant to a probabilistic model. It does not prevent recurrence when a provider ignores or misreads the instruction.

### Reject and retry mismatched indexes

This preserves model output verbatim but spends additional model calls on a value already known by the runtime. The same ambiguous or ignored instruction can fail repeatedly.

### Normalize only foreshadow events

This would solve the observed symptom but leave the same index defect in character, item, plot, and task events. Normalizing all planned events follows the existing definition that `expectedEvents` records changes planned for this chapter.

## Data Flow

1. `ChapterPlannerAgent` receives the zero-based `chapterIndex` in structured input.
2. Its prompt renders both the one-based display number and exact internal index.
3. The model returns a chapter plan.
4. `ChapterPlannerAgent.parse` performs shape validation and preserves valid structured events.
5. `runPlanChapter` stamps the plan and every expected event with the authoritative current index.
6. Foreshadow scheduling validation checks exact IDs and the normalized current index.

No prose inspection, keyword matching, or story-specific behavior is introduced.

## Compatibility

- Existing plans without story memory retain current behavior.
- Existing event fields other than `chapterIndex` are preserved.
- No checkpoint, metadata, or `books/` migration is required.
- Events intentionally targeting other chapters are not supported by `ChapterPlan.expectedEvents`; such behavior would contradict the existing prompt contract that these are events produced by the current chapter.

## Error Handling

The existing scheduled-foreshadow evidence validation remains unchanged. It still rejects plans that genuinely omit a required `foreshadow-fulfill` event or use the wrong foreshadow ID. Index normalization only removes disagreement about a mechanical field whose correct value is already known.

## Testing

Add regression coverage that:

1. invokes planning for internal chapter index 25;
2. supplies a model plan containing a fulfillment event with one-based `chapterIndex: 26`;
3. verifies the returned plan and all expected events use `chapterIndex: 25`;
4. verifies unrelated event fields are unchanged;
5. verifies the rendered planner prompt contains the exact internal index and no fixed index example;
6. keeps existing missing-event tests passing, proving normalization does not synthesize absent fulfillment events.

Run the focused planner and outline-expander tests, then the full test suite and TypeScript type check.
