# Continuous Write Command Design

## Goal

Allow authors to write several consecutive chapters from one CLI invocation while preserving the
existing single-chapter validation and commit boundary.

## Command Surface

```bash
museflow write <story-id>
museflow write <story-id> -n 5
museflow write <story-id> --count 5
```

- Omitting `--count` keeps the current behavior and writes at most one chapter.
- `--count` must be a positive integer.
- `rewrite -c, --chapter` remains unchanged and continues to select the chapter to rewrite.
- A requested count larger than the number of remaining chapters writes only through the end of
  the story.

## Architecture

The CLI command owns the multi-chapter loop. Each iteration calls the existing one-chapter writing
workflow without widening the graph transaction or chapter commit boundary.

After a chapter completes, the command reloads the latest persisted story and checkpoint state
before deciding whether to start the next chapter. This ensures the next iteration consumes the
committed chapter marker, regenerated projections, updated act progress, foreshadow state, and
pending issues rather than an in-memory approximation.

The existing `write` behavior remains the single source of truth for preparing, generating,
validating, committing, reporting, and freezing a chapter. Continuous mode coordinates repeated
invocations of that behavior; it does not duplicate chapter-generation logic.

## Stop Conditions

Continuous writing stops immediately when any of the following is true:

1. The requested number of chapters has completed.
2. The story reaches its final chapter and becomes frozen.
3. The latest state requests a rewrite or contains a blocking error.
4. The workflow requires an author decision.
5. A model call or chapter workflow throws an error.
6. A chapter run makes no forward progress, preventing an accidental infinite loop.

Stopping does not roll back chapters already committed successfully.

## Output

Every completed chapter keeps the existing full chapter report. After the loop ends, continuous
mode prints one summary containing:

- requested chapter count;
- successfully completed chapter count;
- the reason the loop stopped.

The default single-chapter command keeps its current output and does not add a redundant batch
summary.

## Error Handling

- Invalid counts fail before model execution with a clear positive-integer validation message.
- Expected chapter-level blockers stop the loop after the existing diagnostic output is shown.
- Unexpected exceptions use the existing command error handler and stop the loop.
- The command never skips a blocked chapter to continue with later chapters.
- Previously committed chapters remain committed when a later iteration fails.

## Compatibility

- No checkpoint, StoryMemory, story-state, or metadata schema changes are required.
- Existing scripts invoking `museflow write <story-id>` continue to write exactly one chapter.
- The implementation does not change `continue`, `rewrite`, or their flags.
- The feature is story-, genre-, provider-, and language-neutral.

## Test Strategy

CLI tests will cover:

1. Default `write` still invokes the chapter workflow once.
2. `write --count N` completes N successful iterations.
3. Each new iteration reloads persisted state.
4. The loop stops on rewrite requests or blocking issues.
5. The loop stops at the final chapter even when `N` is larger.
6. The loop detects a no-progress result and stops.
7. Zero, negative, fractional, and non-numeric counts are rejected before generation.
8. `-n` and `--count` map to the same option.
9. Existing final-chapter report and freeze behavior remains intact.

The full test suite, type check, lint, build, and formatting checks must pass before completion.
