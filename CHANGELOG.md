# Changelog

All notable changes to MuseFlow releases are documented in this file.

This project follows semantic versioning. Dates use `YYYY-MM-DD`.

## [1.0.2] - 2026-07-09

### Added

- Added per-chapter mandatory beat budgeting so current-act beats are not over-consumed before the act has enough remaining chapters.
- Added stable mandatory beat IDs (`A{act}-M{index}`) across outline planning, chapter planning, drafting prompts, summary verification, StoryMemory projection, and rewrite recomputation.
- Added clearer CLI progress display for pending act beats and total act count.

### Changed

- Reworked mandatory beat verification to prefer structured `plot-advance` events, stable IDs, and StoryMemory evidence instead of local prose heuristics.
- Routed word-count and chapter validation retries through the structured validation/fix loop so blocking failures preserve rewrite context correctly.
- Hardened runtime neutrality by removing additional natural-language matching paths and dead barrel exports.

### Fixed

- Fixed rewrite false positives where completed past-act mandatory beats could be recomputed as pending when rewriting a later chapter.
- Fixed rewrite and `adjust-act` checkpoint consistency by preserving consumed mandatory beat progress, syncing chapter markers, and resetting stale rewrite progress.
- Fixed act-boundary handling so incomplete act transitions, unproven mandatory beat claims, and early over-consumption are blocked or surfaced with actionable adjustment guidance.
- Fixed finalization safety so chapter advancement stops on finalization failures, completed stories are frozen, generated headings are normalized, and fix-agent checklist residue is removed from rewritten text.

### Dependencies

- Added `@inquirer/prompts`, `@langchain/langgraph-checkpoint`, `@eslint/js`, `@vitest/coverage-v8`, and `uuid`.
- Removed unused `p-limit`, `@types/inquirer`, and `ts-node`.
- Refreshed the npm lockfile for the current dependency graph.

## [1.0.1] - 2026-07-05

### Added

- Added a generic diversity constraint to title option generation so candidate titles use distinct imagery and avoid repeating the same word or metaphor across options.

### Fixed

- Fixed `start` command crash where Commander passed its `Command` instance as `RuntimeContext`, causing `provider` to be `undefined` and `chatStructured` to fail.

## [1.0.0] - 2026-07-04

### Added

- Added this changelog as the canonical release history for MuseFlow.
- Added a smoke guard to prevent runtime semantic decisions from reintroducing natural-language keyword, phrase, fuzzy, or fragment matching.

### Changed

- Promoted MuseFlow from `0.1.0` to `1.0.0`.
- Hardened runtime neutrality by moving semantic decisions away from local prose matching and toward structured fields, stable IDs, enums, exact membership, explicit locations, or structured model validation.
- Reworked issue localization to use structured `locationRef` instead of parsing natural-language `location` text.
- Removed local prose heuristics from canonical fact filtering, mandatory beat handling, foreshadow handling, outline reconciliation, issue deduplication, and targeted fix routing.
- Changed the build script to clean `dist/` before compiling so release packages do not include stale generated files.

### Fixed

- Fixed false blocking failures where JIT chapter outlines could be rejected because a mandatory beat was not considered "supported" by keyword overlap in the outline description.
- Fixed canonical fact evidence handling so missing or divergent prose quotes no longer trigger local fuzzy matching or story-specific demotion logic.

### Documentation

- Documented the strict ban on natural-language string matching for semantic runtime decisions in `AGENTS.md`.
