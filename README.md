# MuseFlow

> AI Native Long Novel Generator — End-to-End AI Writing Assistant

MuseFlow is a locally-run CLI tool. Enter a one-sentence story pitch, and AI automatically handles everything from worldbuilding and outline generation to chapter-by-chapter drafting, producing a complete, readable long-form novel.

## Key Features

- **LangGraph State Graph Orchestration**: Multi-agent collaboration with breakpoint recovery and manual rewrite confirmation
- **10 Specialized Agent Types**: Worldbuilding, Characters, Story Arc, Chapter Outline, Chapter Planning, Drafting, Foreshadowing, Consistency, Fixing, Summary
- **Genre Skill System**: Built-in genre packs for Xianxia, Sci-Fi, Horror, and more, with support for user-defined Skills
- **Local-First**: All data stored locally; configurable models (OpenAI-compatible / Anthropic)
- **Breakpoint Recovery**: Resume writing at any time after interruption without starting over
- **Quality Assurance**: Automatic multi-dimensional quality checks after each chapter, with targeted fixes or full rewrites for discovered issues

## Requirements

- **Node.js >= 20**
- **npm** or **pnpm**
- API Key (OpenAI / Claude / other compatible services)

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

# Compile TypeScript
npm run build

# Use npm start instead of museflow during development
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

# Configure other OpenAI-compatible services (MiniMax, Ollama, DeepSeek, etc.)
museflow config set --provider openai --api-key YOUR_API_KEY --model MODEL_NAME --base-url https://api.example.com/v1
```

Configuration is saved in `.museflow/config.json` in the project directory (project-level config takes precedence over the global `~/.museflow/config.json`).

### 2. Create a Story

```bash
# Start a new story (planning and creation only, no body text)
museflow start --idea "A young man gains cultivation powers and rises to become the strongest" --chapters 30 --genre xianxia
```

This command will:
1. Build the world setting
2. Generate character profiles
3. Generate the chapter outline
4. Save to `./books/{story_id}/`

### 3. Write Chapters

```bash
# Write the current chapter (stops after one chapter)
museflow write <story-id>

# Continue to the next chapter
museflow write <story-id>
```

### 4. Fix Issues

If quality checks find errors, you will be prompted to rewrite:

```bash
# Fully rewrite the current chapter
museflow rewrite <story-id>
```

The `write` command includes an automatic retry mechanism (up to 3 times). If quality checks still fail, run `rewrite` manually for a complete rewrite.

### 5. Check Progress

```bash
# View story progress
museflow status <story-id>

# View story details
museflow info <story-id>
```

## Workflow

```
start → World → Characters → Outline
                       ↓
write → Chapter Outline → Chapter Plan → Draft → Foreshadowing/Consistency Validation → Fix or Rewrite
                       ↓
                 ┌─────┴─────┐
                 ↓           ↓
             Pass         Issues Found
                 ↓           ↓
             Next Chapter   rewrite
                              ↓
                          Re-check
```

## Command Reference

| Command | Description |
|---------|-------------|
| `start` | Create a new story: world, characters, outline |
| `write <id>` | Write the current chapter |
| `continue <id>` | Resume writing from a breakpoint |
| `rewrite <id>` | Rewrite a problematic chapter |
| `status <id>` | View story progress |
| `info <id>` | View story details |
| `export <id>` | Export story as a txt file |
| `config` | Manage model configuration |
| `genres` | View available genres |

## Genres

The following genres are built-in and can be specified via `--genre`:

| Genre | Value | Description |
|-------|-------|-------------|
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

Story data is saved locally in the `./books/` directory:

| Path | Content |
|------|---------|
| `./.museflow/config.json` | Project-level config (API key, provider, etc.) |
| `./books/{story_id}/meta.json` | Story metadata (world, characters, outline) |
| `./books/{story_id}/checkpoints/` | LangGraph checkpoint JSON files |
| `./books/{story_id}/chapters/chapter_{n}.md` | Chapter body text `.md` files |

> **Note**: MuseFlow uses JSON + filesystem storage; it does not depend on SQLite.

## Project Structure

```
src/
├── cli/           # CLI entry point (all command implementations)
├── graph/         # LangGraph graph orchestration (state, nodes, edges, checkpoints)
├── agents/        # 10 agent type implementations
├── core/          # Core business logic (Runner)
├── genres/        # Genre Skill system
├── storage/       # JSON metadata + filesystem storage
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

## Architecture

See the [Design Document](./docs/specs/2025-04-17-museflow-design.md) and [Implementation Plan](./docs/specs/2025-04-17-museflow-implementation-plan.md) for details.

## License

MIT

---

[中文文档](./README.zh.md)
