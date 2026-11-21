# Live narrative audit evaluation — 2026-11-21

Model: `MiniMax-M3.1-Flash`; configured temperature: `0.7`. The provider's configured temperature overrides the audit's requested 0.1; no user model configuration was changed. Run started at `2026-11-21T15:19:03.301Z`.

```sh
npm run eval:narrative -- --live --concurrency 3 --repeat 2
```

## Results

- Strict overall assertions: **29/30** (15 frozen cases, twice each).
- Real-model assertions: **27/28**; deterministic protocol-leak checks: **2/2**.
- Historical model cases: **11/12** meet their high-confidence detection or actual outline-regeneration requirement.
- Reasonable controls: **16/16** have no high-confidence findings and do not trigger narrative outline regeneration.
- Both repeated-inventory runs actually request outline regeneration; both quiet-progress windows avoid it.
- 57 completed structured audit responses (1 validation retries above the normal 56 calls); no case ended with an incomplete audit. Transport retries: 0.

| Frozen case                 | Strict passes |
| --------------------------- | ------------- |
| `death-omitted`             | 2/2           |
| `unexplained-return`        | 1/2           |
| `editorial-analysis`        | 2/2           |
| `editorial-deletion`        | 2/2           |
| `calendar-regression`       | 2/2           |
| `repeated-inventory`        | 2/2           |
| `protocol-leak`             | 2/2           |
| `recollection-not-revival`  | 2/2           |
| `explicit-revival`          | 2/2           |
| `quiet-relationship-change` | 2/2           |
| `in-story-editing`          | 2/2           |
| `recorded-death`            | 2/2           |
| `known-death-restated`      | 2/2           |
| `quiet-progress-window`     | 2/2           |
| `registered-revival`        | 2/2           |

## Remaining failure

`unexplained-return` iteration 1 identifies the contradiction and cites both excerpts, but assigns `medium` confidence. It therefore produces a warning rather than the required blocking error. The evaluation intentionally remains failed for this case. A separate omission finding requests a draft retry, which does not establish that the contradiction itself will be repaired. Iteration 2 assigns high confidence and passes. Confidence calibration is still model-dependent.

## Changes supported by this evaluation

The initial 11-case run passed 9/11: an extracted death was silently omitted from review, and editorial analysis failed schema/evidence validation. Its loose assertions also missed an unsafe backward repair suggestion and a stalled window that did not actually replan. The current assertions are stricter, and eight controls now include nonempty lifecycle memory, recorded death and registered revival.

Each extracted fact now needs an explicit coverage verdict. Typed lifecycle fields and entity IDs verify death coverage; anonymous role descriptions cannot require entity registration solely because they describe an identity. Model repair targets are restricted and code supplies repair instructions that preserve finalized prose. Explicit indexes and validation-error feedback support bounded retries. A three-chapter window supplies one background chapter and two subsequent assessments; concurrent record omissions no longer conceal stagnation.

Code review also fixed stale audit retention when disabled, same-paragraph entity omissions collapsing during deduplication, and the rewrite-budget interaction when omissions and stagnation coexist. Unit/integration checks cover these independently of model quality.

## Limits and verification

These are short excerpts, including synthetic controls, not a full-book or held-out evaluation. Repeating each case twice measures only limited variability. Zero high-confidence false positives here does not establish a general zero-false-positive rate. Medium/low observations remain advisory; the final failure must not be reported as a full pass.

Earlier intermediate runs exposed role-registration and pronoun-coreference false positives; their raw results are retained with the local evaluation artifacts, alongside this final run. No book data was modified. Raw results include source hashes, responses, evidence, routing decisions and telemetry; they are kept outside the repository rather than committing generated logs.

Verification: 151 test files / 1,869 tests passed; typecheck, lint, build and formatting checks passed.
