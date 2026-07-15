# MuseFlow — Agent Context

AI Native 长篇小说生成 CLI 工具 (AI-native long-form novel generation CLI). A locally-run Node.js tool: enter a one-sentence story pitch and AI handles worldbuilding, outline generation, and chapter-by-chapter drafting. LangGraph orchestrates 10 specialized agents; all state lives in local JSON + filesystem storage — no database.

- **Stack**: Node.js >= 20, TypeScript (strict, ESM), LangGraph (`@langchain/langgraph`), Commander, zod, Inquirer, Vitest.
- **Distribution**: published to npm as `museflow` (`bin: museflow -> dist/cli/index.js`).

## Essential Commands

| Task        | Command                                                          |
| ----------- | ---------------------------------------------------------------- |
| Dev (watch) | `npm run dev` — tsx watch src/cli/index.ts                       |
| Run CLI     | `npm start -- <command> [args]` — runs via tsx, no build         |
| Build       | `npm run build` — cleans `dist/` then `tsc`                      |
| Type check  | `npm run typecheck` — `tsc --noEmit`                             |
| Test all    | `npm test` — `vitest run` (109 files / 1080 tests)               |
| Test watch  | `npm run test:watch`                                             |
| Lint        | `npm run lint` — `eslint src` (flat config in eslint.config.js)  |
| Format      | `npm run format` / `npm run format:check` — Prettier             |
| Release     | `npm run release` — interactive version/changelog/publish script |

For daily dev, use `npm start` or `npm run dev` (tsx runs TypeScript directly); `npm run build` is only needed to produce the compiled `dist/` for the published package. Pre-commit hook: husky runs `npx lint-staged`, which formats staged files with Prettier.

## TypeScript & Module Rules

- **ESM only** (`"type": "module"`). All source imports must use `.js` extensions (e.g. `import { x } from './foo.js'`).
- **No path aliases in source**. `tsconfig.json` has no `paths` mapping. The `@/` alias exists **only in tests** via `vitest.config.ts` (most tests still use relative `../../src/...js` paths).
- **Strict flags enabled**: `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noImplicitReturns`, `noFallthroughCasesInSwitch`. Do not suppress these.
- **Target**: Node 20+, ES2022, `NodeNext` module resolution. `rootDir: src`, `outDir: dist`.
- **Prettier style**: no semicolons, single quotes, 2-space tabs, `printWidth: 100`, `trailingComma: 'es5'`, LF endings.
- **ESLint** (`eslint.config.js`, flat config): `@eslint/js` recommended + `@typescript-eslint` recommended; unused vars allowed with `_` prefix; `no-explicit-any` off. Only `src/` is linted.

## Project Structure

```
src/
  cli/            Commander CLI entry (index.ts wires all commands), commands/, formatters/, utils/
  graph/          LangGraph state graph: novel.graph.ts, state.ts, nodes/, services/, utils/, checkpointer.ts, agent-factory.ts
  agents/         10 agent implementations (worldbuilder, character, story-arc, chapter-outline, chapter-planner, chapter, foreshadowing, consistency, fix, summary) + prompts/ (incl. prompts/fragments/)
  core/           runner.ts, chapter-commit.ts, outline-expander.ts (JIT), act-progress-projection.ts, rewrite-state.ts, chapter-generation/ (issue classifier + routing/)
  story-memory/   StoryMemory event-sourced memory: parser, projector, validator, migrator, event-contract, foreshadow-policy, queries
  genres/         Genre skill system: registry.ts + builtin/ (default, fantasy, xianxia, scifi, horror, mystery, urban, romance)
  storage/        checkpoint-service.ts, migration.ts, meta/ (exporter + stores), filesystem/writer.ts
  config/         store.ts — project/global config loading (zod-validated)
  model/          provider.ts (ModelProvider interface) + registry.ts (OpenAI/Anthropic-compatible providers)
  types/          Shared TS interfaces (story, outline, story-state, story-memory, foreshadow, agent, ...)
  utils/          Helpers (paths, id, logger, json repair, retry, verified-constraints, pending-tasks, ...)
tests/            Vitest tests mirroring src structure + smoke/ (invariant guards), integration/, scripts/
scripts/          clean-dist.js, release.js (npm publish), repair-story-memory-ids.ts
books/            Runtime story output (gitignored, never edit by hand)
output/           Exported .txt manuscripts (gitignored)
docs/specs/       Design docs (gitignored locally; 2026-07-04-current-runtime-architecture.md is the current reference — 2025 docs are historical SQLite-era plans)
docs/superpowers/ Implementation plans/designs from agent sessions (gitignored)
```

## Storage Architecture (Critical)

**MuseFlow uses JSON + filesystem storage only. It does NOT use SQLite.** Do not add SQLite migrations or SQL queries.

- **Config**: `museflow config set` writes project-level `./.museflow/config.json`, which takes precedence over the optional global fallback `~/.museflow/config.json` (see `src/config/store.ts`). Provider values `minimax`/`local` are normalized to `openai` (OpenAI-compatible endpoints).
- **Story directory**: `books/{title-slug}-{shortId}/` (title + id suffix, not the raw story id).
- **Checkpoints**: `books/{story-dir}/checkpoints/*.json` — LangGraph checkpoint JSON written by the custom `JsonCheckpointer` (`src/graph/checkpointer.ts`); `latest.json` points to the newest. **Checkpoints are the runtime source of truth.**
- **Projections/artifacts (regenerated by code)**: `meta.json` (CLI display), `outline.md`, `story_bible.md`, `chapters/chapter_{n}.md`, `reports/chapter_{n}.report.json`, `reports/blocking_*.json`, `output/*.txt` exports.
- **Debug logs**: `--debug` flag (or `MUSEFLOW_DEBUG=1`) wraps the model provider and appends LLM sessions to `.museflow/debug/sessions.jsonl`.

## CLI Commands

Wired in `src/cli/index.ts`: `start --idea <text> --chapters <n> [--genre] [--title] [--yes]`, `write <id>` (exactly one chapter), `continue <id> [-y|-n]`, `rewrite <id> [--chapter n]`, `status [id]`, `info <id>`, `list`/`ls`, `delete <id> [--force]`, `adjust-act <id> --act n --end-chapter n`, `waive-foreshadow <id> --foreshadow <id> [--reason]` (author decision: leaves a foreshadow intentionally unresolved so it stops blocking act/story boundaries), `export <id>` (txt + QR download server), `config [show|set|get]`, `genres [list|install|uninstall] [--file]` (custom genre JSON lives in `~/.museflow/genres`), `migrate-memory <id>` (migrates a legacy story from StoryState to StoryMemory). Global `--debug` flag enables LLM session logging.

## Runtime Architecture

- **Graph**: `src/graph/novel.graph.ts` owns the LangGraph state machine. Story creation path: `build_world → create_characters → create_outline → validate_outline → finalize_story`. Chapter loop: `prepare_chapter → converge_and_decide → draft_chapter|fix_chapter|repair_state → validate_chapter_structured → validate_chapter_comprehensive → converge_and_decide → finalize_chapter|request_rewrite`. `request_rewrite` ends the graph with a blocking report for manual resolution.
- **Checkpoint is the source of truth**: `meta.json` and the other files are projections for CLI display and external inspection, exported from the persisted checkpoint.
- **Chapter commit boundary**: after `graph.invoke()` returns, `src/core/chapter-commit.ts` saves the finalized chapter marker from the persisted checkpoint and exports the `meta.json` projection. Do not duplicate that marker/export sequence in command code.
- **JIT outline expansion**: `src/core/outline-expander.ts` generates a chapter outline and `ChapterPlan` immediately before drafting, using story arc progress, prior summaries, story state, pending tasks, and next-chapter boundary hints.
- **Routing**: `src/core/chapter-generation/routing/` decides whether to draft, patch-fix, repair state, finalize, or stop for manual rewrite, using issue fingerprints for stall detection.
- **Validation loop**: `validate_chapter_structured` verifies the structured event contract (evidence spans, foreshadow fulfillments, `STORY_FINAL_STATE` end-of-chapter declarations) before `validate_chapter_comprehensive` aggregates word-count, continuity, foreshadowing, and consistency checks.
- **Foreshadow scheduling is advisory**: `selectForeshadowsForChapter` only proposes due/overdue candidates; the outline agent must adjudicate each into `fulfilledForeshadowIds` or `deferredForeshadowIds`, and the plan is validated against the outline's claims, never force-overridden. Severely overdue deferred foreshadows get bounded deadline extensions (`foreshadow-deadline-extend` events, max 2) at finalization; beyond the cap they are reported, not blocking. Exception: when the chapters left in an act cannot hold all pending required foreshadows (per-chapter fulfillment capacity), scheduling enters tight mode and marks the scheduled share 【强制回收】 — the outline is retried if they are deferred, and in strict mode (act-extension quota exhausted) a persistent refusal aborts the chapter with a manual-resolution error. Foreshadows without an `expectedFulfillChapter` only enter the candidate pool in the final act, sorted last; authors can also remove a foreshadow from the pool permanently via `waive-foreshadow` (`foreshadow-waive` event, `waivedIn` projection field).
- **State authority hierarchy**: finalized chapter text > story-memory projection > outline structured declarations > `outline_inference` facts. `authorizeOutlineFacts` pre-authorized facts pass through a structural gate (no location/holder, known subject ids only, no projection conflicts) and persist via `canonicalFactsDelta`; they render as advisory hints and are superseded by chapter-extracted facts. Active canonicalFacts override memory location projections when rendering state.
- **State repair**: when a rewrite loop's remaining errors are all state-corruption issues (stale state records contradicting finalized chapters), routing enters the `repair_state` node (max `MAX_STATE_REPAIR_ATTEMPTS = 2` per chapter, `src/core/chapter-generation/routing/index.ts:24`): the LLM proposes structured state fixes that must pass strict structural validation (known entity ids, attribute enums, exact oldValue match, evidence chapter before the current one) before being written as canonicalFacts (`source: 'state_repair'`) and merged into storyState. Rejected proposals' reasons are stored in `session.stateRepairRejections` and fed back into the next attempt's prompt. If repair attempts are exhausted, routing falls back to the manual `request_rewrite` path.
- **Finalization**: `src/graph/services/finalization/chapter.ts` extracts summary/state/canonical facts, verifies mandatory beats (stable IDs like `A{act}-M{index}`), updates act progress, writes chapter reports, and returns state updates without mutating the input graph state.
- **Verified constraints**: runtime `verifiedConstraints` are structured objects. Render them to strings only at agent prompt boundaries; do not classify constraints by parsing natural-language prompt text.

## Testing Conventions

- **Framework**: Vitest, globals enabled, `environment: 'node'`, 10s timeout, `tests/**/*.test.ts`. Run with `npm test` (full suite passes: 109 files / 1080 tests).
- **Agent tests**: construct the agent directly with a hand-rolled mock `ModelProvider` (`{ chat: vi.fn(), chatStructured: vi.fn() }`) and subclass the agent to expose protected methods like `parse` (see `tests/agents/worldbuilder.test.ts`).
- **Module dependencies**: mock with `vi.mock('../../src/<module>.js', factory)` (see `tests/core/outline-expander.test.ts`, `tests/core/chapter-commit.test.ts`).
- **File system tests**: use real temp dirs (`fs.mkdtempSync` / `os.tmpdir()`); clean up in `afterEach`.
- **Smoke guards**: `tests/smoke/no-prose-matching.test.ts` enforces the no-natural-language-matching rule by scanning runtime files for forbidden snippet names; `tests/smoke/project-smoke.test.ts` guards project-level invariants. Update the smoke test when legitimately restructuring guarded files.
- **Private-method testing**: extend the class and expose the protected member — do not change source visibility for tests.

## CI & Release

- GitHub Actions: `.github/workflows/npm-publish.yml` — on push to `develop` touching `package.json`, publishes to npm only if the version changed and is not already on the registry (runs `npm run release -- --yes --provenance` with `NPM_TOKEN`). No test/build CI workflow exists.
- `scripts/release.js` (also runnable locally via `npm run release`): validates Node version and git state, requires a `CHANGELOG.md` entry for the current version, builds, and publishes (interactive unless `--yes`). Changelog follows semantic versioning, dates `YYYY-MM-DD`.

## Environment & Constraints

- **Node >= 20** required (`engines` field).
- **Gitignored**: `node_modules/`, `dist/`, `coverage/`, `books/`, `output/`, `.museflow/`, `.worktrees/`, `.codegraph/`, and `docs/` (design docs are local-only).
- CLI strings and many code comments are in Chinese; docs/specs and README are English. Match the surrounding file's language for comments.

## Agent Prompt Design Rules

All agent prompts (`src/agents/prompts/`) must follow these principles:

1. **Neutrality**: Prompts must express generic writing conventions, not rules tailored to a specific book, genre, or story. Do not hard-code genre-specific concepts (e.g., "previous life memory", "fate prophecy", "cultivation realms") into prompts.
2. **Abstraction over Example**: When forbidding patterns, state the abstract rule (e.g., "Do not end chapters with explicit chapter-end markers") rather than enumerating specific examples (e.g., "Do not use 'To be continued', '(End of Chapter)', 'Chapter X · Complete'").
3. **Configurable over Hard-coded**: Word-count requirements, genre conventions, and style rules must be read from `GenreSkill` / config, not baked into prompt strings.
4. **No Story Spoilers**: Agents must not reference future plot points, character arcs, or twists from the outline when checking current-chapter content.

## Code Architecture Rules

1. **No Story-Specific Hardcoding**: Never hardcode character names, item names, locations, or plot-specific keywords in source code (e.g., `desc.includes('孙悟空')`, `desc.includes('木之灵物')`). These are temporary patches that break when writing different stories. Such logic belongs in prompts or configuration, not in code.
2. **No Duplicate Filters**: Do not implement the same filtering/demotion logic in multiple places (e.g., both `write.ts` and `consistency.ts`). Centralize post-processing in the agent's `processOutput`/`parse` path.
3. **Fix Root Causes, Not Symptoms**: When an agent consistently misjudges a certain scenario, fix the agent's prompt or input context rather than adding hardcoded post-processing rules to downgrade specific outputs.
4. **No Natural-Language String Matching for Semantics (Critical)**: Runtime code must not use natural-language characters, keywords, phrases, fragments, regular expressions, n-gram overlap, LCS/fuzzy text similarity, or `includes`/`startsWith`/`endsWith`/`match` against prose to make semantic decisions. This is strictly forbidden even when the rule is generic rather than story-specific.
   - Forbidden uses include state/canonical fact updates, issue filtering or demotion, issue routing/classification, act or mandatory-beat verification, foreshadow filtering, outline-vs-state conflict decisions, pending-task resolution, paragraph/sentence repair targeting, and any other behavior that changes story state or control flow based on prose content.
   - Use structured data instead: stable IDs, enums, typed fields, explicit issue codes, subject/attribute/value records, evidence offsets/spans, chapter/paragraph/sentence indexes, structured model output with JSON schema, or author/config decisions.
   - Existing natural-language matching logic is technical debt to remove. Do not add new matching logic and do not extend existing matching logic while fixing bugs.
   - The only allowed string/regex matching is non-semantic parsing of machine-readable formats or explicit delimiters, such as JSON repair, Markdown/code fences, CLI flags, file names, checkpoint IDs, protocol names, and agent output section markers. If the input is story prose, issue prose, outline prose, summary prose, or prompt prose, matching its natural-language content is not allowed for decisions.
   - Enforced by `tests/smoke/no-prose-matching.test.ts`.

## Data Integrity Rules (Critical)

1. **Never modify `books/` directory directly**: The `books/` directory contains runtime-generated story data (meta.json, chapters, checkpoints). Direct modification causes data inconsistency, breaks reproducibility, and hides real code defects. All data changes must be driven by code logic or CLI commands.
2. **Code fixes over data patches**: When story data has errors (e.g., contradictory timeline, wrong character status), fix the code that generates or consumes the data (agents, runners, checkpointers) — never hand-edit the data files.
3. **Git does not track `books/`**: Since `books/` is `.gitignore`d, manual changes have no history and cannot be reverted. This makes debugging impossible.
4. **Checkpoint consistency**: Checkpoints, timeline snapshots, and meta.json reference each other. Modifying one without updating others creates orphaned references.

## Adding a New Agent

1. Create a class in `src/agents/{name}.ts` extending `BaseAgent` (`src/agents/base.ts`): implement `buildPrompt(state): Message[]` and `parse(content): AgentOutput`; shared prompt fragments live in `src/agents/prompts/fragments/`.
2. Add a thin node function under `src/graph/nodes/` or a focused service under `src/graph/services/` that instantiates and calls the agent through `src/graph/agent-factory.ts`.
3. Wire the node into `src/graph/novel.graph.ts`.
4. Add tests in `tests/agents/{name}.test.ts` with a mock `ModelProvider`.
5. Ensure the agent returns partial state updates that merge into `GraphState`.

## Model Provider Setup

Providers are configured via CLI: `npm start -- config set --provider <openai|anthropic> --api-key ... --model ... [--base-url ...]` (or `museflow config set ...` when installed). `minimax`/`local` are accepted as OpenAI-compatible shortcuts. Env fallbacks: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`.

The `ModelProvider` interface (`src/model/provider.ts`):

```ts
interface ModelProvider {
  chat(messages: Message[], temperature?: number): Promise<string>
  chatStructured?<T>(messages: Message[], schema: JsonSchema, temperature?: number): Promise<T>
}
```

`src/model/registry.ts` picks `OpenAICompatibleProvider` or `AnthropicCompatibleProvider` from config, adds a `chatStructured` fallback (JSON-schema prompt + `extractJsonBlock`/`repairMalformedJson`) when a provider lacks native structured output, and optionally wraps everything in `DebugModelProvider` when debug is enabled.
