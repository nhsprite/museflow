# MuseFlow — Agent Context

AI Native 长篇小说生成 CLI 工具。LangGraph 编排多 Agent 协作，本地 JSON + 文件系统存储。

## Essential Commands

| Task | Command |
|------|---------|
| Dev (watch) | `npm run dev` — tsx watch src/cli/index.ts |
| Run CLI | `npm start -- <command> [args]` — runs via tsx without building |
| Build | `npm run build` — `tsc` only, outputs to `dist/` |
| Type check | `npm run typecheck` — `tsc --noEmit` |
| Test all | `npm test` — vitest run |
| Test watch | `npm run test:watch` |
| Lint | `npm run lint` — eslint (no config file present; fails if rules are violated) |

**Build is required before `npm start` only if you want to run the compiled JS.** For daily dev, use `npm start` or `npm run dev` which run tsx directly.

## TypeScript & Module Rules

- **ESM only** (`"type": "module"`). All source imports must use `.js` extensions (e.g. `import { x } from './foo.js'`).
- **No path aliases in source**. `tsconfig.json` has no `paths` mapping. The `@/` alias exists **only in tests** via `vitest.config.ts`.
- **Strict flags enabled**: `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noImplicitReturns`, `noFallthroughCasesInSwitch`. Do not suppress these.
- **Target**: Node 20+, ES2022, `NodeNext` module resolution.

## Project Structure

```
src/
  cli/          Commander CLI entry (index.ts wires all commands)
  graph/        LangGraph state graph (novel.graph.ts), nodes, edges, checkpointer
  agents/       10 agent implementations (worldbuilder, character, story-arc, chapter-outline, chapter-planner, chapter, foreshadowing, consistency, fix, summary)
  core/         Runner, chapter commit boundary, JIT outline expansion, chapter-generation routing
  genres/       Built-in genre skill system + registry
  storage/      JSON metadata (meta/index.ts), checkpoint service, filesystem writer
  model/        ModelProvider abstraction + registry
  types/        Shared TS interfaces
  utils/        Helpers (paths, id gen, logger, chapter display)
tests/          Vitest tests (mirror src structure)
books/          Runtime story output (gitignored)
docs/specs/     Design docs (human-readable)
docs/superpowers/  Implementation plans from agent sessions
```

## Storage Architecture (Critical)

**MuseFlow uses JSON + filesystem storage only. It does NOT use SQLite.**

- **Metadata**: `books/{storyId}/meta.json` — single JSON file per story with world, characters, outline, chapter summaries.
- **Chapter content**: `books/{storyId}/chapters/chapter_{n}.md` — one Markdown file per chapter.
- **Checkpoints**: `books/{storyId}/checkpoints/` — JSON files for LangGraph checkpoint recovery. Custom `JsonCheckpointer` class.
- **Reports**: `books/{storyId}/reports/chapter_{n}.report.json` — per-chapter generation reports.
- **User config**: `~/.museflow/config.json` — API keys, provider, model.

Do not add SQLite migrations or SQL queries.

## CLI Command Flow

1. `start` — creates story, runs worldbuilding → characters → story arc. It writes an empty per-chapter outline scaffold and stops before body text.
2. `write <story-id>` — writes one chapter. It runs prepare → converge/decide → JIT chapter outline/plan → draft or fix → comprehensive validation → converge/decide → finalize.
3. `continue <story-id>` — resumes from the latest checkpoint and applies the same one-chapter write loop.
4. `rewrite <story-id>` — rewrites the current or specified chapter from a chapter marker checkpoint, truncating downstream chapter content through code.
5. `adjust-act <story-id>` — manually adjusts act boundaries when mandatory beats need more chapters.

The graph supports **breakpoint recovery**. If validation cannot converge, it writes a blocking report and the user must run `rewrite` or resolve the prompted outline-vs-canonical conflict.

## Runtime Architecture

- **Checkpoint is the source of truth**: `books/{storyId}/checkpoints/latest.json` points to the latest LangGraph state. `meta.json` is a projection for CLI display and external inspection.
- **Chapter commit boundary**: after `graph.invoke()` returns, `src/core/chapter-commit.ts` saves the finalized chapter marker from the persisted checkpoint and exports the `meta.json` projection. Do not duplicate that marker/export sequence in command code.
- **JIT outline expansion**: `src/core/outline-expander.ts` generates a chapter outline and `ChapterPlan` immediately before drafting, using story arc progress, prior summaries, story state, pending tasks, and next-chapter boundary hints.
- **Validation loop**: `validate_chapter_comprehensive` aggregates word-count, continuity, foreshadowing, and consistency checks. `core/chapter-generation/routing` decides whether to draft, fix, finalize, or stop for manual rewrite.
- **Finalization**: `src/graph/services/finalization/chapter.ts` extracts summary/state/canonical facts, verifies mandatory beats, updates act progress, writes chapter reports, and returns state updates without mutating the input graph state.
- **Verified constraints**: runtime `verifiedConstraints` are structured objects. Render them to strings only at agent prompt boundaries; do not classify constraints by parsing natural-language prompt text.

## Testing Conventions

- **Framework**: Vitest with globals enabled.
- **Mocking model calls**: Tests mock `src/model/registry.ts` via `vi.mock()` and inject a `ModelProvider` with a `vi.fn()` chat function.
- **Testing private methods**: Extend the agent class to expose protected methods (see `tests/agents/worldbuilder.test.ts`).
- **File system tests**: Use real temp dirs under `tests/`; clean up in `afterEach`.
- **Test timeout**: 10s default.

## Environment & Constraints

- **Node >= 20** required.
- **No CI configured** (no `.github/workflows/`).
- **No ESLint config file** — the lint script runs with default ESLint + @typescript-eslint rules.
- `books/`, `.museflow/`, `dist/`, `coverage/` are gitignored.
- The `.opencode/package.json` is for the OpenCode plugin runtime — do not modify unless working on the plugin itself.

## Agent Prompt Design Rules

All agent prompts must follow these principles:

1. **Neutrality**: Prompts must express generic writing conventions, not rules tailored to a specific book, genre, or story. Do not hard-code genre-specific concepts (e.g., "previous life memory", "fate prophecy", "cultivation realms") into prompts.
2. **Abstraction over Example**: When forbidding patterns, state the abstract rule (e.g., "Do not end chapters with explicit chapter-end markers") rather than enumerating specific examples (e.g., "Do not use 'To be continued', '(End of Chapter)', 'Chapter X · Complete'").
3. **Configurable over Hard-coded**: Word-count requirements, genre conventions, and style rules must be read from `GenreSkill` / config, not baked into prompt strings.
4. **No Story Spoilers**: Agents must not reference future plot points, character arcs, or twists from the outline when checking current-chapter content.

## Code Architecture Rules

1. **No Story-Specific Hardcoding**: Never hardcode character names, item names, locations, or plot-specific keywords in source code (e.g., `desc.includes('孙悟空')`, `desc.includes('木之灵物')`). These are temporary patches that break when writing different stories. Such logic belongs in prompts or configuration, not in code.
2. **No Duplicate Filters**: Do not implement the same filtering/demotion logic in multiple places (e.g., both `write.ts` and `consistency.ts`). Centralize post-processing in the agent's `processOutput` method.
3. **Fix Root Causes, Not Symptoms**: When an agent consistently misjudges a certain scenario, fix the agent's prompt or input context rather than adding hardcoded post-processing rules to downgrade specific outputs.
4. **No Natural-Language String Matching for Semantics (Critical)**: Runtime code must not use natural-language characters, keywords, phrases, fragments, regular expressions, n-gram overlap, LCS/fuzzy text similarity, or `includes`/`startsWith`/`endsWith`/`match` against prose to make semantic decisions. This is strictly forbidden even when the rule is generic rather than story-specific.
   - Forbidden uses include state/canonical fact updates, issue filtering or demotion, issue routing/classification, act or mandatory-beat verification, foreshadow filtering, outline-vs-state conflict decisions, pending-task resolution, paragraph/sentence repair targeting, and any other behavior that changes story state or control flow based on prose content.
   - Use structured data instead: stable IDs, enums, typed fields, explicit issue codes, subject/attribute/value records, evidence offsets/spans, chapter/paragraph/sentence indexes, structured model output with JSON schema, or author/config decisions.
   - Existing natural-language matching logic is technical debt to remove. Do not add new matching logic and do not extend existing matching logic while fixing bugs.
   - The only allowed string/regex matching is non-semantic parsing of machine-readable formats or explicit delimiters, such as JSON repair, Markdown/code fences, CLI flags, file names, checkpoint IDs, protocol names, and agent output section markers. If the input is story prose, issue prose, outline prose, summary prose, or prompt prose, matching its natural-language content is not allowed for decisions.

## Data Integrity Rules (Critical)

1. **Never modify `books/` directory directly**: The `books/` directory contains runtime-generated story data (meta.json, chapters, checkpoints). Direct modification causes data inconsistency, breaks reproducibility, and hides real code defects. All data changes must be driven by code logic or CLI commands.
2. **Code fixes over data patches**: When story data has errors (e.g., contradictory timeline, wrong character status), fix the code that generates or consumes the data (agents, runners, checkpointers) — never hand-edit the data files.
3. **Git does not track `books/`**: Since `books/` is `.gitignore`d, manual changes have no history and cannot be reverted. This makes debugging impossible.
4. **Checkpoint consistency**: Checkpoints, timeline snapshots, and meta.json reference each other. Modifying one without updating others creates orphaned references.

## Adding a New Agent

1. Create class in `src/agents/{name}.ts` extending the base agent pattern.
2. Add a thin node function under `src/graph/nodes/` or a focused service under `src/graph/services/` that instantiates and calls the agent through `src/graph/agent-factory.ts`.
3. Wire the node into `src/graph/novel.graph.ts`.
4. Add tests in `tests/agents/{name}.test.ts` mocking the model registry.
5. Ensure the agent returns partial state updates that merge into `GraphState`.

## Model Provider Setup

Providers are configured via CLI: `npm start -- config set --provider <openai|minimax|local> --api-key ... --model ...`

The `ModelProvider` interface is simple: `chat(messages, temperature?) => Promise<string>`.
