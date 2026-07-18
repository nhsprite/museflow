# Runtime Character Normalization Design

## Goal

Prevent checkpoint-backed stories from crashing when their character records predate required
structured fields such as `aliases` and `isProtagonist`.

## Root Cause

The Character contract now requires an explicit alias array and protagonist flag. Character
creation validates and persists those fields for new stories, but existing checkpoints may contain
records created before the contract changed.

Checkpoint loading currently normalizes StoryMemory only. It then casts the deserialized JSON to
`ReducedGraphState`, so a character without `aliases` crosses the typed boundary unchanged.
`prepareStoryStateForChapter` passes those characters to `sanitizeStoryState`, which calls
`buildCharacterWhitelist`. The whitelist iterates `character.aliases` and throws because the
runtime value is undefined.

## Design

### Normalize at the shared runtime boundary

Add a character normalizer that receives a checkpoint-backed `ReducedGraphState` and returns the
same state when every character already satisfies the current structural defaults. When a character
does not satisfy them, return a new state with a new character array and normalized records.

For each character:

- preserve `aliases` only when it is an array containing only strings; otherwise use `[]`;
- preserve `isProtagonist` only when it is a boolean; otherwise use `false`;
- preserve every other field unchanged;
- never derive aliases from a name or other prose.

Compose character normalization with the existing StoryMemory normalization in a shared
`normalizeRuntimeState` entry point. Both normal chapter execution and `getState` use this entry
point for latest and historical checkpoint snapshots.

### Keep consumers strict

`buildCharacterWhitelist` continues to accept the current `Character` contract and may iterate
`aliases` directly. It should not become a second compatibility boundary. This keeps invalid JSON
handling centralized and prevents different consumers from applying different defaults.

### Do not persist normalization

Normalization is an in-memory projection. It does not update checkpoint files, `meta.json`, or any
other file under `books/`. A later normal chapter commit may persist the already-normalized runtime
state through the existing graph flow, but the normalizer itself performs no writes.

## Data Flow

1. The runner loads a latest or chapter-marker checkpoint.
2. `normalizeRuntimeState` applies character structural defaults.
3. Existing StoryMemory normalization and deadline correction run on the normalized state.
4. Rewrite cleanup and the graph receive a valid `ReducedGraphState`.
5. Reconciler sanitization can build the character whitelist without special-case handling.

## Error Handling

The normalizer fails closed for malformed optional contract fields:

- a non-array alias value becomes an empty array;
- an alias array containing a non-string value becomes an empty array;
- a non-boolean protagonist value becomes `false`.

It does not repair missing identity fields such as `id` or `name`; those are required for character
identity and are outside this bug's scope.

## Neutrality

The fix uses only field presence, primitive types, and arrays. It contains no story names,
genre-specific rules, prose matching, inferred abbreviations, or semantic alias generation.

## Compatibility

No explicit checkpoint migration is added. Existing checkpoint JSON remains unchanged. New stories
already satisfy the Character contract and pass through without allocation or semantic changes.

## Tests

Tests are written before production code and demonstrate that:

- a checkpoint-backed character missing both new fields receives `aliases: []` and
  `isProtagonist: false`;
- malformed alias and protagonist values receive the same safe defaults;
- valid aliases and protagonist values are preserved;
- normalization does not mutate the input state or valid character records;
- the normalized characters can pass through `buildCharacterWhitelist` without throwing;
- StoryMemory normalization behavior remains unchanged;
- typecheck, full tests, lint, formatting, and build remain green.

