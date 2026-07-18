# Remove Story Freeze Design

## Goal

Remove the persisted `freeze` story status and every write or rewrite lock derived from it.
Completion remains a computed narrative audit, while the planned chapter count remains the boundary
for adding new chapters.

## Scope

This change removes:

- `freeze` from `StoryStatus`;
- the story-freeze and story-guard utilities;
- automatic transitions to `freeze`;
- frozen-story CLI messages;
- tests and fixtures that treat `freeze` as a valid status or an immutable-story marker.

This change retains:

- the shared `evaluateStoryCompletion` audit;
- the planned `totalChapters` boundary;
- the rule that `write` and `continue` do not create chapter `totalChapters + 1`;
- the ability to rewrite any existing chapter, including the final chapter;
- the existing `done` status as an unrelated, non-locking status value.

## Runtime Behavior

### Completion is derived, not persisted

Commands and status formatting call `evaluateStoryCompletion` when they need to report whether the
story is complete. A successful chapter command keeps or restores the ordinary `writing` runtime
status; completing the final chapter does not persist a special completion status. Rewriting a
completed story therefore cannot leave a stale completion marker in its checkpoint or metadata
projection.

### Planned chapter boundary

`write` and `continue` check the computed completion result before invoking the chapter graph. When
the story is complete, they report completion and return without generating another chapter. This
is a planning boundary, not a status-based lock.

When the planned chapter boundary has been reached but the completion audit is blocked, the commands
continue to direct the author to rewrite the final chapter. They do not generate an unplanned extra
chapter.

### Rewriting completed stories

`rewrite --chapter N` remains available for every existing chapter from `1` through
`totalChapters`, regardless of the completion audit.

For a completed story, plain `rewrite` targets the last completed chapter rather than the
non-existent next chapter. After rewriting, MuseFlow reports the newly computed completion result
without persisting `freeze`.

### CLI status and messages

Status output continues to distinguish:

- a story that passed the completion audit;
- a story still within its planned chapter range;
- a story at the planned boundary with unresolved completion obligations.

All frozen-state wording is removed. Completion messages describe the audit result and suggest
export or rewrite actions without saying the story is immutable.

## Data Flow

1. A command loads the checkpoint-backed state.
2. `evaluateStoryCompletion` derives the current completion result.
3. `write` and `continue` use that result and `totalChapters` to decide whether a new planned chapter
   exists.
4. `rewrite` selects an existing chapter independently of completion status.
5. Successful chapter commands persist the normal mutable `writing` status and never emit
   `freeze`.

No second completion predicate or prose-based semantic check is introduced.

## Error Handling

Existing chapter-generation, rewrite, and completion-audit errors retain their current routing.
Removing freeze does not bypass pending error issues or the completion gate. A blocked final chapter
still requires rewrite or author resolution.

## Compatibility

No migration or compatibility path is provided for legacy checkpoints or metadata containing
`status: "freeze"`. Runtime story data under `books/` is not edited directly.

## Tests

Tests are changed before production code and must demonstrate that:

- `freeze` is no longer a valid `StoryStatus`;
- completing the final chapter never writes `freeze`;
- `write` and `continue` at a completed boundary do not invoke the chapter graph or persist a
  terminal status;
- a completed story can explicitly rewrite its final chapter;
- plain `rewrite` at the completed boundary selects the last completed chapter;
- a blocked story at the chapter boundary remains rewritable;
- CLI output contains completion or blocked-boundary wording and no frozen-state wording;
- the full typecheck, unit test, lint, formatting, and build suites remain green.
