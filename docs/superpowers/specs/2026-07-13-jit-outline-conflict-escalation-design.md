# JIT Outline Conflict Escalation Design

## Problem

Chapter outline reconciliation currently treats every exhausted blocking conflict the same. A chapter whose outline was generated only for the current invocation can therefore trigger the same author-decision UI as a persisted outline, even though discarding that temporary candidate and generating a new one is safe.

The current flow also attaches the latest model-generated revision proposal to `BlockingConflictError` before that proposal has passed the same canonical-state validation. This can show the author a suggestion that contains another blocking conflict.

## Goals

- Keep transient JIT generation failures inside the current write invocation whenever bounded retries can recover.
- Reserve author decisions for persisted intent or a stable conflict that survives independent JIT generations.
- Never show an outline revision proposal as adoptable until it passes the normal blocking-conflict validator.
- Preserve the authority hierarchy and the existing ability to choose an outline retcon deliberately.
- Base routing only on structured provenance and structured conflict fields, never prose matching.

## Non-goals

- Do not weaken canonical-state validation.
- Do not silently overwrite a persisted outline.
- Do not infer state corruption from a natural-language conflict description.
- Do not add story-specific or genre-specific rules.
- Do not change `books/` data directly.
- Do not route ordinary outline conflicts into the post-draft `repair_state` node. A conflict between two claims does not by itself prove that canonical state is corrupt; existing structured state-corruption issue routing remains unchanged.

## Candidate Provenance

`expandOutlineForChapter` records whether the target outline had a non-empty description at function entry.

- `persisted`: the description already existed at entry. It represents stored planning intent and is not automatically replaced by an independent candidate.
- `jit`: the description was empty at entry and was generated during this invocation. It is disposable until the chapter run succeeds and commits.

This provenance is runtime-local. It does not require a storage migration or a new field in `meta.json`.

## Recommended Flow

### Persisted outline

1. Validate the existing outline against canonical state.
2. If it passes, continue planning.
3. If it has blocking conflicts, generate one minimal revision proposal.
4. Validate the proposal with the same reconciliation path, with nested proposal generation disabled.
5. Throw `BlockingConflictError` for author resolution:
   - attach the proposal only when validation passed;
   - otherwise omit the proposal and expose only the structured conflicts.

The system must not silently apply the proposal to a persisted outline.

### Temporary JIT outline

1. Generate an independent JIT candidate using the existing outline agent and obligation checks.
2. Validate it against canonical state.
3. If it conflicts, generate a minimal revision and validate that revision.
4. If the revision passes, use it automatically for the current invocation.
5. If the revision fails, discard the entire candidate and generate another independent candidate from the original empty outline state.
6. Allow at most three independent candidates per invocation.

If all independent candidates fail:

- compare their conflict fingerprints using exact structured fields: `type`, `subject`, `attribute`, `oldValue`, and `newValue`;
- when the same fingerprint persists across every candidate, throw `BlockingConflictError` because the conflict is stable enough to require author intent;
- when fingerprints vary, throw a normal JIT-generation error without opening the author-decision UI, because no stable outline-versus-canonical choice has been established.

## Proposal Validation

`prepareStoryStateForChapter` gains an option controlling proposal generation:

- `generate`: current external behavior; blocking conflicts may include a proposal.
- `omit`: detect and return the same structured conflicts without another proposal model call.

The outline coordinator validates a proposed description by creating an immutable state copy with that description and calling the reconciliation path in `omit` mode. Passing validation makes the proposal eligible for use or display. Failure discards it.

No validation decision parses `revisedDescription`, `explanation`, or conflict prose. The model still interprets prose, while runtime routing consumes only typed results and exact structured identifiers.

## Error and UX Behavior

- A recoverable JIT conflict remains within the spinner and does not prompt the author.
- Logs state that a temporary candidate was discarded and show the bounded candidate count.
- A stable repeated JIT conflict may open manual author resolution.
- A persisted conflict opens manual author resolution immediately, but only offers “adopt proposal” when the proposal was validated.
- A varying exhausted JIT failure reports that independent candidates could not converge and suggests rerunning; it does not ask the author to decide between unrelated transient claims.
- Choosing “adopt” retains the existing checkpoint and `outline.md` update behavior.

## State and Checkpoint Safety

- Candidate and proposal revisions are immutable in-memory state copies until validation succeeds.
- Failed JIT candidates never update checkpoint state or `outline.md`.
- Persisted outlines change only through the existing explicit `applyOutlineRevision` author action.
- Successful chapter execution continues to use the normal chapter commit boundary.

## Testing

Add focused tests for:

1. A first JIT candidate conflicts, is discarded, and a second independent candidate succeeds without throwing `BlockingConflictError`.
2. A conflicting JIT candidate receives a valid revision and continues without regenerating.
3. An invalid revision is not surfaced as an adoptable proposal.
4. Three JIT candidates with the same structured conflict escalate to author resolution.
5. Three JIT candidates with different conflict fingerprints fail without invoking author resolution.
6. A persisted outline is not silently rewritten and exposes only a validated proposal.
7. Proposal-validation mode does not recursively generate proposals.
8. The no-prose-matching smoke suite remains green.

Run the focused outline/reconciler/CLI tests, then the full test suite, typecheck, build, and `git diff --check`.

## Scope Boundary

Automatic repair of genuinely corrupt canonical state is a separate architectural change. It requires structured evidence that the state projection contradicts finalized chapter text, not merely an outline conflict. This design deliberately keeps that existing evidence-gated repair path separate from JIT outline retry behavior.
