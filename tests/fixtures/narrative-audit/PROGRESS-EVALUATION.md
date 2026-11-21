# Narrative progress and structural increments

## Problem and policy

The earlier excerpt evaluator passed `structuredValidationResult: undefined` to routing. Its 42/42 result did not exercise the structural zero-increment gate. Two chapters without recorded state increments could therefore trigger outline regeneration even when narrative review found meaningful psychological or relational development.

Protocol 4 adds `progress[].recording`: `required`, `not_required`, or `uncertain`. The reviewer must decide from prose whether the advancement depends on a recordable state change; an empty event stream is not evidence for `not_required`.

Routing and finalization share `hasAuditedNonStateProgress`. Non-state advancement interrupts the zero-increment streak only when:

- Enforced protocol-4 review is bound to the current chapter and validated prose.
- The current chapter is `advancing`, with dimensions, paragraph evidence, and `recording: not_required`.
- Every extracted fact has complete, high-confidence coverage, with no missing/uncertain facts or recordable facts dismissed as not recordable.
- No unresolved finding remains, including advisory findings. Rejected contradiction candidates do not count as unresolved.

The graph entry points still validate the entire certificate against prose, records, configuration and historical-window hashes. Old reports require revalidation. Report/off modes cannot grant an exemption. This policy does not synthesize events, change the structural increment measurements, consume beats, or bypass mandatory claims, evidence validation or lifecycle constraints. Actual narrative stagnation can still replan a chapter whose structured events show increments.

The checkpoint channel retains its existing name, `consecutiveZeroIncrementChapters`, for compatibility. It now counts consecutive finalized chapters with neither structural increments nor accepted non-state advancement. A qualifying chapter resets it in finalization, using the same policy as routing.

## Regression coverage

- Routing tests combine actual structural validation/increment results with narrative reports, including stale/legacy reports, report/off modes, unresolved findings, incomplete/weak coverage, mandatory claims and nonzero-event stagnation.
- The runner integration test executes drafting, validation, routing, finalization, chapter commit and checkpoint reload with fixed model responses. Two quiet chapters commit without fabricated events; a subsequent unqualified chapter starts a new streak. The existing stalled-generation scenario still exhausts the bounded outline retries and blocks.
- Integration fixtures use isolated system temporary directories.
- New model fixtures cover a purely internal decision after a prior zero-increment chapter, psychological advancement accompanied by an omitted death, and repetitive waiting despite a recorded location change.
- An important-item custody omission control checks that entity-type restrictions do not suppress real missing handoffs. `extraction-errors.json` freezes two actual failed model extractions, including provenance, for protocol regression.

The original `quiet-progress-window` contains a letter handoff as well as psychological progression. It is retained unchanged, but is not used as proof of exclusively non-state progression. The new decision fixture isolates that condition without changing historical prose.

## Evaluation harness

`npm run eval:narrative -- --live` now runs the production structured-validation node before narrative review and routing. Fixtures can specify the prior zero-increment streak. All reasonable controls also require `finalize_chapter`, rather than merely an absence of high-confidence findings. Results save structural validation, prior streak, routing, model responses, telemetry and source hashes.

Existing synthetic event records were corrected to use the real one-based `evidence.paragraphIndex` contract; the audit's own evidence indexes remain zero-based. No historical excerpt was edited. The supplied draft events are also the fixture's planned events, so these cases are not a test of independently generated plans.

This is still an excerpt-based structural-validation/audit/routing evaluation. It does not measure real-model drafting, repair quality, whole-book completion, long-range retrieval, literary quality or end-to-end novel cost. Full runner regression uses fixed model outputs and tests orchestration, not semantic accuracy. A whole-book acceptance stage and retrieval beyond the recent prose window remain separate work.

## Real-model results — 2026-11-22

Model: `MiniMax-M3.1-Flash`, configured temperature `0.7` (the provider configuration overrides the audit's requested `0.1`). All final runs use matching source hashes.

| Experiment                                                                   | Result                                                           |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Full structural-validation → audit → routing corpus                          | **25/25** (24 model-backed cases, 1 deterministic hygiene check) |
| Reasonable controls within the corpus                                        | **14/14 finalized**, with no high-confidence findings            |
| Additional recorded-death, quiet-decision and same-name controls, twice each | **6/6 finalized**                                                |
| Quiet decision with a prior zero-increment chapter                           | **3/3 finalized**, without adding state events                   |
| Recorded death / same-name-different-people, including repeated trials       | **3/3 finalized each**                                           |
| Psychological advancement with an omitted death                              | **Blocked for omission**                                         |
| Important-item custody change omitted from records                           | **Blocked for omission**                                         |
| Repetitive waiting despite a nonzero location increment                      | **Outline regenerated for narrative stagnation**                 |

The full run used 54 model calls; the six focused repetitions used 14. Bounded protocol retries are included. Passing includes the expected routing outcome, not merely a model label.

Commands:

```sh
npm run eval:narrative -- --live --concurrency 3
npm run eval:narrative -- --live --case recorded-death --repeat 2
npm run eval:narrative -- --live --case quiet-decision-zero-increment --repeat 2
npm run eval:narrative -- --live --case same-name-different-people --repeat 2
```

An exploratory 24-case run passed 21/24. It exposed two false omissions (a free-form lifecycle attribute duplicating a recorded terminal state, and a custody observation attached to a character ID) and one exhausted coverage check (ordinary activity was inferred as `alive=true`, then an empty entity status was incorrectly cited as explicit lifecycle evidence). Extraction now receives entity kinds and the controlled lifecycle vocabulary; protocol checks reject invalid subjects/attributes, and prompts distinguish explicit lifecycle assertions from ordinary activity. No prose-specific filtering was added. A subsequent run was interrupted after four completed cases while the lifecycle prompt was corrected; it is excluded from final results. Both exploratory artifacts are retained.

The original 21 excerpts and existing expectations were preserved. The new corpus adds four cases and finalization requirements for reasonable controls. The observed absence of false positives in these controls does not establish a general false-positive rate or prove whole-book quality.

Validation: **152 test files / 1,917 tests**, typecheck, lint, build and formatting checks passed. Raw final reports, model responses, routing/structural evidence, telemetry, source hashes, exploratory failures and logs are saved under the local artifact directory `narrative-progress-review-2026-11-22` for this session.
