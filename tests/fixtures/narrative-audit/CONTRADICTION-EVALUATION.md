# Independent contradiction review — 2026-11-21

Baseline: commit `7ed0029`, whose [recorded evaluation](EVALUATION.md) left one historical contradiction advisory. Final model: `MiniMax-M3.1-Flash`, configured temperature `0.7`, unchanged from the baseline. No model configuration or book data was modified.

## Why the original case was only a warning

The first reviewer explicitly described mutually exclusive existence claims but returned `medium`. Runtime severity depended only on that confidence label. Later exploratory reviews exposed a second failure: the model sometimes invented an implicit transition or an unmarked flashback to reconcile the text. Simply raising all medium findings would also increase false positives.

The exact original finding is frozen in `historical-medium-contradiction.json`; its original confidence and evidence are replayed in regression tests.

## Runtime change

Every contradiction candidate, including high-confidence ones, receives one additional independent review. That reviewer sees the referenced evidence, the full current/prior prose window and structured records, but not the first reviewer's confidence, explanation or extracted observations.

Six typed checks establish subject identity, attribute identity, comparable time, an established premise, incompatible claims and absence of a supported resolution. All six must be `yes` to confirm. Any `no` rejects the candidate; otherwise it stays uncertain. Runtime blocking consumes this verdict rather than the original confidence label. Rejected candidates remain in the report but generate no runtime issue. Uncertain candidates remain advisory; report mode never blocks.

The prompt preserves the scope of prior constraints: an overall negation cannot be weakened into a partial loss, and a new state description or elapsed time alone does not explain a violation of a persistent constraint. Explicit revival, recollection, dreams, different people, corrected rumors and a surviving backup remain valid explanations or non-conflicts.

The new required check uses bounded validation retries and fails closed on execution/schema/evidence errors. Audit protocol version 3 invalidates old certificates and missing contradiction reviews. A normal clean audit still takes two model calls; a review containing contradictions normally adds one batched call.

## Final results

| Experiment                                                            | Result                                               |
| --------------------------------------------------------------------- | ---------------------------------------------------- |
| Complete audit-to-routing corpus, 21 cases × 2                        | **42/42**                                            |
| Model-backed subset of that corpus                                    | **40/40**                                            |
| Deterministic protocol-leak checks                                    | **2/2**                                              |
| Reasonable controls in complete corpus, 13 cases × 2                  | **26/26 without high-confidence findings**           |
| Original unexplained return, complete audit-to-routing                | **5/5 blocking** (2 corpus runs + 3 additional runs) |
| Forced-candidate independent review, 14 cases × 2                     | **28/28**                                            |
| Reasonable cases deliberately presented as high-confidence candidates | **22/22 rejected**                                   |
| Additional forced-medium review of the original case                  | **5/5 confirmed**                                    |

One of the five complete original-case runs still started with `medium`; independent evidence review confirmed it and routing blocked finalization. This exercises the original failure directly.

The 42-case run used 92 structured responses: 43 extraction, 41 initial review and 8 independent review calls. This includes four extraction/initial-review validation retries; no case ended incomplete. The forced-candidate run used 29 responses, including one evidence-validation retry. The three additional complete original-case runs used 9 responses.

Commands:

```sh
npm run eval:narrative -- --live --concurrency 3 --repeat 2
npm run eval:narrative -- --live --adjudication-only --concurrency 2 --repeat 2
npm run eval:narrative -- --live --case unexplained-return --repeat 3
npm run eval:narrative -- --live --adjudication-only --case unexplained-return --concurrency 2 --repeat 5
```

The audit-to-routing harness now checks an actual blocking issue and non-finalize routing for expected errors, not just a confidence label. It does not generate or repair a full novel. Forced-candidate mode omits the upstream finding's confidence/diagnosis from model input and tests false-candidate rejection even when an ordinary initial review would return no finding.

## Review, provenance and limits

Exploratory versions were not uniformly successful: the first checklist still invented implicit transitions; an intermediate five-run target trial passed 4/5. Those results are retained alongside final raw outputs rather than being counted as final successes. New same-name and explained-revival controls include lifecycle records so unrelated registration omissions do not confound the contradiction test. Original historical prose and original reasonable-control expectations were retained.

The model prompts/schema were fixed for the final experiments. During those runs, runtime guard review additionally made severity read the adjudicated verdict directly and invalidated incomplete protocol-3 reports; unit tests verify these defensive changes. Raw artifacts preserve each run's source hashes, responses, evidence, routing, timings and telemetry, plus reviewed source hashes. Generated logs are kept outside the repository.

Validation: **152 test files / 1,896 tests passed**, with typecheck, lint, build and formatting checks. Regression coverage includes the exact medium finding, high-confidence false-candidate rejection, uncertain evidence, missing/invalid references, bounded failures, fallback providers and protocol upgrades.

These are repeated short excerpts and authored controls under one model configuration, not an independent large held-out set or a whole-book evaluation. No increase in false positives was observed in these samples; this does not establish a general zero-false-positive rate or deterministic model behavior.
