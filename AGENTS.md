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

## Adding a New Agent

1. Create class in `src/agents/{name}.ts` extending the base agent pattern.
2. Add node function in `src/graph/nodes.ts` that instantiates and calls the agent.
3. Wire the node into `src/graph/novel.graph.ts`.
4. Add tests in `tests/agents/{name}.test.ts` mocking the model registry.
5. Ensure the agent returns partial state updates that merge into `GraphState`.

## Model Provider Setup

Providers are configured via CLI: `npm start -- config set --provider <openai|minimax|local> --api-key ... --model ...`

The `ModelProvider` interface is simple: `chat(messages, temperature?) => Promise<string>`.
