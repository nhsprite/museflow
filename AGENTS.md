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
  agents/       8 agent implementations (worldbuilder, character, outline, chapter, quality, foreshadowing, hallucination, consistency)
  core/         Runner (runStory, continueStory, getState)
  genres/       Built-in genre skill system + registry
  storage/      JSON metadata (database/index.ts) + filesystem writer
  model/        ModelProvider abstraction + registry
  types/        Shared TS interfaces
  utils/        Helpers (paths, id gen, logger, chapter display)
tests/          Vitest tests (mirror src structure)
books/          Runtime story output (gitignored)
docs/specs/     Design docs (human-readable)
docs/superpowers/  Implementation plans from agent sessions
```

## Storage Architecture (Critical)

Despite the `sql.js` dependency, **MuseFlow does NOT use SQLite** for story data.

- **Metadata**: `books/{storyId}/meta.json` — single JSON file per story with world, characters, outline, chapter summaries.
- **Chapter content**: `books/{storyId}/chapters/chapter_{n}.md` — one Markdown file per chapter.
- **Checkpoints**: `books/{storyId}/checkpoints/` — JSON files for LangGraph checkpoint recovery. Custom `JsonCheckpointer` class.
- **User config**: `~/.museflow/config.json` — API keys, provider, model.

Do not add SQLite migrations or SQL queries. The `sql.js` dep is a remnant / future placeholder.

## CLI Command Flow

1. `start` — creates story, runs worldbuilding → characters → outline. Stops before writing.
2. `write <story-id>` — runs the full graph: draft → validate → quality → foreshadowing → hallucination → consistency → outline compliance → auto-fix → finalize. Stops after one chapter.
3. `continue <story-id>` — resumes from last checkpoint.
4. `rewrite <story-id>` — rewrites the current chapter from scratch.
5. `fix <story-id>` — targeted fix of current chapter issues (not full rewrite).

The graph supports **breakpoint recovery**: if validation agents flag errors, the graph pauses and the user must run `rewrite` or `fix`.

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

## Data Integrity Rules (Critical)

1. **Never modify `books/` directory directly**: The `books/` directory contains runtime-generated story data (meta.json, chapters, checkpoints). Direct modification causes data inconsistency, breaks reproducibility, and hides real code defects. All data changes must be driven by code logic or CLI commands.
2. **Code fixes over data patches**: When story data has errors (e.g., contradictory timeline, wrong character status), fix the code that generates or consumes the data (agents, runners, checkpointers) — never hand-edit the data files.
3. **Git does not track `books/`**: Since `books/` is `.gitignore`d, manual changes have no history and cannot be reverted. This makes debugging impossible.
4. **Checkpoint consistency**: Checkpoints, timeline snapshots, and meta.json reference each other. Modifying one without updating others creates orphaned references.

## Adding a New Agent

1. Create class in `src/agents/{name}.ts` extending the base agent pattern.
2. Add node function in `src/graph/nodes.ts` that instantiates and calls the agent.
3. Wire the node into `src/graph/novel.graph.ts`.
4. Add tests in `tests/agents/{name}.test.ts` mocking the model registry.
5. Ensure the agent returns partial state updates that merge into `GraphState`.

## Model Provider Setup

Providers are configured via CLI: `npm start -- config set --provider <openai|minimax|local> --api-key ... --model ...`

The `ModelProvider` interface is simple: `chat(messages, temperature?) => Promise<string>`.
