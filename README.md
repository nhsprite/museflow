# MuseFlow

> AI Native Long Novel Generator — End-to-End AI Writing Assistant

MuseFlow is a locally-run CLI tool. Enter a one-sentence story pitch, and AI automatically handles everything from worldbuilding and outline generation to chapter-by-chapter drafting, producing a complete, readable long-form novel.

## Key Features

- **LangGraph State Graph Orchestration**: Multi-agent collaboration with breakpoint recovery and manual rewrite confirmation
- **10 Specialized Agent Types**: Worldbuilding, Characters, Story Arc, Chapter Outline, Chapter Planning, Drafting, Foreshadowing, Consistency, Fixing, Summary
- **Genre Skill System**: Built-in genre packs for Fantasy, Xianxia, Sci-Fi, Horror, Mystery, Urban, Romance, and Default, with custom JSON genre skills
- **Local-First**: Story state, checkpoints, chapters, reports, and exports are written to local files
- **Configurable Models**: OpenAI-compatible and Anthropic-compatible providers; `minimax` and `local` are accepted as OpenAI-compatible shortcuts
- **Breakpoint Recovery**: Resume writing at any time after interruption without starting over
- **Quality Assurance**: Automatic word-count, continuity, foreshadowing, consistency, outline, and quality-dimension checks after each chapter, with targeted fixes or full rewrites for discovered issues

## Requirements

- **Node.js >= 20**
- **npm** or a compatible package manager
- API key for an OpenAI-compatible or Anthropic-compatible service

## Installation

### Install via npm (Recommended)

```bash
npm install -g museflow
```

The `museflow` command will be available globally after installation.

### Run from Source (Development)

```bash
# Clone the repository
git clone <repository-url>
cd museflow

# Install dependencies
npm install

# Optional: compile TypeScript to dist/
npm run build

# Daily development runs through tsx and does not require a build
npm start -- <command> [args]
```

## Quick Start

### 1. Configure Your Model

Configure the AI model before first use:

```bash
# View current configuration
museflow config show

# Configure OpenAI
museflow config set --provider openai --api-key YOUR_API_KEY --model gpt-4o

# Configure Claude (Anthropic)
museflow config set --provider anthropic --api-key YOUR_API_KEY --model claude-3-sonnet-20240229

# Configure another OpenAI-compatible service (MiniMax, Ollama, DeepSeek, etc.)
museflow config set --provider openai --api-key YOUR_API_KEY --model MODEL_NAME --base-url https://api.example.com/v1

# Optional: allow automatic act-boundary extension when mandatory beats need more room
museflow config set --auto-adjust-act-boundaries true
```

Configuration written by the CLI is saved in `.museflow/config.json` in the current project. Project-level config takes precedence over the optional global fallback at `~/.museflow/config.json`.

### 2. Create a Story

```bash
# Start a new story (planning and creation only, no body text)
museflow start --idea "A city archivist uncovers a hidden conspiracy across three generations" --chapters 30 --genre default
```

This command will:
1. Generate title and world-direction options for selection (`--yes` selects the first option)
2. Build the world setting
3. Generate character profiles
4. Generate the story arc and an empty per-chapter outline scaffold
5. Save story files under `./books/{story-dir}/`
6. Write `outline.md`, `story_bible.md`, `meta.json`, and initial checkpoints

### 3. Write Chapters

```bash
# Write the current chapter (stops after one chapter)
museflow write <story-id>

# Run the same command again for the next chapter
museflow write <story-id>

# Resume an interrupted checkpoint or handle a pending rewrite decision
museflow continue <story-id>
```

### 4. Fix Issues

If checks cannot converge through normal drafting/fix routing, MuseFlow writes a report and asks for a rewrite:

```bash
# Fully rewrite the current chapter
museflow rewrite <story-id>
```

The `write` command may retry drafting or apply targeted fixes. If structural problems, state conflicts, or repeated errors remain, run `rewrite` manually for a complete rewrite.

### 5. Check Progress

```bash
# View story progress
museflow status <story-id>

# View story details
museflow info <story-id>
```

## Workflow

```
start → World → Characters → Story Arc
                         ↓
write → Prepare → Decide → Chapter Outline → Chapter Plan → Draft/Fix
                         ↓
           Comprehensive Validation → Decide
                         ↓
                 ┌───────┴────────┐
                 ↓                ↓
             Finalize        Rewrite/Blocking Report
                 ↓
           Chapter Commit → Next Chapter
```

## Command Reference

Global option: `museflow --debug <command>` writes LLM session debug information.

| Command | Description |
|---------|-------------|
| `start --idea <text> --chapters <n> [--genre <name>] [--yes]` | Create a new story plan: title/world direction, world, characters, story arc, and empty chapter scaffold |
| `write <id>` | Write exactly one current chapter |
| `continue <id> [-y|-n]` | Resume from the latest checkpoint and optionally accept/refuse a pending rewrite request |
| `rewrite <id> [--chapter <n>]` | Fully rewrite the current or specified chapter; downstream chapter files are truncated by code |
| `status <id>` | View progress, pending issues, worldbuilding status, and foreshadow status |
| `info <id>` | View story metadata, genre info, state preview, and storage path |
| `list` / `ls` | List all local books under `books/` |
| `delete <id> --force` | Delete a local book directory after explicit confirmation via `--force` |
| `adjust-act <id> --act <n> --end-chapter <n>` | Manually shift an act boundary when mandatory beats need more chapters |
| `export <id>` | Export written chapters as a `.txt` file under `output/` and start a temporary QR download server |
| `config [show|set|get]` | Manage model and runtime configuration |
| `genres [list|install|uninstall|info]` | View, install, remove, or inspect genre skills |

## Genres

The following genres are built-in and can be specified via `--genre`:

| Genre | Value | Description |
|-------|-------|-------------|
| Fantasy | `fantasy` | Western fantasy, magic, quests |
| Xianxia | `xianxia` | Cultivation, Immortality, Martial Arts |
| Sci-Fi | `scifi` | Future Tech, Space Adventure |
| Horror | `horror` | Thriller, Supernatural |
| Mystery | `mystery` | Detective, Puzzle Solving |
| Urban | `urban` | Modern City, Workplace |
| Romance | `romance` | Love Stories |
| Default | `default` | General purpose |

## Agent System

MuseFlow uses 10 specialized agent types working together:

| Agent | Responsibility |
|-------|----------------|
| **WorldBuilder** | Build world settings, history, and social structures |
| **Character** | Generate character profiles, personalities, and relationships |
| **StoryArc** | Generate act structure, mandatory beats, and global key beats |
| **ChapterOutline** | Generate detailed per-chapter outlines immediately before drafting |
| **ChapterPlanner** | Plan chapter sections, time anchors, and previous-task handling |
| **Chapter** | Draft chapter body text with consistent style and state |
| **Foreshadowing** | Detect foreshadowing creation and payoff from chapter text |
| **Consistency** | Check cross-chapter logic, setting, and outline compliance issues |
| **Fix** | Repair patchable issues at sentence, paragraph, or chapter level |
| **Summary** | Generate chapter summaries and extract canonical facts, tasks, and state updates |

## Data Storage

Story data is saved locally in the `./books/` directory. The concrete story directory is title/id based, for example `books/my-title-abc123def456/`.

| Path | Content |
|------|---------|
| `./.museflow/config.json` | Project-level config written by `museflow config set` |
| `~/.museflow/config.json` | Optional global fallback config |
| `./books/{story-dir}/checkpoints/latest.json` | Pointer to the latest LangGraph checkpoint |
| `./books/{story-dir}/checkpoints/*.json` | LangGraph checkpoint JSON files; runtime source of truth |
| `./books/{story-dir}/meta.json` | Exported projection of the latest checkpoint for CLI display and inspection |
| `./books/{story-dir}/outline.md` | Human-readable story arc and generated chapter outlines |
| `./books/{story-dir}/story_bible.md` | Initial world, character, and scaffold reference |
| `./books/{story-dir}/chapters/chapter_{n}.md` | Chapter body text `.md` files |
| `./books/{story-dir}/reports/chapter_{n}.report.json` | Per-chapter generation report |
| `./books/{story-dir}/reports/blocking_*.json` | Manual-resolution report when rewrite convergence stalls |
| `./output/*.txt` | Exported manuscripts created by `museflow export` |

> **Note**: MuseFlow uses JSON + filesystem storage; it does not depend on SQLite.
> Checkpoints are authoritative. `meta.json`, `outline.md`, reports, and exports are projections/artifacts produced by code.

## Runtime Architecture

- `src/graph/novel.graph.ts` owns the coarse LangGraph state machine.
- `src/core/runner.ts` builds initial/working graph state and invokes the graph.
- `src/core/chapter-commit.ts` is the post-graph chapter commit boundary: it saves the chapter marker after LangGraph has persisted the final checkpoint, then exports `meta.json`.
- `src/core/outline-expander.ts` generates chapter outlines and detailed chapter plans just before drafting, using story arc progress, prior summaries, story state, and next-chapter boundary hints.
- `src/graph/services/chapter-orchestration/` prepares chapter state and performs convergence-aware routing.
- `src/core/chapter-generation/routing/` decides whether a chapter should draft, patch-fix, finalize, or stop for manual rewrite.
- `src/graph/services/finalization/` extracts summary/state/canonical facts, verifies mandatory beats, updates act progress, and writes reports.
- `verifiedConstraints` are structured runtime state and are rendered to plain text only when passed into agent prompts.
- `meta.json`, `outline.md`, and reports are projections/artifacts; checkpoint state remains the authoritative runtime record.

## Project Structure

```
src/
├── cli/           # CLI entry point (all command implementations)
├── graph/         # LangGraph graph orchestration (state, nodes, edges, checkpoints)
├── agents/        # 10 agent type implementations
├── core/          # Runner, chapter commit boundary, outline expansion, routing policies
├── genres/        # Genre Skill system
├── storage/       # JSON metadata + filesystem storage
├── config/        # Project/global config loading and saving
├── model/         # Model abstraction layer (OpenAI-compatible / Anthropic)
├── types/         # Shared TypeScript types
└── utils/         # Utility functions
```

## Development

```bash
# Run tests in watch mode
npm run test:watch

# Development mode (tsx watch)
npm run dev

# Type checking
npm run typecheck

# Run tests
npm test

# Linting
npm run lint
```

## FAQ

### `write` command has no output
Make sure you passed the story-id: `museflow write <story-id>`

### API call errors
Check that the api key and base url in config are correct. Use `museflow config show` to verify.

### "Issues need to be addressed" after finishing a chapter
Run the `rewrite` command to rewrite the current chapter:
```bash
museflow rewrite <story-id>  # Full rewrite
```

### Where did my story files go?
Run `museflow info <story-id>` and check `Storage path`. Story directories are named from the selected title plus an id suffix, not just the raw story id.

## Architecture

See the [Current Runtime Architecture](./docs/specs/2026-07-04-current-runtime-architecture.md) for the implementation that matches this codebase. The 2025 design documents are historical references and still describe earlier SQLite and linear-agent plans.

## License

MIT

---

[中文文档](./README.zh.md)
