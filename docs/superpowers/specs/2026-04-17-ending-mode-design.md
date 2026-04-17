# MuseFlow Ending Mode Design

> Date: 2026-04-17
> Status: Proposed
> Scope: Late-book foreshadow resolution and ending guidance

## 1. Problem

MuseFlow currently treats late chapters too much like middle-book chapters. That creates a structural risk: the model may keep expanding the story instead of converging it. In practice, the final portion of a book should shift from exploration to resolution.

The system needs an explicit endgame mode that tells the chapter-writing pipeline when to stop introducing major new material, begin resolving accumulated foreshadowing, and move the story toward a satisfying ending.

## 2. Goals

- Detect when a story has entered its late-book phase.
- Change chapter-generation behavior once that phase begins.
- Prioritize unresolved foreshadowing, major conflicts, and core character arcs.
- Reduce the chance that late chapters introduce new major settings, characters, or plotlines.
- Make the final chapter feel intentionally concluding rather than just "the next chapter."

## 3. Non-Goals

- Do not add a full story-analysis subsystem that semantically understands all plot threads.
- Do not require a human to manually tag every foreshadowing item.
- Do not force every foreshadowing item to be resolved if the story intentionally leaves minor atmosphere or sequel hooks.
- Do not move export into the graph runtime. Export remains a separate post-completion surface.

## 4. Approaches Considered

### Approach A: Fixed Percentage Trigger

Enter ending mode automatically when the current chapter reaches the final percentage of the book, for example the last 20%.

**Pros**
- Simple and predictable.
- Easy to reason about in prompts and tests.
- Works for every story without requiring extra analysis.

**Cons**
- Can trigger too early for slow-burn stories.
- Can trigger too late if earlier chapters introduced too many unresolved threads.

### Approach B: Fixed Remaining Chapter Count

Enter ending mode when only a fixed number of chapters remain, for example the last 3 to 5 chapters.

**Pros**
- Intuitive for users.
- Makes the "final stretch" concrete.

**Cons**
- Scales poorly across very different story lengths.
- Too blunt for short books vs long books.

### Approach C: Hybrid Trigger (Recommended)

Use a predictable percentage-based gate as the default trigger, then strengthen or soften ending guidance based on story state, especially unresolved foreshadowing and remaining chapter budget.

**Pros**
- Predictable enough to test.
- Adaptive enough to match story state.
- Keeps implementation complexity moderate.

**Cons**
- Slightly more state and prompt logic than a pure threshold.

## 5. Recommended Design

MuseFlow should adopt a hybrid ending-mode design.

The system enters a late-book phase once the story reaches a configurable endgame threshold, with `last 20% of chapters` as the default behavior. Once that threshold is crossed, chapter generation should no longer behave like ordinary middle-book generation. Instead, prompts should explicitly instruct the model to start converging the story.

That convergence should focus on four priorities:

1. resolve previously planted foreshadowing where appropriate,
2. close or decisively advance the primary conflict,
3. complete the most important character-arc turns,
4. avoid introducing new major unresolved material.

The prompt intensity should increase as the story approaches the final chapter. Early ending-mode chapters can still balance progression and resolution. The final chapter should prioritize closure, payoff, and emotional aftermath.

## 6. Runtime Behavior

### 6.1 Story Phases

The runtime should distinguish at least three writing phases:

- `planning` — world, characters, and outline generation.
- `middle` — ordinary chapter drafting behavior.
- `ending` — late-book convergence behavior.

This phase distinction should be explicit in runtime state rather than inferred ad hoc inside prompt strings.

### 6.2 Trigger Rules

Ending mode should activate when both of the following are evaluated:

1. **Base trigger**: the current chapter index has entered the final segment of the book, defaulting to the last 20%.
2. **Story-state context**: unresolved foreshadowing count and remaining chapters are passed into the prompt so the model understands how aggressively it must converge.

The base trigger determines whether ending mode is active. Story-state context determines how strong the ending instructions should be.

### 6.3 Prompt Contract In Ending Mode

When ending mode is active, the chapter-writing prompt should explicitly instruct the model to:

- prefer payoff over expansion,
- resolve or pay off existing foreshadowing when possible,
- advance the central conflict toward conclusion,
- avoid adding new major named characters, factions, mysteries, or power systems unless strictly necessary,
- minimize creation of new unresolved threads,
- preserve a coherent path to the final chapter.

When the chapter is the final one, the prompt should additionally require:

- closure of the main conflict,
- visible consequences for the major characters,
- payoff for the most important foreshadowing or setup,
- a stable ending state for the story world,
- optional light aftertaste or sequel space only if the core narrative is already complete.

## 7. State And Data Requirements

The graph state should expose enough information for ending-mode prompts to be intentional rather than generic. At minimum, the runtime should be able to provide:

- current chapter index,
- total chapters,
- remaining chapter count,
- whether ending mode is active,
- unresolved foreshadowing items from `foreshadowStack`,
- chapter summaries accumulated so far.

If the system later needs more nuance, it can add an ending-guidance summary layer, but that is not required for the first version.

## 8. Node Responsibilities

### `draft_chapter`

This node should become phase-aware. It should assemble chapter prompts differently for middle-book chapters and ending-mode chapters.

### `detect_foreshadowing`

This node should continue maintaining the foreshadow stack, but ending-mode prompting should treat that stack as a payoff backlog rather than only a passive memory structure.

### `finalize_chapter`

This node remains chapter-level bookkeeping, but it becomes more important because it determines the transition into the ending phase by maintaining chapter progression and summaries.

### `finalize_story`

This node remains book-level completion. Ending mode should drive the story toward a coherent final chapter before `finalize_story` runs; `finalize_story` should not be asked to invent closure after the fact.

## 9. Failure Handling Expectations

Ending mode should reduce failure cases where the final stretch drifts, but it does not eliminate them. The system should still allow review agents to flag:

- major unresolved contradictions,
- new late-stage expansion that undermines closure,
- missing payoff for high-priority setup,
- endings that stop abruptly without resolving the core conflict.

If those issues are found, the rewrite flow should work the same way it does for other chapters, with the added context that the system is already in ending mode.

## 10. Testing Expectations

This design implies future tests at three levels:

- **unit**: phase calculation and ending-mode prompt assembly,
- **integration**: chapter-loop behavior once the threshold is crossed,
- **e2e**: a full story where the final stretch resolves prior setup instead of expanding indefinitely.

The first implementation does not need a semantic quality oracle for "good endings," but it must at least verify that ending-mode instructions are injected at the correct time and that final-chapter instructions differ from ordinary chapter instructions.

## 11. Open Design Choices Locked For V1

To keep the first version concrete, this design fixes the following defaults:

- Ending mode begins in the last 20% of chapters.
- The trigger is hybrid: fixed threshold for activation, dynamic context for prompt strength.
- The primary mechanism is prompt steering, not a separate planner node.
- `foreshadowStack` is the main structured signal for unresolved setup in V1.

## 12. Summary

The key change is not "make the last chapter better." It is to explicitly change the system's writing behavior in the final portion of the book. MuseFlow should know when the story has entered its convergence phase, expose that fact in runtime state, and use it to tell the LLM to resolve setup, close major arcs, and finish with intention.
