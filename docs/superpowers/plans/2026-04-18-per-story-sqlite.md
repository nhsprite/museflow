# Per-Story JSON Implementation Plan

> **⚠️ SUPERSEDED — Implementation completed with JSON, not SQLite.**
> This plan was written for per-story SQLite storage. The actual implementation uses per-story JSON files (`meta.json`) and per-directory JSON checkpoints instead. See `../specs/2026-04-18-per-story-sqlite-design.md` (updated to JSON) for the current design and the git history (`commits 6a50b4d`, `62928f5`) for the actual implementation.

**Original Goal:** Move MuseFlow runtime story persistence from global `~/.museflow` SQLite files to a single per-story SQLite file at `books/{story_id}/{story_id}.sqlite`, including lazy migration for legacy stories.

**Achieved Goal (JSON variant):** Replace global SQLite with per-story JSON files (`books/{story_id}/meta.json`) and per-story checkpoint directories (`books/{story_id}/checkpoints/`).

**Architecture:** New stories resolve a deterministic story directory from `storyId`, then store metadata and checkpoints in the same SQLite file inside that directory. CLI commands open a story-scoped DB path instead of relying on process-global singletons, and older stories are lazily migrated from the legacy global databases the first time they are accessed.

**Tech Stack:** TypeScript, sql.js, LangGraph, Vitest, Node.js filesystem/path APIs

---

## File Structure

- Modify: `src/utils/paths.ts`
  - Canonical story directory and DB path helpers.
- Modify: `src/storage/database/index.ts`
  - Replace single active DB assumptions with story-path-aware open/close helpers.
- Create: `src/storage/database/story-db.ts`
  - Story-scoped DB access helpers and lifecycle.
- Create: `src/storage/database/legacy-migration.ts`
  - Lazy migration from legacy global metadata/checkpoint stores.
- Modify: `src/storage/database/dao/story.ts`
  - Initialize and access story-local DBs.
- Modify: `src/storage/database/dao/chapter.ts`
- Modify: `src/storage/database/dao/world.ts`
- Modify: `src/storage/database/dao/character.ts`
- Modify: `src/storage/database/dao/context.ts`
  - Accept story-scoped DB access instead of assuming a single global DB.
- Modify: `src/graph/checkpointer.ts`
  - Bind checkpoint persistence to the story-local SQLite file.
- Modify: `src/graph/novel.graph.ts`
  - Build graphs with a story-scoped checkpointer.
- Modify: `src/core/runner.ts`
  - Use story-scoped graph/checkpointer resolution.
- Modify: `src/cli/commands/start.ts`
- Modify: `src/cli/commands/write.ts`
- Modify: `src/cli/commands/continue.ts`
- Modify: `src/cli/commands/status.ts`
- Modify: `src/cli/commands/info.ts`
  - Resolve canonical story DBs and trigger migration when needed.
- Modify: `README.md`
- Modify: `docs/specs/2025-04-17-museflow-design.md`
  - Align docs with canonical per-story storage.
- Modify: `tests/utils/paths.test.ts`
- Modify: `tests/storage/database/story-dao.test.ts`
- Create: `tests/storage/database/story-db.test.ts`
- Create: `tests/storage/database/legacy-migration.test.ts`
- Create: `tests/graph/checkpointer.test.ts`
- Modify: `tests/cli/status.test.ts`
- Modify: `tests/cli/info.test.ts`

### Task 1: Canonical Story Path Helpers

**Files:**
- Modify: `src/utils/paths.ts`
- Modify: `tests/utils/paths.test.ts`
- Modify: `tests/storage/database/story-dao.test.ts`

- [ ] **Step 1: Write the failing path tests**

```typescript
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'

import { getStoryOutputDir, getStoryDbPath } from '../../src/utils/paths.ts'

describe('story output paths', () => {
  it('uses the story id as the canonical story directory', () => {
    expect(getStoryOutputDir('story_mo3pbj1sabcdef', 'Hello 世界!!! / test')).toBe(
      join(process.cwd(), 'books', 'story_mo3pbj1sabcdef'),
    )
  })

  it('builds the canonical story sqlite path from outputDir and story id', () => {
    expect(getStoryDbPath(join(process.cwd(), 'books', 'story_mo3pbj1sabcdef'), 'story_mo3pbj1sabcdef')).toBe(
      join(process.cwd(), 'books', 'story_mo3pbj1sabcdef', 'story_mo3pbj1sabcdef.sqlite'),
    )
  })
})
```

- [ ] **Step 2: Run the targeted tests and verify they fail for the expected reason**

Run: `npm test -- tests/utils/paths.test.ts tests/storage/database/story-dao.test.ts`

Expected: `getStoryOutputDir()` still returns title-based folders and `getStoryDbPath` does not exist yet.

- [ ] **Step 3: Implement canonical path helpers**

```typescript
export function getStoryOutputDir(storyId: string): string {
  return join(getOutputsDir(), storyId)
}

export function getStoryDbPath(outputDir: string, storyId: string): string {
  return join(outputDir, `${storyId}.sqlite`)
}
```

Also remove the now-obsolete title-normalization path logic if it is no longer used anywhere.

- [ ] **Step 4: Update story DAO expectations to the canonical directory**

```typescript
expect(story.outputDir).toBe(join(process.cwd(), 'books', story.id))
```

The test should no longer assert title-derived directory names.

- [ ] **Step 5: Re-run the targeted tests**

Run: `npm test -- tests/utils/paths.test.ts tests/storage/database/story-dao.test.ts`

Expected: PASS.

### Task 2: Story-Scoped Database Access

**Files:**
- Create: `src/storage/database/story-db.ts`
- Modify: `src/storage/database/index.ts`
- Modify: `src/storage/database/dao/story.ts`
- Modify: `src/storage/database/dao/chapter.ts`
- Modify: `src/storage/database/dao/world.ts`
- Modify: `src/storage/database/dao/character.ts`
- Modify: `src/storage/database/dao/context.ts`
- Create: `tests/storage/database/story-db.test.ts`

- [ ] **Step 1: Write a failing test for story-scoped DB reuse**

```typescript
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'

import { openStoryDb, closeAllStoryDbs } from '../../../src/storage/database/story-db.ts'

const STORY_A = join('/tmp', 'museflow-story-a.sqlite')
const STORY_B = join('/tmp', 'museflow-story-b.sqlite')

describe('story db', () => {
  beforeEach(async () => {
    await rm(STORY_A, { force: true }).catch(() => {})
    await rm(STORY_B, { force: true }).catch(() => {})
  })

  afterEach(() => {
    closeAllStoryDbs()
  })

  it('opens isolated databases per story path', async () => {
    const dbA = await openStoryDb(STORY_A)
    const dbB = await openStoryDb(STORY_B)

    expect(dbA.path).toBe(STORY_A)
    expect(dbB.path).toBe(STORY_B)
    expect(dbA.db).not.toBe(dbB.db)
  })
})
```

- [ ] **Step 2: Run the new DB test and verify it fails correctly**

Run: `npm test -- tests/storage/database/story-db.test.ts`

Expected: FAIL because `story-db.ts` does not exist yet.

- [ ] **Step 3: Implement story-scoped DB helpers**

```typescript
export interface StoryDbHandle {
  path: string
  db: SqlJsDatabase
  persist(): void
  close(): void
}

const handles = new Map<string, StoryDbHandle>()

export async function openStoryDb(dbPath: string): Promise<StoryDbHandle> {
  const existing = handles.get(dbPath)
  if (existing) return existing

  const db = await initDb(dbPath)
  const handle: StoryDbHandle = {
    path: dbPath,
    db,
    persist: () => persistDb(dbPath),
    close: () => closeDb(dbPath),
  }
  handles.set(dbPath, handle)
  return handle
}
```

Refactor `src/storage/database/index.ts` so it no longer exposes a single `_db` / `_dbPath` pair. It should support one `SqlJsDatabase` per path, for example with `Map<string, SqlJsDatabase>` and path-aware `initDb(dbPath)`, `getDb(dbPath)`, `persistDb(dbPath)`, and `closeDb(dbPath)`.

- [ ] **Step 4: Make DAO entrypoints accept a story DB path or handle**

Use one consistent shape across all DAOs. For example:

```typescript
export async function initStoryDb(dbPath: string): Promise<void> {
  await openStoryDb(dbPath)
}

export function getStory(dbPath: string, id: string): Story | null {
  const db = getDb(dbPath)
  // existing query logic
}
```

Do not leave mixed APIs where some calls use an implicit global DB and others use an explicit path.

- [ ] **Step 5: Re-run database tests**

Run: `npm test -- tests/storage/database/story-db.test.ts tests/storage/database/story-dao.test.ts`

Expected: PASS.

### Task 3: Story-Scoped Checkpointer and Runner

**Files:**
- Modify: `src/graph/checkpointer.ts`
- Modify: `src/graph/novel.graph.ts`
- Modify: `src/core/runner.ts`
- Create: `tests/graph/checkpointer.test.ts`

- [ ] **Step 1: Write the failing checkpointer test**

```typescript
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'

import { createCheckpointer } from '../../src/graph/checkpointer.ts'

describe('checkpointer', () => {
  it('binds checkpoint persistence to a story-local sqlite path', async () => {
    const dbPath = join(process.cwd(), 'books', 'story_test', 'story_test.sqlite')
    const saver = await createCheckpointer(dbPath)

    expect(saver).toBeDefined()
  })
})
```

- [ ] **Step 2: Run the checkpointer test and verify the current singleton design fails the intent**

Run: `npm test -- tests/graph/checkpointer.test.ts`

Expected: FAIL because the module only exposes a singleton `getCheckpointer()` with a hard-coded global path.

- [ ] **Step 3: Replace singleton checkpointer construction with story-scoped construction**

```typescript
export class SqliteSaver extends BaseCheckpointSaver<number> {
  constructor(private readonly dbPath: string) {
    super(undefined)
  }
}

export async function createCheckpointer(dbPath: string): Promise<SqliteSaver> {
  await openStoryDb(dbPath)
  const saver = new SqliteSaver(dbPath)
  saver.ensureSchema()
  return saver
}
```

Then update graph building:

```typescript
export async function buildNovelGraph(dbPath: string) {
  const checkpointer = await createCheckpointer(dbPath)
  return builder.compile({ checkpointer })
}
```

And runner usage:

```typescript
const dbPath = getStoryDbPath(story.outputDir, story.id)
const graph = await getGraph(dbPath)
```

- [ ] **Step 4: Remove process-global `_graph` reuse that ignores story identity**

If caching is retained, key it by `dbPath` or `storyId`:

```typescript
const graphs = new Map<string, ReturnType<typeof buildNovelGraph>>()
```

Do not keep a single `_graph` for all stories.

- [ ] **Step 5: Re-run graph persistence tests**

Run: `npm test -- tests/graph/checkpointer.test.ts`

Expected: PASS.

### Task 4: Lazy Legacy Migration

**Files:**
- Create: `src/storage/database/legacy-migration.ts`
- Modify: `src/storage/database/dao/story.ts`
- Modify: `src/cli/commands/write.ts`
- Modify: `src/cli/commands/continue.ts`
- Modify: `src/cli/commands/status.ts`
- Modify: `src/cli/commands/info.ts`
- Create: `tests/storage/database/legacy-migration.test.ts`

- [ ] **Step 1: Write the failing migration test**

```typescript
import { describe, expect, it } from 'vitest'

import { migrateLegacyStoryIfNeeded } from '../../../src/storage/database/legacy-migration.ts'

describe('legacy migration', () => {
  it('copies one legacy story from global metadata and checkpoint stores into the canonical story db', async () => {
    const result = await migrateLegacyStoryIfNeeded('story_legacy123')
    expect(result.migrated).toBe(true)
    expect(result.dbPath.endsWith('/books/story_legacy123/story_legacy123.sqlite')).toBe(true)
  })
})
```

- [ ] **Step 2: Run the migration test and verify it fails because the migration module is missing**

Run: `npm test -- tests/storage/database/legacy-migration.test.ts`

Expected: FAIL because `legacy-migration.ts` does not exist yet.

- [ ] **Step 3: Implement lazy migration with copy-first semantics**

```typescript
export interface MigrationResult {
  migrated: boolean
  dbPath: string
}

export async function migrateLegacyStoryIfNeeded(storyId: string): Promise<MigrationResult> {
  const outputDir = getStoryOutputDir(storyId)
  const dbPath = getStoryDbPath(outputDir, storyId)

  if (existsSync(dbPath)) {
    return { migrated: false, dbPath }
  }

  // 1. read legacy story rows from ~/.museflow/museflow.sqlite
  // 2. read checkpoint rows for thread_id = storyId from ~/.museflow/checkpoints/checkpoints.sqlite
  // 3. create canonical dir + db
  // 4. copy rows + chapter files
  return { migrated: true, dbPath }
}
```

The implementation must preserve legacy sources. Copy data; do not delete old rows or files.

- [ ] **Step 4: Call migration from read-path commands before story lookup fails**

For commands that start with only `storyId`, the pattern should be:

```typescript
const dbPath = await ensureStoryDbPath(storyId)
await initStoryDb(dbPath)
const story = getStory(dbPath, storyId)
```

Where `ensureStoryDbPath(storyId)` returns the canonical path directly for new stories or triggers migration for legacy ones.

- [ ] **Step 5: Re-run migration tests**

Run: `npm test -- tests/storage/database/legacy-migration.test.ts`

Expected: PASS.

### Task 5: CLI Wiring, Documentation, and End-to-End Verification

**Files:**
- Modify: `src/cli/commands/start.ts`
- Modify: `src/cli/commands/write.ts`
- Modify: `src/cli/commands/continue.ts`
- Modify: `src/cli/commands/status.ts`
- Modify: `src/cli/commands/info.ts`
- Modify: `README.md`
- Modify: `docs/specs/2025-04-17-museflow-design.md`
- Modify: `tests/cli/status.test.ts`
- Modify: `tests/cli/info.test.ts`
- Modify: `tests/smoke/project-smoke.test.ts`

- [ ] **Step 1: Write or update failing CLI regression tests**

```typescript
it('shows the canonical output directory for a story', async () => {
  getStoryMock.mockReturnValue({ ...createStory(), id: 'story_1', outputDir: '/tmp/books/story_1' })
  const { info } = await import('../../src/cli/commands/info.ts')

  await info({ storyId: 'story_1' })

  expect(logSpy).toHaveBeenCalledWith('  输出目录: /tmp/books/story_1')
})
```

Add or update a smoke test that asserts `start` creates a story-local SQLite file path rather than writing to `~/.museflow`.

- [ ] **Step 2: Run CLI and smoke tests to verify the current behavior still fails the new expectation**

Run: `npm test -- tests/cli/status.test.ts tests/cli/info.test.ts tests/smoke/project-smoke.test.ts`

Expected: at least one failure around old global assumptions or old output directory expectations.

- [ ] **Step 3: Wire `start` to initialize canonical per-story persistence**

The `start` flow should look like this:

```typescript
const storyId = generateId('story')
const outputDir = getStoryOutputDir(storyId)
const dbPath = getStoryDbPath(outputDir, storyId)

await initStoryDb(dbPath)
const story = createStory(dbPath, {
  id: storyId,
  outputDir,
  idea,
  genre,
  totalChapters: chapters,
  provider: provider || 'openai',
})
```

If `createStory()` currently generates the ID internally, split that responsibility so `start` can compute paths before the first insert.

- [ ] **Step 4: Update docs to match the shipped behavior**

README should explicitly say:

```text
~/.museflow/config.json               # user config
books/{story_id}/{story_id}.sqlite    # story metadata + checkpoints
books/{story_id}/chapter_{n}.md       # chapter files
```

Update the 2025 design doc to remove the old contradiction.

- [ ] **Step 5: Run the full relevant verification set**

Run:

```bash
npm test -- tests/utils/paths.test.ts tests/storage/database/story-dao.test.ts tests/storage/database/story-db.test.ts tests/storage/database/legacy-migration.test.ts tests/graph/checkpointer.test.ts tests/cli/status.test.ts tests/cli/info.test.ts tests/smoke/project-smoke.test.ts
npm run typecheck
npm run build
```

Expected: all commands exit 0.

## Self-Review

- Spec coverage:
  - canonical story directory and DB path → Task 1
  - story-scoped DB access → Task 2
  - story-scoped checkpointer and runner → Task 3
  - lazy migration from legacy global stores → Task 4
  - CLI/documentation alignment and end-to-end verification → Task 5
- Placeholder scan:
  - placeholder scan passed after checking the final plan text
- Type consistency:
  - the plan consistently uses `getStoryOutputDir(storyId)`, `getStoryDbPath(outputDir, storyId)`, `initStoryDb(dbPath)`, and `getStory(dbPath, storyId)` as the target API shape
