# Debug Mode Design

## Overview

Add a debug mode to MuseFlow that records and displays all LLM conversation sessions. This helps developers and advanced users inspect the full prompt/response cycle for troubleshooting, prompt engineering, and quality analysis.

## Goals

- Record every LLM request (messages, temperature) and response (content)
- Support both terminal output and file persistence
- Be triggerable via CLI flag, environment variable, or config file
- Zero impact on normal (non-debug) execution path
- Minimal code intrusion into existing agents

## Non-Goals

- Replay recorded sessions
- Modify prompts based on debug output
- Network-level HTTP tracing (we trace at the ModelProvider level)

## Architecture

### Recording Strategy: Provider Decorator

We wrap the `ModelProvider` returned by `createProvider()` with a `DebugModelProvider` that intercepts `chat()` and `chatStructured()` calls.

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  BaseAgent  │────▶│ DebugModelProvider│────▶│ OpenAI/Anthropic│
│   .chat()   │     │  (records I/O)    │     │    Provider     │
└─────────────┘     └──────────────────┘     └─────────────────┘
                            │
                            ▼
                    ┌───────────────┐
                    │  Terminal     │
                    │  (logger.debug)│
                    └───────────────┘
                            │
                            ▼
                    ┌───────────────┐
                    │  Debug Log    │
                    │  File (JSONL) │
                    └───────────────┘
```

### Trigger Mechanism

Debug mode is enabled if ANY of the following is true:

1. CLI global flag: `--debug` or `-d`
2. Environment variable: `MUSEFLOW_DEBUG=1`
3. Config file: `debug: true` in `~/.museflow/config.json` or `./.museflow/config.json`

Precedence: CLI flag > env var > config file

### Data Format

Each recorded session is a JSON object:

```json
{
  "timestamp": "2026-05-27T14:30:00.000Z",
  "agent": "chapter",
  "provider": "openai",
  "model": "gpt-4o",
  "temperature": 0.7,
  "messages": [
    {"role": "system", "content": "..."},
    {"role": "user", "content": "..."}
  ],
  "response": "...",
  "duration_ms": 4523
}
```

### File Output

When a `storyId` is available (during `write`, `rewrite`, `continue`), logs are written to:

```
books/{storyId}/debug/
  └── sessions_{YYYYMMDD}.jsonl
```

When no `storyId` is available (during `start` worldbuilding), logs are written to a temporary file or only to terminal.

### Terminal Output

In debug mode, each LLM call prints to stderr via `logger.debug`:

```
2026-05-27 14:30:00 [DEBUG] [LLM] agent=chapter provider=openai model=gpt-4o temp=0.7 messages=3
2026-05-27 14:30:04 [DEBUG] [LLM] agent=chapter response_length=1523 duration_ms=4523
```

For full message content, a separate `logger.debug` call dumps the JSON.

## Implementation Plan

### Files to Modify

1. **src/types/config.ts** — Add `debug?: boolean` to `AppConfig`
2. **src/config/store.ts** — No changes needed (generic JSON storage)
3. **src/cli/index.ts** — Add `.option('-d, --debug', ...)` to program
4. **src/model/provider.ts** — Add optional `name` field to `ModelProvider` for identification
5. **src/model/registry.ts** — Implement `DebugModelProvider` wrapper; modify `createProvider()` to wrap when debug is enabled
6. **src/agents/base.ts** — Pass agent name to provider for logging context
7. **src/utils/logger.ts** — Optional: add `isDebugEnabled()` helper

### New Files

None.

### Edge Cases

- **Agent name unavailable**: Log `"unknown"` as agent name
- **No storyId**: Skip file output, log to terminal only
- **Large responses**: File output records full response; terminal output truncates at 1000 chars
- **Structured output**: Record the parsed JSON object, not the raw string
- **API errors**: Record the error message in the response field
- **Concurrent calls**: Each call is independent; JSONL format handles concurrent writes safely

## Testing

- Unit test: `DebugModelProvider` records correct data
- Integration test: Running `museflow --debug write <id>` produces debug logs
- Verify: Non-debug mode has zero performance impact (no wrapper created)

## Future Extensions

- Filter by agent type (`--debug-agents chapter,quality`)
- Pretty-print terminal output with syntax highlighting
- Web UI for browsing session history

## Decision Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Recording layer | Provider decorator | Zero agent code changes, captures all LLM calls including direct provider usage |
| Output format | JSONL | Append-friendly, human-readable, handles concurrent writes |
| Trigger priority | CLI > env > config | Follows standard CLI tool conventions |
| File location | Per-story `debug/` directory | Keeps debug data close to the story it belongs to |
