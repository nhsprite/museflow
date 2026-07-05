# Changelog

All notable changes to MuseFlow releases are documented in this file.

This project follows semantic versioning. Dates use `YYYY-MM-DD`.

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
