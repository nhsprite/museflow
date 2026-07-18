# Authoritative Story Event ID Validation Design

## Problem

MuseFlow currently applies two incompatible identifier policies to planned story events:

- `normalizeStoryEvent` accepts any machine-readable identifier matching the structured event
  contract.
- `parseStoryEventsBlock` later rejects every entity identifier shaped like a lowercase prefix plus
  a numeric suffix, assuming it was copied from a prompt example.

An identifier can therefore be accepted into `chapterPlan.expectedEvents`, rendered as a mandatory
event, copied correctly by the chapter writer, and then discarded by the parser. Structured
validation reports the event as missing, while every rewrite receives the same impossible
requirement and eventually triggers rewrite-loop stall detection.

The failure is not specific to one story. The invariant violation is that a structured identifier
accepted as authoritative upstream can be rejected downstream solely because of its spelling.

## Goals

- Make planned-event authority the source of truth for identifier acceptance.
- Accept any identifier already established by structured runtime state, regardless of its shape.
- Reject model-invented references before drafting, where the planner can be retried.
- Preserve strict structured validation for unexpected or unsupported draft events.
- Remove prompt examples that encourage copying synthetic identifiers.
- Keep all behavior story- and genre-neutral.

## Non-Goals

- Do not edit or migrate files under `books/`.
- Do not infer entity identity from prose, descriptions, names, or fuzzy matching.
- Do not weaken the public `StoryEvent` type or its machine-readable format contract.
- Do not create aliases between identifiers.
- Do not add compatibility branches keyed to a story ID or a particular identifier.

## Authority Model

The runtime derives typed identifier authority from structured state only.

### Characters

Known character identifiers include:

- `state.characters[].id`;
- StoryMemory character entity keys;
- StoryState character location and status keys;
- character identifiers already referenced by accepted StoryMemory events.

### Items

Known item identifiers include:

- StoryMemory item entity keys;
- StoryState item location and item state keys;
- item identifiers already referenced by accepted StoryMemory events.

### Locations

Known location identifiers include:

- StoryMemory location entity keys;
- current `locationId` values on StoryMemory character and item entities;
- non-null location identifiers in accepted StoryMemory events;
- structured StoryState character and item location values when they satisfy the machine-ID
  contract.

### Plots and Beats

Known plot and beat identifiers include:

- StoryMemory plot and beat entity keys;
- stable act and key-beat identifiers provided by the story arc;
- identifiers already referenced by accepted StoryMemory plot events.

### Foreshadows and Tasks

Known identifiers include:

- StoryMemory foreshadow and task keys;
- projected foreshadow stack identifiers;
- structured pending-task identifiers;
- identifiers already referenced by accepted StoryMemory events.

No natural-language field participates in authority collection.

## Planned Event Validation

A focused validator checks every `chapterPlan.expectedEvents` reference against the typed authority
sets:

- `character-location` and `character-status` require a known character.
- A non-null character `locationId` requires a known location.
- `item-location` and `item-state` require a known item.
- A non-null item `holderId` requires a known character or item.
- A non-null item `locationId` requires a known location, character, or item because the current
  contract permits canonical containment and carried-item locations.
- `plot-advance` requires known plot and beat identifiers.
- `foreshadow-fulfill` requires a known foreshadow.
- `task-resolve` requires a known task.
- Introduction and creation events may use new identifiers because creating that entity is their
  purpose. Their identifiers must still satisfy the existing event contract.

Event record IDs are not entity references and remain governed by the existing machine-ID contract.

## Planner Retry Boundary

`runPlanChapter` is the single planning boundary used by initial JIT planning and corrective
replanning. After the model output passes structural parsing, planned-event authority validation
runs before the output becomes a `ChapterPlan`.

If validation fails:

1. The attempt is treated as a planning failure.
2. The retry prompt receives a structured planning issue naming the invalid event index, event
   type, field, and rejected identifier.
3. The planner retries within its existing bounded attempt count.
4. If all attempts fail, chapter planning aborts with a planning error instead of drafting an
   impossible event contract.

This moves recovery to the component that created the invalid reference.

## Draft Parsing and Validation

The parser continues to enforce:

- section delimiters and event line grammar;
- machine-readable identifier syntax;
- required fields and nullable-field syntax;
- evidence markers.

It stops rejecting identifiers based only on prefix-and-number shape. The same rule is removed from
`STORY_FINAL_STATE` parsing.

Safety remains fail-closed:

- Draft events are compared structurally against `chapterPlan.expectedEvents`.
- Unplanned draft events become `structured.event-unexpected` errors.
- Missing planned events remain errors.
- Final-state declarations must be corroborated by accepted chapter events.
- An invalid planned reference never reaches drafting because of the planner authority gate.

## Prompt Changes

The chapter planner already receives a complete event JSON contract. Its separate output example
must not contain copyable synthetic event identifiers. The root `expectedEvents` example becomes an
empty array with an instruction to populate it according to the contract.

This removes conflicting guidance without adding story-specific examples.

## Testing

### Parser regression

- A machine-readable short identifier is parsed even when its shape resembles an old prompt
  placeholder.
- Malformed machine identifiers remain rejected.
- Final-state declarations follow the same shape-neutral rule.

### Authority validation

- A short location identifier established by structured state is accepted.
- An unknown character or location reference is rejected.
- Known identifiers with ordinary slug forms remain accepted.
- Creation events may introduce new identifiers.
- Validation does not inspect prose fields.

### Planning integration

- The first planner response with an unauthorized reference is rejected and the second valid
  response is accepted.
- Two unauthorized responses abort planning before a chapter writer can run.
- A plan using an authoritative short location identifier reaches `chapterPlan`.

### Full regression

- Story-memory parser, planner-node, chapter-agent, rewrite-flow, smoke, and complete test suites
  pass.
- The no-prose-matching smoke guard remains green.

## Data Integrity

The implementation changes runtime validation only. It does not edit checkpoints, reports,
chapters, or projections. A subsequent user-initiated rewrite naturally produces new runtime state
through the normal checkpoint commit path.
