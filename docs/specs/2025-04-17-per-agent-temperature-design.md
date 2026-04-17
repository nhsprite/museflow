# Per-Agent Temperature Design

## Background

Currently, MuseFlow uses a single global temperature setting (default 0.7) for all LLM calls. Different agents have different responsibilities — analysis/review agents should use lower temperature for stable output, while creative agents benefit from higher temperature for diversity.

Additionally, only the OpenAI provider actually passes `temperature` to the API. MiniMax and Local providers ignore it entirely.

## Changes

### 1. ModelProvider Interface (`src/model/provider.ts`)

```typescript
export interface ModelProvider {
  chat(messages: Message[], temperature?: number): Promise<string>
}
```

### 2. Provider Implementations (`src/model/registry.ts`)

All three providers receive `temperature` and pass it to their API body.

| Provider | Before | After |
|---|---|---|
| OpenAI | `temperature: this.cfg.temperature ?? 0.7` | `temperature: temperature ?? this.cfg.temperature ?? 0.7` |
| MiniMax | No temperature field | `temperature: temperature ?? this.cfg.temperature ?? 0.7` |
| Local | No temperature field | `temperature: temperature ?? this.cfg.temperature ?? 0.7` |

### 3. BaseAgent (`src/agents/base.ts`)

- Add `protected temperature: number` field
- Constructor accepts optional `temperature?: number`
- `run()` passes `this.temperature` to `this.provider.chat(messages, this.temperature)`

### 4. Per-Agent Temperature Defaults

| Agent | Temperature |
|---|---|
| WorldbuilderAgent | 0.7 |
| CharacterAgent | 0.7 |
| OutlineAgent | 0.5 |
| ChapterAgent | 0.8 |
| QualityAgent | 0.3 |
| ForeshadowingAgent | 0.3 |
| HallucinationAgent | 0.3 |
| ConsistencyAgent | 0.3 |

### 5. Agent Constructors

Each agent passes its default temperature to `BaseAgent` constructor:

```typescript
export class ChapterAgent extends BaseAgent {
  constructor() {
    super(0.8)
  }
  // ...
}
```

## No Behavioral Change for Users

- Config file temperature still works as global fallback
- CLI `config set` unchanged
- Agents that don't explicitly pass temperature will use config/global default