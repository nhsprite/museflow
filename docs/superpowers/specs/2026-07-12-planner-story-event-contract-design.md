# Planner StoryEvent Contract Design

## Problem

`ChapterPlannerAgent` validates `expectedEvents` with the strict runtime
`StoryEvent` contract, but its prompt only names the supported event types and
shows a `character-location` example. It does not define the required subtype
fields. In particular, the model is not told that every `item-location` event
must contain both `holderId` and `locationId`, using `null` when one side does
not apply.

When the model omits `holderId`, strict validation rejects the plan. The retry
receives the validation message, but still sees the same incomplete protocol,
so it can repeat the invalid shape and exhaust the bounded two-attempt planning
loop.

## Goals

- Keep strict validation: never infer a missing semantic field.
- Give the planner a complete, neutral JSON contract for every `StoryEvent`
  variant.
- Preserve the existing bounded retry behavior.
- Keep prompts free of story-specific names, objects, locations, and genre
  assumptions.
- Prevent prompt/runtime contract drift with focused regression tests.

## Non-goals

- Do not modify any data under `books/`.
- Do not relax the runtime event contract or fill missing fields with guessed
  values.
- Do not migrate the planner to provider-specific structured-output APIs.
- Do not change chapter-generation retry limits or validation policy.

## Design

### Prompt contract

Add a reusable planner prompt fragment that renders the complete JSON shape for
all supported event variants at the authoritative zero-based chapter index.
The fragment must state these rules explicitly:

- Every event contains `id`, `type`, `chapterIndex`, and `source`.
- `source` is always `"chapter"` for planner output.
- IDs are machine-readable identifiers copied from authoritative context.
- `character-location` contains `characterId` and nullable `locationId`.
- `character-status` contains `characterId`, `attribute`, and `value`.
- `item-location` contains `itemId`, nullable `holderId`, and nullable
  `locationId`; both nullable fields must be present even when their value is
  `null`.
- `item-state` contains `itemId`, `attribute`, and `value`.
- Plot, foreshadow, and task events contain their existing typed fields.
- Missing semantic fields must not be guessed or replaced by prose.

The chapter planner prompt will embed this fragment in its structured-event
instructions and retain a compact output example. The fragment is generic and
must not include story-specific examples.

### Validation and retry flow

The existing strict `normalizeStoryEvents(..., { mode: 'strict' })` boundary
remains authoritative. Invalid planner output still returns a structured error
to the bounded retry in `runPlanChapter`. Because every attempt includes the
complete contract, the retry has enough information to correct the subtype
shape without runtime inference.

After two invalid outputs, planning still fails with the precise contract
error. No invalid plan is persisted.

## Testing

Add prompt-level tests that assert:

- All supported event variants are represented in the planner contract.
- `item-location` explicitly requires both `holderId` and `locationId`.
- The prompt instructs the model to use explicit `null` rather than omitting a
  nullable field.
- `item-state` explicitly requires `attribute` and `value`.
- The rendered chapter index remains the authoritative zero-based index.

Retain and extend agent/node tests proving that:

- An `item-location` with explicit `holderId: null` is accepted.
- An `item-location` missing `holderId` is rejected.
- A corrected second planner response succeeds.
- Two invalid responses stop with a clear error.

Run the focused planner tests, the full test suite, type checking, and build.

## Success criteria

The planner receives enough schema information to generate contract-valid
`item-location` events without guessing, while malformed output remains
strictly rejected and bounded retries cannot loop indefinitely.
