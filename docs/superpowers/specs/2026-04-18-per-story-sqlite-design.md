# MuseFlow Per-Story JSON Design

> Date: 2026-04-18
> Status: Implemented
> Scope: Story metadata and checkpoint persistence

> ⚠️ **Supersedes**: `2026-04-18-per-story-sqlite-design.md` — Storage was changed from per-story SQLite to **per-story JSON files** after implementation showed JSON was simpler and sufficient for MuseFlow's schema-less domain model.

## 1. Problem

MuseFlow originally persisted runtime story state into two global SQLite files under `~/.museflow/`:

- `~/.museflow/museflow.sqlite` for story metadata
- `~/.museflow/checkpoints/checkpoints.sqlite` for LangGraph checkpoints

This contradicted the README and the intended local-first story model, where a story should be portable as a self-contained folder under `books/`. It also introduced an architectural mismatch: chapter markdown is stored under the working directory, while resumable state is stored globally in the user home directory.

## 2. Goals

- Make each story self-contained under `books/`.
- Store story metadata in one per-story JSON file (`meta.json`).
- Store LangGraph checkpoints as individual JSON files in a per-story `checkpoints/` directory.
- Remove runtime dependence on `~/.museflow/museflow.sqlite` and `~/.museflow/checkpoints/checkpoints.sqlite` for story execution.
- Keep `~/.museflow/` only for user-level assets such as config and installed genres.
- Provide a safe migration path for already-created stories.
- Align runtime behavior with documented storage expectations.

## 3. Non-Goals

- Do not redesign the story graph itself.
- Do not remove chapter markdown files; they remain part of the story folder.
- Do not introduce a new always-on global story index in V1.
- Do not delete legacy global databases automatically during migration.
- Do not use a database (SQLite or otherwise) for story metadata.

## 4. Storage Design

### 4.1 Per-Story Directory Structure

Each story lives in a canonical directory:

```text
books/{story_id}/
├── meta.json                    # 所有元数据（story, world, characters, outline, chapters, contextSnapshot）
├── checkpoints/                 # LangGraph checkpoint JSON 文件
│   ├── {checkpoint_id_1}.json
│   └── {checkpoint_id_2}.json
├── chapter_0.md                 # 第 1 章正文
├── chapter_1.md                 # 第 2 章正文
└── outline.md                   # 大纲（可选，人工参考用）
```

### 4.2 meta.json Schema

`books/{story_id}/meta.json` 的结构见主架构文档 `2025-04-17-museflow-design.md` 第 4 节。

### 4.3 Checkpoint Storage

LangGraph checkpoints 存储在 `books/{story_id}/checkpoints/` 目录下，每个 checkpoint 一个 JSON 文件。
`JsonCheckpointer` 实现见 `src/graph/checkpointer.ts`。

### 4.4 目录结构设计原则

- `storyId` 直接映射到故事目录，命令无需全局索引即可定位故事。
- `meta.json` 是故事的单一元数据来源。
- Checkpoints 与元数据分离存储，避免 checkpoint 写入干扰 meta.json 的可读性。
- Chapter markdown 文件保持不变，与 JSON 元数据共存于同一目录。

## 5. Runtime Behavior

### 5.1 `start`

1. 生成 `storyId`。
2. 计算规范目录 `outputDir = books/{storyId}`。
3. 调用 `ensureStoryDir(outputDir)` 创建目录。
4. 调用 `writeMetaJsonSync(outputDir, 'story', storyRecord)` 写入初始 meta.json。
5. 用 `JsonCheckpointer(outputDir)` 编译图。

### 5.2 `write` / `continue` / `status` / `info`

1. 从 `storyId` 计算规范路径 `books/{storyId}`。
2. 读取 `books/{storyId}/meta.json` 获取故事元数据。
3. 用该路径初始化 `JsonCheckpointer` 以恢复 checkpoint。

### 5.3 Graph Execution

`novel.graph.ts` 每次编译图时传入 story-scoped `JsonCheckpointer`，不再使用全局单例。

## 6. Legacy Migration

现有用户可能还有：

- `~/.museflow/museflow.sqlite` 中的故事元数据
- `~/.museflow/checkpoints/checkpoints.sqlite` 中的 checkpoint
- `books/{title}/` 目录下以标题命名的章节文件

V1 支持对旧故事的**惰性迁移**（首次访问时触发）。

迁移步骤：
1. 从全局 SQLite 读取故事数据。
2. 在规范目录 `books/{storyId}/` 创建 meta.json。
3. 将 checkpoint 数据导出为 JSON 文件存入 `checkpoints/` 目录。
4. 保留旧的 SQLite 文件，不自动删除。

## 7. 错误处理

| 情况 | 行为 |
|------|------|
| 规范 meta.json 存在 | 直接打开使用 |
| 规范 meta.json 不存在但有旧故事 | 执行惰性迁移，然后继续 |
| 规范 meta.json 不存在且无旧故事 | 报告 "story not found" |
| 迁移失败 | 停止并报错，不删除旧数据 |

## 8. 实现总结

| 组件 | 文件 | 说明 |
|------|------|------|
| JSON helpers | `src/storage/database/index.ts` | `readMetaJsonSync`, `writeMetaJsonSync`, `ensureStoryDir` |
| Story DAO | `src/storage/database/dao/story.ts` | story CRUD → meta.json |
| Chapter DAO | `src/storage/database/dao/chapter.ts` | chapter/outline → meta.json |
| Character DAO | `src/storage/database/dao/character.ts` | character → meta.json |
| World DAO | `src/storage/database/dao/world.ts` | world → meta.json |
| Context DAO | `src/storage/database/dao/context.ts` | context snapshot → meta.json |
| Checkpointer | `src/graph/checkpointer.ts` | `JsonCheckpointer` |
| Graph | `src/graph/novel.graph.ts` | 适配 JsonCheckpointer |

核心变更：故事文件夹成为持久化边界。每个故事的所有数据（meta.json + checkpoints + chapters）都在 `books/{story_id}/` 下，CLI 重启后可完整恢复。
