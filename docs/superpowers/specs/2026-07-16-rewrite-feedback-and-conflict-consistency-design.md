# Rewrite Feedback and Conflict Consistency Design

Date: 2026-07-16

## Goal

Fix two related rewrite failures without changing story data or introducing story-specific rules:

1. Targeted rewrites must retain relevant validation feedback.
2. Outline reconciliation must not turn transient state snapshots or retired facts into permanent blocking constraints, and its validators must apply one consistent severity policy.

The implementation must remain compatible with existing checkpoints.

## Targeted Rewrite Feedback

The CLI will select feedback by target chapter using structured runtime context:

- An ordinary `rewrite <story-id>` keeps its current behavior and passes all current `pendingIssues` to the rewrite runner.
- `rewrite <story-id> -c N` passes current `pendingIssues` when `N - 1` equals `state.currentChapterIndex`, because those issues describe the current failed chapter.
- A targeted rewrite of another chapter does not inherit current-chapter feedback. It restores feedback from the selected checkpoint through the runner's existing fallback behavior.

The selection must not parse `Issue.location` or any other natural-language field.

## Canonical Fact Eligibility

The canonical-fact outline check will receive only active facts (`retiredIn === undefined`). Retired facts remain available for history and reporting but cannot constrain a new outline.

The second canonical-fact pass will only enforce facts that can represent durable constraints:

- Active `author_override` facts remain eligible regardless of attribute because they are explicit author decisions.
- Ordinary `location`, `status`, and `holder` facts are transition snapshots. They are handled by the existing state-transition reconciler and are excluded from duplicate hard-constraint detection.
- Other active canonical attributes remain eligible for semantic constraint detection.

This rule is based only on structured attribute and source enums. It does not inspect prose.

## Shared Conflict Severity Policy

A single helper will normalize outline conflict severity at both state-reconciliation boundaries:

- Transition snapshots (`location`, `status`, `holder`) cannot be promoted to `blocking` merely because their value changes in a new outline.
- Explicit active author overrides can remain blocking.
- Durable canonical attributes can retain a model-proposed blocking severity.
- The helper operates on structured conflict/fact fields only.

The existing state-transition reconciler remains responsible for detecting and recording ordinary location/status changes. The canonical-fact pass must not reclassify the same transition as an immutable contradiction.

## Cross-Validator Revision Context

When a blocking conflict produces an outline revision proposal, the proposal prompt will also receive the structured context necessary to preserve the chapter contract:

- current item locations and item states;
- the chapter's claimed mandatory foreshadow fulfillment IDs;
- the corresponding planted text, resolution question, and fulfillment criteria when present.

The proposal remains advisory. If adopted, it still passes through the existing outline expansion, foreshadow planning verifier, state reconciliation, and chapter validation pipeline. No proposal directly mutates StoryMemory or marks a foreshadow fulfilled.

## Compatibility

- No checkpoint migration is required.
- No new required fields are added to persisted story data.
- Legacy canonical facts are interpreted using their existing `attribute`, `source`, and `retiredIn` fields.
- No files under `books/` are edited.

## Tests

Add regression coverage for:

1. `rewrite -c <current>` forwards current pending issues.
2. `rewrite -c <historical>` does not forward unrelated current issues.
3. Retired canonical facts are absent from outline-conflict prompts.
4. Ordinary active status/location/holder snapshots cannot become blocking in the duplicate canonical pass.
5. Active author overrides remain eligible to block.
6. Revision proposals receive item state and mandatory foreshadow context.
7. Existing rewrite, reconciliation, semantic foreshadow, typecheck, lint, build, and smoke tests continue to pass.

## Non-Goals

- Editing or repairing generated story files.
- Waiving required foreshadows.
- Adding story-specific names, phrases, or semantic matching.
- Redesigning the entire canonical-fact schema or migrating existing checkpoints to a temporal fact model.
