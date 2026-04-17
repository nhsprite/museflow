# MuseFlow Implementation Plan

> Date: 2025-04-17
> Status: Drafted for implementation
> Source: `docs/specs/2025-04-17-museflow-design.md`

## 1. Scope And Assumptions

This plan assumes:

- The repository is greenfield. The only existing project artifact is the confirmed design document.
- MuseFlow is a single-process TypeScript/Node.js CLI application.
- SQLite stores metadata and durable context state; the filesystem stores chapter manuscripts and exported artifacts.
- The first usable release is the core writing workflow. `export` is planned as a later completion phase, not as a blocker for the first end-to-end writing release.
- Rewrites are never automatic. The pipeline must surface rewrite findings and require explicit user confirmation before generating a replacement chapter.
- TDD is required for all business logic and command behavior. The only non-TDD exception is base project scaffolding in Phase 0.

## 2. Implementation Principles

### 2.1 Delivery Strategy

- Build the system as a sequence of thin, testable vertical slices.
- Prefer stable local abstractions over premature framework complexity.
- Keep orchestration synchronous at the application layer even if some providers use async I/O.
- Treat the design doc as the source of truth, but explicitly close design gaps during implementation where required for execution.

### 2.2 Key Technical Clarifications To Lock Early

The design document leaves several implementation details implied but not fully specified. These should be resolved in the first storage and domain slice:

1. Add an `outline` table because the design describes it but does not define its SQL schema.
2. Add a `context_snapshot` table because memory + SQLite dual-write cannot be recovered cleanly from `story`, `world`, `character`, and `chapter` alone.
3. Add story-level metadata fields for `genre`, `provider`, and `output_dir`, because the CLI and recovery flows need them.
4. Run SQLite in WAL mode with a write-serialization boundary to reduce `SQLITE_BUSY` risk in later concurrent command flows.
5. Keep plugin execution in-process for v1, but isolate failures with strict validation and error boundaries.

### 2.3 TDD Rules

For every implementation slice:

1. Write failing tests first.
2. Implement the minimum code to satisfy the slice.
3. Refactor only after tests pass.
4. Do not mix unrelated behaviors in the same commit.
5. Use behavior-focused tests at the module boundary, not implementation-detail tests.

## 3. Phase Overview

| Phase | Goal | Depends On | Parallelism | Exit Criteria |
|---|---|---|---|---|
| 0 | Bootstrap tooling and test harness | None | Low | Project installs, typechecks, and runs tests |
| 1 | Establish domain model and storage foundation | 0 | Medium | Story data can be created, persisted, and reloaded |
| 2 | Add config, provider abstraction, and genre system | 0, 1 | High | Runtime can resolve provider + genre deterministically |
| 3 | Implement LangGraph state, nodes, edges, and checkpointer | 1, 2 | High | StateGraph compiles and can be invoked with fake agents |
| 4 | Implement 8 agents (as node-internal LLM wrappers) and bind to graph | 2, 3 | High | Graph nodes call real agents; interrupt/retry behavior works |
| 5 | Add CLI commands for story lifecycle | 3, 4 | High | `start`, `continue`, `status`, `info`, `config`, `genres` are usable |
| 6 | Add export subsystem | 1, 5 | Medium | Completed stories can export to EPUB and PDF |
| 7 | Harden, document, and verify end-to-end flows | All prior phases | Medium | Full local workflow passes integration and e2e checks |

## 4. Detailed Phase Plan

## Phase 0. Bootstrap Tooling And Test Harness

### Goal

Create the minimum project skeleton required to support strict TypeScript development and fast TDD loops.

### Files To Create

| Path | What It Should Contain |
|---|---|
| `package.json` | Project metadata, `bin` entry, scripts for `build`, `test`, `typecheck`, `lint`, `start:dev` |
| `tsconfig.json` | Strict TypeScript config, CommonJS or ESM decision, output to `dist/` |
| `vitest.config.ts` | Test runner config, temp test environment defaults, coverage config |
| `.gitignore` | Ignore `dist/`, `node_modules/`, `.sqlite`, WAL files, `outputs/`, `.museflow/` temp fixtures |
| `README.md` | Short project description, local setup, script usage, current status |
| `tests/smoke/project-smoke.test.ts` | Minimal test that verifies the package can load core modules without runtime failure |

### TDD Order

1. Add `tests/smoke/project-smoke.test.ts`.
2. Add package/tooling files until the smoke test runs.
3. Add `typecheck` and `test` scripts.
4. Confirm a clean `npm test` and `npm run typecheck`.

### Parallelizable Work

- `README.md` can be written in parallel with `package.json` and `tsconfig.json`.
- `.gitignore` and `vitest.config.ts` can be done in parallel once scripts are decided.

### Done When

- Dependencies install cleanly.
- Tests run locally.
- TypeScript strict mode is enabled.
- The repository is ready for red-green-refactor work.

## Phase 1. Domain Model And Storage Foundation

### Goal

Create the persistence backbone for stories, chapters, outlines, characters, world state, and runtime context recovery.

### Files To Create

| Path | What It Should Contain |
|---|---|
| `src/types/story.ts` | `Story`, `StoryStatus`, `StorySettings`, story persistence types |
| `src/types/chapter.ts` | `Chapter`, `ChapterStatus`, foreshadow and summary payload types |
| `src/types/character.ts` | Character entity and related DTOs |
| `src/types/agent.ts` | `AgentResult`, review issue types, run status types |
| `src/types/context.ts` | `AgentContext`, `ContextSnapshot`, foreshadow stack, chapter summary history |
| `src/utils/id.ts` | Story/chapter/entity ID generation |
| `src/utils/logger.ts` | Small logging wrapper with human-readable and test-safe output |
| `src/utils/paths.ts` | Resolve config path, output path, story workspace paths |
| `src/storage/database/index.ts` | SQLite connection bootstrap, WAL setup, busy timeout, transaction helpers |
| `src/storage/database/schema.ts` | Complete SQL schema and bootstrap migration runner |
| `src/storage/database/dao/story.ts` | CRUD for story rows and story-level settings |
| `src/storage/database/dao/world.ts` | CRUD for world document |
| `src/storage/database/dao/character.ts` | CRUD for character records |
| `src/storage/database/dao/outline.ts` | CRUD for full-book outline and chapter plan rows |
| `src/storage/database/dao/chapter.ts` | CRUD for chapter metadata, summaries, foreshadows, review state |
| `src/storage/database/dao/context.ts` | Read/write serialized runtime context snapshots |
| `src/storage/filesystem/writer.ts` | Create story folders and write chapter markdown safely |
| `src/core/context.ts` | In-memory context builder, serializer, loader from SQLite + filesystem |
| `tests/storage/database/schema.test.ts` | Verifies tables, indexes, and bootstrap behavior |
| `tests/storage/database/story-dao.test.ts` | Story DAO behavior against temp SQLite |
| `tests/storage/database/world-dao.test.ts` | World DAO behavior |
| `tests/storage/database/character-dao.test.ts` | Character DAO behavior |
| `tests/storage/database/outline-dao.test.ts` | Outline DAO behavior |
| `tests/storage/database/chapter-dao.test.ts` | Chapter DAO behavior |
| `tests/storage/database/context-dao.test.ts` | Context snapshot persistence behavior |
| `tests/storage/filesystem/writer.test.ts` | Chapter file writing and overwrite safety |
| `tests/core/context.test.ts` | Context assembly and recovery behavior |

### Required Schema Additions

The storage layer should extend the design doc with:

- `outline` table
- `context_snapshot` table
- `story.genre`
- `story.provider`
- `story.output_dir`

### TDD Order

1. Write schema tests.
2. Write DAO tests against a temp database.
3. Implement `schema.ts` and database bootstrap.
4. Implement DAOs.
5. Write filesystem writer tests.
6. Implement chapter markdown writer.
7. Write context recovery tests.
8. Implement `src/core/context.ts`.

### Parallelizable Work

- DAO files can be built in parallel after `schema.ts` is stable.
- Filesystem writer can proceed in parallel with DAO work.
- `story.ts`, `chapter.ts`, `character.ts`, `context.ts` type files can be done in parallel.

### Done When

- A story workspace can be created.
- Metadata can be inserted and reloaded.
- Context can be reconstructed after process restart.
- Chapter markdown can be written to `outputs/{story_id}/chapters/`.

## Phase 2. Config, Provider Abstraction, And Genre System

### Goal

Make model selection, provider wiring, and genre prompt selection deterministic and testable.

### Files To Create

| Path | What It Should Contain |
|---|---|
| `src/types/config.ts` | Config schema and defaults |
| `src/types/genre.ts` | `GenreSkill`, registry result types, custom genre metadata |
| `src/config/store.ts` | Read/write `~/.museflow/config.json`, validation, defaults merge |
| `src/model/provider.ts` | Provider interface and message types |
| `src/model/registry.ts` | Resolve current provider from config and construct provider instances |
| `src/model/openai.ts` | OpenAI provider adapter |
| `src/model/minimax.ts` | MiniMax provider adapter |
| `src/model/local.ts` | Local model provider adapter |
| `src/genres/base.ts` | `GenreSkill` contract and runtime validation helpers |
| `src/genres/registry.ts` | Builtin + custom genre discovery, precedence rules, loading API |
| `src/genres/builtin/default/index.ts` | Default neutral genre package |
| `src/genres/builtin/default/prompts/worldbuilding.md` | Default worldbuilding prompt |
| `src/genres/builtin/default/prompts/chapter.md` | Default chapter supplement prompt |
| `src/genres/builtin/default/templates/outline.md` | Default outline template |
| `src/genres/builtin/fantasy/index.ts` | Fantasy genre package |
| `src/genres/builtin/fantasy/prompts/worldbuilding.md` | Fantasy worldbuilding prompt |
| `src/genres/builtin/fantasy/prompts/chapter.md` | Fantasy chapter supplement prompt |
| `src/genres/builtin/fantasy/templates/outline.md` | Fantasy outline template |
| `src/genres/builtin/xianxia/index.ts` | Xianxia genre package |
| `src/genres/builtin/xianxia/prompts/worldbuilding.md` | Xianxia worldbuilding prompt |
| `src/genres/builtin/xianxia/prompts/chapter.md` | Xianxia chapter supplement prompt |
| `src/genres/builtin/xianxia/templates/outline.md` | Xianxia outline template |
| `src/genres/builtin/scifi/index.ts` | Sci-fi genre package |
| `src/genres/builtin/scifi/prompts/worldbuilding.md` | Sci-fi worldbuilding prompt |
| `src/genres/builtin/scifi/prompts/chapter.md` | Sci-fi chapter supplement prompt |
| `src/genres/builtin/scifi/templates/outline.md` | Sci-fi outline template |
| `src/genres/builtin/horror/index.ts` | Horror genre package |
| `src/genres/builtin/horror/prompts/worldbuilding.md` | Horror worldbuilding prompt |
| `src/genres/builtin/horror/prompts/chapter.md` | Horror chapter supplement prompt |
| `src/genres/builtin/horror/templates/outline.md` | Horror outline template |
| `src/genres/builtin/urban/index.ts` | Urban genre package |
| `src/genres/builtin/urban/prompts/worldbuilding.md` | Urban worldbuilding prompt |
| `src/genres/builtin/urban/prompts/chapter.md` | Urban chapter supplement prompt |
| `src/genres/builtin/urban/templates/outline.md` | Urban outline template |
| `src/genres/builtin/romance/index.ts` | Romance genre package |
| `src/genres/builtin/romance/prompts/worldbuilding.md` | Romance worldbuilding prompt |
| `src/genres/builtin/romance/prompts/chapter.md` | Romance chapter supplement prompt |
| `src/genres/builtin/romance/templates/outline.md` | Romance outline template |
| `tests/config/store.test.ts` | Config read/write and default merge behavior |
| `tests/model/provider-contract.test.ts` | Shared provider contract tests using fakes |
| `tests/model/openai.test.ts` | OpenAI adapter request/response mapping |
| `tests/model/minimax.test.ts` | MiniMax adapter behavior |
| `tests/model/local.test.ts` | Local provider behavior |
| `tests/genres/registry.test.ts` | Builtin load order, custom override, invalid package handling |
| `tests/fixtures/genres/custom-minimal/index.ts` | Minimal valid custom genre fixture |
| `tests/fixtures/genres/custom-override/index.ts` | Valid override fixture for registry precedence tests |

### TDD Order

1. Write config store tests.
2. Implement config store.
3. Write provider contract tests.
4. Implement `provider.ts` and `registry.ts`.
5. Write per-provider adapter tests.
6. Implement provider adapters.
7. Write genre registry tests.
8. Implement genre base and registry.
9. Add builtin genre packages one by one, each with a load test.

### Parallelizable Work

- Provider adapters can be built in parallel after `provider.ts` and `registry.ts` exist.
- Builtin genre packages can be authored in parallel after `GenreSkill` is stable.
- Config store is independent from builtin genre content and can proceed in parallel.

### Done When

- Config loads from `~/.museflow/config.json`.
- The runtime can instantiate a provider from config.
- All builtin genres load successfully.
- A custom genre can override a builtin genre by name.

## Phase 3. LangGraph State, Nodes, Edges, And Checkpointer

### Goal

Build the LangGraph state machine that orchestrates the entire novel generation workflow, without depending on real agent implementations yet.

### Files To Create

| Path | What It Should Contain |
|---|---|
| `src/graph/state.ts` | `GraphState` interface, all type aliases, StateSchema |
| `src/graph/nodes.ts` | All node functions (`build_world`, `create_characters`, `create_outline`, `draft_chapter`, `quality_pass`, `detect_foreshadowing`, `detect_hallucination`, `detect_consistency`, `request_rewrite`, `save_checkpoint`, `finalize_chapter`, `finalize_story`) |
| `src/graph/edges.ts` | Conditional edge functions (`should_continue`, `after_user_confirmation`, `should_start_chapters`) |
| `src/graph/novel.graph.ts` | `new StateGraph(...)` construction, node registration, edge registration, `.compile({ checkpointer })` |
| `src/graph/checkpointer.ts` | `SqliteSaver` factory / wrapper for `~/.museflow/checkpoints/` |
| `src/core/runner.ts` | Public API: `runStory(input)`, `continueStory(storyId)`, `getState(storyId)`, `resumeFromInterrupt(storyId, userResponse)` |
| `tests/graph/state.test.ts` | GraphState type validity, partial state updates |
| `tests/graph/nodes.test.ts` | Node function signatures, input/output contract (using fakes) |
| `tests/graph/edges.test.ts` | Edge function branch coverage |
| `tests/graph/compile.test.ts` | Graph compiles without error, get_graph() produces expected structure |
| `tests/graph/checkpointer.test.ts` | Checkpoint file creation and state recovery |
| `tests/core/runner.test.ts` | Runner API contract, interrupt handling |

### TDD Order

1. Write `GraphState` type tests.
2. Implement `state.ts`.
3. Write node contract tests (using fakes for agents).
4. Implement node functions (stubs that return fixed fake data).
5. Write edge function tests.
6. Implement edge functions.
7. Write `checkpointer.ts` tests.
8. Implement checkpointer.
9. Write `novel.graph.ts` compile tests.
10. Implement graph construction.
11. Write `runner.ts` tests.
12. Implement runner API.

### Parallelizable Work

- Node functions in `nodes.ts` can be authored in parallel once `GraphState` is stable.
- Edge functions are independent from each other once `GraphState` is stable.
- `checkpointer.ts` can proceed in parallel with node/edge work.

### Done When

- `new NovelGraph().compile()` succeeds without errors.
- `graph.invoke(initialInput)` produces expected state transitions.
- `graph.getState({ config })` returns the saved state after a node runs.
- `interrupt()` causes the graph to pause and `resume()` accepts user input.
- The graph structure matches the diagram in the design doc (planning phase → chapter loop → finalize).

## Phase 4. Agents and Graph Binding

### Goal

Replace the node function stubs with real agent implementations, and wire each node to the correct agent.

### Files To Create

| Path | What It Should Contain |
|---|---|
| `src/agents/base.ts` | `BaseAgent` class, prompt assembly helpers, LLM call abstraction |
| `src/agents/worldbuilder.ts` | World building agent implementation |
| `src/agents/character.ts` | Character creation agent implementation |
| `src/agents/outline.ts` | Outline generation agent implementation |
| `src/agents/chapter.ts` | Chapter drafting agent implementation |
| `src/agents/quality.ts` | Quality pass agent implementation |
| `src/agents/foreshadowing.ts` | Foreshadowing detection agent implementation |
| `src/agents/hallucination.ts` | Hallucination detection agent implementation |
| `src/agents/consistency.ts` | Consistency checking agent implementation |
| `tests/agents/base.test.ts` | Base agent contract tests |
| `tests/agents/worldbuilder.test.ts` | World builder agent behavior |
| `tests/agents/character.test.ts` | Character agent behavior |
| `tests/agents/outline.test.ts` | Outline agent respects exact chapter count |
| `tests/agents/chapter.test.ts` | Chapter agent prompt composition |
| `tests/agents/quality.test.ts` | Quality pass behavior |
| `tests/agents/foreshadowing.test.ts` | Foreshadowing extraction behavior |
| `tests/agents/hallucination.test.ts` | Hallucination detection behavior |
| `tests/agents/consistency.test.ts` | Consistency detection behavior |
| `tests/graph/integration.test.ts` | Real agents called through graph nodes end-to-end |

### TDD Order

1. Write `BaseAgent` contract tests.
2. Implement `BaseAgent`.
3. Write and implement each agent in isolation with tests.
4. Write integration tests that verify graph nodes call the correct agents with correct inputs.
5. Verify interrupt/retry flow end-to-end with real agents.

### Parallelizable Work

- All 8 agents can be implemented in parallel after `BaseAgent` and `GraphState` are stable.
- Integration tests can be authored in parallel once all agents are wired.

### Done When

- Every node function calls a real agent (not a stub).
- `draft_chapter` correctly reads `state.outline[state.currentChapterIndex]` as input.
- `detect_foreshadowing` correctly updates `state.foreshadowStack`.
- `detect_hallucination` and `detect_consistency` populate `state.pendingIssues`.
- When `state.pendingIssues.length > 0`, the graph calls `request_rewrite` and hits `interrupt()`.
- User approval via `resumeFromInterrupt` routes correctly back to `draft_chapter`.

## Phase 5. CLI Story Lifecycle Commands

### Goal

Expose the core system through the required command set.

### Files To Create

| Path | What It Should Contain |
|---|---|
| `src/cli/index.ts` | Main CLI entry, command registration, shared error handling |
| `src/cli/commands/start.ts` | `museflow start --idea ... --chapters ... --genre ...` |
| `src/cli/commands/continue.ts` | `museflow continue [--chapter n]` with rewrite confirmation prompt |
| `src/cli/commands/status.ts` | Current story progress, next actionable state, pending issues |
| `src/cli/commands/info.ts` | Story metadata, genre, provider, chapter stats, storage paths |
| `src/cli/commands/config.ts` | Interactive and non-interactive config editing/show flows |
| `src/cli/commands/genres.ts` | List, install, uninstall, and inspect genre packages |
| `tests/cli/start.test.ts` | Start command argument validation and story bootstrap behavior |
| `tests/cli/continue.test.ts` | Continue command happy path and rewrite-confirmation flow |
| `tests/cli/status.test.ts` | Status rendering behavior |
| `tests/cli/info.test.ts` | Info rendering behavior |
| `tests/cli/config.test.ts` | Config command behavior |
| `tests/cli/genres.test.ts` | Genre list/install/uninstall behavior |

### TDD Order

1. Write `start` and `continue` command tests first because they define the core UX.
2. Implement `src/cli/index.ts`.
3. Implement `start.ts`.
4. Implement `continue.ts`.
5. Add and implement `status.ts` and `info.ts`.
6. Add and implement `config.ts`.
7. Add and implement `genres.ts`.

### Parallelizable Work

- `status.ts` and `info.ts` can be implemented in parallel.
- `config.ts` and `genres.ts` can be implemented in parallel after config store and genre registry exist.
- `start.ts` and `continue.ts` should be developed separately, but `continue.ts` depends on the chapter pipeline.

### Done When

- The CLI supports the required non-export command set.
- A user can start a story, continue it, inspect it, manage config, and manage genres.
- Rewrite confirmation is interactive and safe by default.

## Phase 6. Export Subsystem

### Goal

Convert a completed story into deliverable book formats.

### Files To Create

| Path | What It Should Contain |
|---|---|
| `src/cli/commands/export.ts` | Export command entry and argument handling |
| `src/export/assemble.ts` | Build a full-book manuscript from chapter markdown and metadata |
| `src/export/epub.ts` | EPUB generation adapter |
| `src/export/pdf.ts` | PDF generation adapter |
| `tests/export/assemble.test.ts` | Manuscript assembly behavior |
| `tests/export/epub.test.ts` | EPUB export behavior |
| `tests/export/pdf.test.ts` | PDF export behavior |
| `tests/cli/export.test.ts` | Export command behavior and completed-story validation |

### TDD Order

1. Write manuscript assembly tests.
2. Implement `assemble.ts`.
3. Write exporter tests.
4. Implement `epub.ts` and `pdf.ts`.
5. Write export command tests.
6. Implement `export.ts`.

### Parallelizable Work

- `epub.ts` and `pdf.ts` can be implemented in parallel after `assemble.ts`.
- `export.ts` can begin once exporter interfaces are stable.

### Done When

- Completed stories can export to EPUB and PDF.
- Export refuses incomplete stories with clear messaging.
- Export output lands in a deterministic story output location.

## Phase 7. Hardening, Documentation, And End-To-End Verification

### Goal

Make the project reliable enough for sustained ultrawork execution and future implementation waves.

### Files To Create

| Path | What It Should Contain |
|---|---|
| `tests/e2e/start-to-finish.test.ts` | Full story lifecycle with fake provider |
| `tests/e2e/restart-recovery.test.ts` | Recover state after process restart |
| `tests/e2e/rewrite-confirmation.test.ts` | Rewrite blocked until user confirms |
| `tests/e2e/custom-genre-install.test.ts` | Custom genre install and load flow |
| `tests/e2e/export-complete-story.test.ts` | Export after story completion |
| `README.md` | Expanded usage, architecture summary, development workflow, test instructions |

### TDD Order

1. Add restart recovery e2e test.
2. Add rewrite confirmation e2e test.
3. Add custom genre e2e test.
4. Add full lifecycle e2e test.
5. Fix any module boundaries exposed by e2e failures.
6. Expand README last.

### Parallelizable Work

- E2E tests can be authored in parallel once the CLI surface is stable.
- README updates can proceed in parallel with final QA.

### Done When

- The core user journey is covered by end-to-end tests.
- Recovery from persisted state is verified.
- Custom genre behavior is verified.
- The project is ready for implementation acceleration.

## 5. Dependency Graph

### Phase Dependencies

- Phase 0 precedes everything.
- Phase 1 is the foundation for all runtime behavior.
- Phase 2 can overlap with late Phase 1 work once base types and path helpers exist.
- Phase 3 depends on storage, config, providers, and genres.
- Phase 4 depends on the Phase 3 agent contract and Phase 1 persistence.
- Phase 5 depends on the core services and pipeline from Phases 3 and 4.
- Phase 6 depends on Phase 5 because export is a command surface.
- Phase 7 depends on all prior phases.

### Task-Level Dependencies

- `src/graph/state.ts` must exist before any node or edge implementation.
- `src/graph/checkpointer.ts` must exist before `novel.graph.ts`.
- `src/graph/novel.graph.ts` must exist before `src/core/runner.ts`.
- `src/agents/base.ts` must exist before all 8 agent files.
- All 8 agents must exist before `tests/graph/integration.test.ts` can be written.
- `src/types/context.ts` removed (replaced by `GraphState` in `graph/state.ts`).
- `src/core/context.ts` removed (replaced by `checkpointer.ts` + `GraphState`).
- `src/core/pipeline.ts` removed (replaced by `graph/novel.graph.ts` + `graph/nodes.ts`).

## 6. Parallel Execution Plan For Ultrawork

After Phase 0, the project can split into four lanes.

| Lane | Scope | Earliest Start | Merge Gate |
|---|---|---|---|
| A | Storage and context foundation | After Phase 0 | Phase 1 complete |
| B | Config, providers, and genre system | After Phase 0 plus base types | Phase 2 complete |
| C | Agent framework and review pipeline | After Phases 1 and 2 | Phase 4 complete |
| D | CLI command layer | After core services are stable | Phase 5 complete |

### Recommended Ultrawork Waves

1. Wave 1: Phase 0 and Phase 1.
2. Wave 2: Phase 2 in parallel with Phase 1 cleanup.
3. Wave 3: `graph/state`, `graph/checkpointer`, `graph/nodes`, `graph/edges` in parallel.
4. Wave 4: All 8 agents in parallel (after `graph/state.ts` and `agents/base.ts` stabilize).
5. Wave 5: `graph/novel.graph.ts` + `core/runner.ts` in parallel with agent implementations.
6. Wave 6: CLI commands in parallel.
7. Wave 7: `export` and e2e hardening.

### Parallel Tasks That Are Safe

- `nodes.ts` node functions after `GraphState` is stable.
- Edge functions in parallel after `GraphState` is stable.
- All 8 agents in parallel after `BaseAgent` and `GraphState` are stable.
- CLI commands in parallel after `core/runner.ts` is stable.
- E2E tests in parallel once the CLI surface is stable.

### Parallel Tasks That Should Not Split Too Early

- `graph/state.ts` — all other graph files depend on it
- `graph/novel.graph.ts` — defines the contract for the entire workflow
- `core/runner.ts` — public API surface consumed by CLI

## 7. Atomic Commit Strategy

Each commit should remain small enough to review independently and large enough to leave the tree green. The commit message format should follow:

```text
[Feature] Title

Why this slice exists and what boundary it establishes.

issue: TODO
AutoSubmit: true
```

### Recommended Commit Sequence

1. `[Feature] Bootstrap TypeScript project`
2. `[Feature] Add SQLite bootstrap and schema`
3. `[Feature] Add DAO layer and filesystem writer`
4. `[Feature] Add context recovery and story persistence`
5. `[Feature] Add config store and provider registry`
6. `[Feature] Add builtin genre registry and genre packages`
7. `[Feature] Add base agent and planning agents`
8. `[Feature] Add chapter review pipeline and rewrite flow`
9. `[Feature] Add story lifecycle CLI commands`
10. `[Feature] Add export subsystem`
11. `[Doc] Add end-to-end docs and verification notes`

### Commit Boundaries

- Never combine storage schema changes with unrelated CLI changes.
- Never combine provider adapters with agent behavior changes.
- Keep each command in its own commit when practical.
- Include tests in the same commit as the implementation they validate.
- If a refactor is needed, do it in a follow-up commit after behavior is covered by tests.

## 8. Test Plan By Layer

| Layer | Test Type | Main Focus |
|---|---|---|
| Types and config | Unit | Validation, defaults, parsing |
| Storage | Integration | SQLite schema, DAO correctness, recovery, file writes |
| Genres | Unit + integration | Registry loading, override behavior, invalid package handling |
| Providers | Contract | Request/response shape, error handling, config application |
| Agents | Unit | Prompt assembly, parsing, persistence-side effects through mocks |
| Pipeline | Integration | Sequence ordering, state transitions, rewrite recommendation |
| CLI | Integration | Argument parsing, command behavior, terminal-safe output |
| End-to-end | E2E | Start-to-finish story lifecycle and restart recovery |

## 9. Major Risks And Mitigations

| Risk | Why It Matters | Mitigation |
|---|---|---|
| SQLite write contention | Multiple writes happen during pipeline completion | Use WAL mode, busy timeout, and serialized write helpers |
| Context drift between memory and SQLite | Restarted processes may reload stale or partial state | Persist every major state transition and store `context_snapshot` |
| Agent prompt drift across genres | Genre-specific behavior may become inconsistent | Keep prompt assets in genre packages and test registry outputs |
| Rewrite UX confusion | Automatic rewrites can destroy user trust | Make rewrite a CLI confirmation step with explicit findings |
| Plugin/package loading failures | Custom genre packages may be malformed | Validate custom packages strictly and isolate load errors |
| Oversized commits | Review becomes hard and regressions hide inside broad changes | Follow the commit sequence above and keep the tree green |

## 10. Definition Of Done

The implementation can be considered complete when all of the following are true:

1. `museflow start`, `continue`, `status`, `info`, `config`, `genres`, and `export` exist.
2. The eight agents are implemented behind a shared base contract.
3. SQLite + filesystem dual storage works across restart recovery.
4. Genre selection works with builtin and custom genres.
5. Rewrite recommendations require explicit user confirmation.
6. The full local workflow is covered by integration and e2e tests.
7. The project can be executed from a clean environment using the documented setup steps.
