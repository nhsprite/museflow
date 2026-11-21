# Narrative audit regression corpus

`cases.json` freezes seven minimal historical error excerpts from the 2026-11-21 book review and eight synthetic reasonable controls. Source paths and line ranges record provenance; tests/evaluation load this JSON only, never the gitignored `books/` directory. Fixture chapter indexes are local to each excerpt window, not the original chapter numbers. These are excerpt-level cases, not whole-book quality scores.

The unit/integration tests supply fixed model judgments to check evidence validation, failure handling, routing, bounded retries, report persistence and invalidation. They **do not measure model detection accuracy**. Explicit protocol leakage is also tested against the real deterministic prose-hygiene gate.

List cases without model calls:

```sh
npm run eval:narrative
```

Opt in to calls to the configured model:

```sh
npm run eval:narrative -- --live --concurrency 2
npm run eval:narrative -- --live --case unexplained-return
npm run eval:narrative -- --live --concurrency 3 --repeat 2
```

Assertions cover expected findings, absence of high-confidence findings in controls, repair direction, and actual routing for the stalled/quiet windows. Recorded death, already-established death and explicit registered revival controls exercise nonempty event/memory records.

Each run prints per-case results and incrementally saves model responses, validated reports, routing decisions, timings, source hashes and telemetry to a new OS temporary directory. Failures, including incomplete audits, return exit code 1. No book data or configuration is modified. Re-run across model/prompt versions and add held-out cases before treating these small-sample results as general quality improvements.

See [the recorded live evaluation](EVALUATION.md) for measured results and remaining limitations.
