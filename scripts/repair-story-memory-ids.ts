#!/usr/bin/env tsx
/**
 * 一次性修复 story-memory 中的非法实体 ID 与非法 ID 字段值。
 *
 * 问题根因：早期 chapter agent 的 STORY_EVENTS 解析器未对 characterId / locationId /
 * itemId / holderId / foreshadowId / taskId 等字段做机器可读校验，导致中文名、
 * 描述性短语或混合字符串被直接写入 story-memory，最终使后续 chapter planner 的
 * strict 校验失败。
 *
 * 本脚本：
 * 1. 扫描 story-memory.json 中所有非法实体 ID；
 * 2. 扫描 events 与 canonicalFacts 中的非法 ID 字段值；
 * 3. 按自动提取已有合法 ID、生成 slug ID，或用户提供的映射文件进行修复；
 * 4. 同步更新 checkpoints/ 与 meta.json 中的交叉引用，并重新投影 storyState。
 *
 * 用法：
 *   npx tsx scripts/repair-story-memory-ids.ts <story-dir>
 *   npx tsx scripts/repair-story-memory-ids.ts <story-dir> --mapping ./mapping.json
 *
 * mapping.json 示例：
 *   {
 *     "某个中文角色名": "c-existing-id",
 *     "某个中文物品名": "item-existing-id"
 *   }
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { projectStoryStateFromMemory } from '../src/story-memory/projector.js'
import type { StoryMemory } from '../src/types/story-memory.js'
import type { StoryState } from '../src/types/story-state.js'

const MACHINE_ID_RE = /^[A-Za-z][A-Za-z0-9._:-]*$/

function isMachineId(value: string): boolean {
  return MACHINE_ID_RE.test(value)
}

function shortHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 8)
}

function slugifyEntityId(
  type: 'character' | 'item' | 'location' | 'faction' | 'plot' | 'foreshadow' | 'task',
  rawId: string
): string {
  const prefix =
    type === 'character'
      ? 'c'
      : type === 'item'
        ? 'item'
        : type === 'location'
          ? 'l'
          : type === 'faction'
            ? 'f'
            : type === 'plot'
              ? 'plot'
              : type === 'foreshadow'
                ? 'fs'
                : 'task'
  const asciiSlug = rawId
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  if (asciiSlug.length >= 3 && isMachineId(`${prefix}-${asciiSlug}`)) {
    return `${prefix}-${asciiSlug}`
  }
  return `${prefix}-${shortHash(rawId)}`
}

type EntityType = 'character' | 'item' | 'location' | 'faction' | 'plot'

interface RepairContext {
  storyDir: string
  /** 任意非法 ID/值 -> 修复后的合法 ID */
  idMapping: Map<string, string>
  /** 需要新建的 foreshadow / task 条目（key 为修复后 ID） */
  newForeshadows: Map<string, { text: string; introducedIn: number }>
  newTasks: Map<string, { description: string; createdIn: number }>
  updatedFiles: string[]
}

function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf-8'))
}

function saveJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf-8')
}

function collectInvalidEntityIds(memory: Record<string, unknown>): Map<string, EntityType> {
  const invalid = new Map<string, EntityType>()
  const entities = memory.entities as
    Record<string, Record<string, Record<string, unknown>>> | undefined
  if (!entities) return invalid

  const mappings: Array<[EntityType, string]> = [
    ['character', 'characters'],
    ['item', 'items'],
    ['location', 'locations'],
    ['faction', 'factions'],
    ['plot', 'plots'],
  ]

  for (const [type, key] of mappings) {
    const group = entities[key] ?? {}
    for (const id of Object.keys(group)) {
      if (!isMachineId(id)) {
        invalid.set(id, type)
      }
    }
  }
  return invalid
}

function extractBestMachineId(raw: string): string | null {
  if (isMachineId(raw)) return raw
  const matches = Array.from(raw.matchAll(/[A-Za-z][A-Za-z0-9._:-]*/g))
  const valid = matches.filter((m) => isMachineId(m[0]) && m[0].length >= 3)
  if (valid.length === 0) return null
  return valid.reduce((a, b) => (a[0].length >= b[0].length ? a : b))[0]
}

function collectInvalidCanonicalFactLocationValues(
  storyState: Record<string, unknown> | undefined
): string[] {
  if (!storyState) return []
  const facts = storyState.canonicalFacts as Array<Record<string, unknown>> | undefined
  if (!facts) return []
  const invalid = new Set<string>()
  for (const fact of facts) {
    if (fact.attribute !== 'location') continue
    const value = fact.value
    if (typeof value === 'string' && !isMachineId(value)) {
      invalid.add(value)
    }
  }
  return Array.from(invalid)
}

function buildIdMapping(
  memory: Record<string, unknown>,
  extraInvalidLocationValues: string[] = [],
  userMapping: Record<string, string> = {}
): {
  mapping: Map<string, string>
  newForeshadows: Map<string, { text: string; introducedIn: number }>
  newTasks: Map<string, { description: string; createdIn: number }>
} {
  const invalidEntities = collectInvalidEntityIds(memory)
  const mapping = new Map<string, string>()
  const newForeshadows = new Map<string, { text: string; introducedIn: number }>()
  const newTasks = new Map<string, { description: string; createdIn: number }>()

  // 0. 用户自定义映射（用于把描述性 ID 合并到已有合法实体，保持脚本本身中立）
  for (const [raw, target] of Object.entries(userMapping)) {
    if (isMachineId(target)) mapping.set(raw, target)
  }

  // 1. 实体 ID 映射
  for (const [rawId, type] of invalidEntities) {
    if (mapping.has(rawId)) continue
    mapping.set(rawId, slugifyEntityId(type, rawId))
  }

  // 2. canonicalFacts 中的非法 location 值
  for (const raw of extraInvalidLocationValues) {
    if (mapping.has(raw)) continue
    const extracted = extractBestMachineId(raw)
    mapping.set(raw, extracted ?? slugifyEntityId('location', raw))
  }

  // 3. 扫描 events 中的非法值
  const events = (memory.events ?? []) as Array<Record<string, unknown>>
  for (const event of events) {
    const chapterIndex = (event.chapterIndex as number) ?? 0

    for (const key of ['locationId', 'holderId'] as const) {
      const val = event[key]
      if (typeof val !== 'string' || isMachineId(val)) continue
      const extracted = extractBestMachineId(val)
      if (extracted) {
        mapping.set(val, extracted)
      } else {
        // 纯描述性位置文本：创建新地点实体
        const newId = slugifyEntityId('location', val)
        mapping.set(val, newId)
      }
    }

    const foreshadowId = event.foreshadowId
    if (typeof foreshadowId === 'string' && !isMachineId(foreshadowId)) {
      const extracted = extractBestMachineId(foreshadowId)
      if (extracted) {
        mapping.set(foreshadowId, extracted)
      } else {
        const newId = slugifyEntityId('foreshadow', foreshadowId)
        mapping.set(foreshadowId, newId)
        newForeshadows.set(newId, { text: foreshadowId, introducedIn: chapterIndex })
      }
    }

    const taskId = event.taskId
    if (typeof taskId === 'string' && !isMachineId(taskId)) {
      const extracted = extractBestMachineId(taskId)
      if (extracted) {
        mapping.set(taskId, extracted)
      } else {
        const newId = slugifyEntityId('task', taskId)
        mapping.set(taskId, newId)
        newTasks.set(newId, { description: taskId, createdIn: chapterIndex })
      }
    }
  }

  return { mapping, newForeshadows, newTasks }
}

function replaceString(value: string, mapping: Map<string, string>): string {
  return mapping.get(value) ?? value
}

function transformStoryMemory(
  memory: Record<string, unknown>,
  ctx: Pick<RepairContext, 'idMapping' | 'newForeshadows' | 'newTasks'>
): Record<string, unknown> {
  const { idMapping, newForeshadows, newTasks } = ctx
  const next = structuredClone(memory) as Record<string, unknown>
  const entities = next.entities as
    Record<string, Record<string, Record<string, unknown>>> | undefined

  // 1. 修复 entities：替换 key 与实体 id，合并到已有目标实体时保留人类可读 name
  if (entities) {
    const entityGroups: Array<[EntityType, string]> = [
      ['character', 'characters'],
      ['item', 'items'],
      ['location', 'locations'],
      ['faction', 'factions'],
      ['plot', 'plots'],
    ]

    for (const [type, groupKey] of entityGroups) {
      const group = entities[groupKey] ?? {}
      const nextGroup: Record<string, Record<string, unknown>> = {}

      for (const [id, entity] of Object.entries(group)) {
        const newId = replaceString(id, idMapping)
        const existing = nextGroup[newId]
        if (existing) {
          const incomingName = entity.name
          if (
            typeof incomingName === 'string' &&
            incomingName !== id &&
            incomingName !== existing.name
          ) {
            existing.name = incomingName
          }
        } else {
          nextGroup[newId] = structuredClone(entity) as Record<string, unknown>
          nextGroup[newId]!.id = newId
          if (nextGroup[newId]!.name === id) {
            nextGroup[newId]!.name = newId
          }
        }
      }
      entities[groupKey] = nextGroup
    }

    // 为纯描述性位置文本新建 location 实体
    for (const [raw, newLocId] of idMapping) {
      if (!newLocId.startsWith('l-')) continue
      if (entities.locations[newLocId]) continue
      entities.locations[newLocId] = {
        id: newLocId,
        name: raw,
        introducedIn: 0,
      }
    }
  }

  // 2. 修复 events 中的 ID 引用字段
  const events = next.events as Array<Record<string, unknown>> | undefined
  if (events) {
    for (const event of events) {
      for (const key of [
        'characterId',
        'locationId',
        'itemId',
        'holderId',
        'plotId',
        'beatId',
        'foreshadowId',
        'taskId',
      ]) {
        const val = event[key]
        if (typeof val === 'string') {
          event[key] = replaceString(val, idMapping)
        }
      }
    }
  }

  // 3. 修复 foreshadows / beats / tasks 的 key 与 id 字段
  for (const collectionKey of ['foreshadows', 'beats', 'tasks'] as const) {
    const collection = next[collectionKey] as Record<string, Record<string, unknown>> | undefined
    if (!collection) continue
    const nextCollection: Record<string, Record<string, unknown>> = {}
    for (const [id, entry] of Object.entries(collection)) {
      const newId = replaceString(id, idMapping)
      if (!nextCollection[newId]) {
        nextCollection[newId] = structuredClone(entry)
        nextCollection[newId]!.id = newId
      }
    }
    next[collectionKey] = nextCollection
  }

  // 4. 补充因非法 foreshadowId/taskId 而需要新建的条目
  const foreshadows = next.foreshadows as Record<string, Record<string, unknown>>
  for (const [id, { text, introducedIn }] of newForeshadows) {
    if (!foreshadows[id]) {
      foreshadows[id] = {
        id,
        text,
        kind: null,
        introducedIn,
        expectedFulfillChapter: null,
        fulfilledIn: null,
        required: true,
        beatId: null,
      }
    }
  }

  const tasks = next.tasks as Record<string, Record<string, unknown>>
  for (const [id, { description, createdIn }] of newTasks) {
    if (!tasks[id]) {
      tasks[id] = {
        id,
        description,
        createdIn,
        resolvedIn: null,
      }
    }
  }

  return next
}

function transformMetaStoryState(
  storyState: Record<string, unknown>,
  idMapping: Map<string, string>
): Record<string, unknown> {
  const next = structuredClone(storyState) as Record<string, unknown>

  for (const key of [
    'characterLocations',
    'characterStatus',
    'keyItemsLocation',
    'keyItemsState',
  ]) {
    const record = next[key] as Record<string, string> | undefined
    if (!record) continue
    const nextRecord: Record<string, string> = {}
    for (const [entityId, value] of Object.entries(record)) {
      const newEntityId = replaceString(entityId, idMapping)
      nextRecord[newEntityId] = replaceString(value, idMapping)
    }
    next[key] = nextRecord
  }

  for (const key of ['canonicalFacts', 'supersededFacts'] as const) {
    const facts = next[key] as Array<Record<string, unknown>> | undefined
    if (!facts) continue
    for (const fact of facts) {
      if (typeof fact.subject === 'string') {
        fact.subject = replaceString(fact.subject, idMapping)
      }
      for (const valueKey of ['value', 'oldFact', 'newFact'] as const) {
        const val = fact[valueKey]
        if (typeof val === 'string') {
          fact[valueKey] = replaceString(val, idMapping)
        }
      }
    }
  }

  const pendingTasks = next.pendingTasks as Array<Record<string, unknown>> | undefined
  if (pendingTasks) {
    for (const task of pendingTasks) {
      if (typeof task.id === 'string') task.id = replaceString(task.id, idMapping)
      if (typeof task.assignee === 'string') task.assignee = replaceString(task.assignee, idMapping)
    }
  }

  const handoff = next.chapterHandoff as Record<string, unknown> | undefined
  if (handoff) {
    const present = handoff.charactersPresent as string[] | undefined
    if (present) {
      handoff.charactersPresent = present.map((id) => replaceString(id, idMapping))
    }
  }

  return next
}

function transformCheckpoint(
  checkpoint: Record<string, unknown>,
  ctx: Pick<RepairContext, 'idMapping' | 'newForeshadows' | 'newTasks'>
): Record<string, unknown> {
  const next = structuredClone(checkpoint) as Record<string, unknown>
  const channelValues = (next.checkpoint as Record<string, unknown> | undefined)?.channel_values as
    Record<string, unknown> | undefined
  if (channelValues?.storyMemory) {
    channelValues.storyMemory = transformStoryMemory(
      channelValues.storyMemory as Record<string, unknown>,
      ctx
    )
  }
  if (channelValues?.storyState) {
    channelValues.storyState = transformMetaStoryState(
      channelValues.storyState as Record<string, unknown>,
      ctx.idMapping
    )
  }
  return next
}

function reprojectStoryState(memory: StoryMemory, previousState: StoryState | null): StoryState {
  return projectStoryStateFromMemory(memory, previousState)
}

/**
 * 确保 storyMemory 中为所有被引用的 locationId / holderId 存在 location 实体。
 * 该步骤与是否发生 ID 修复无关：历史数据中大量合法 locationId 从未建立实体记录，
 * 而后续 agent 可能依赖 entities.locations 解析名称。
 */
function ensureLocationEntitiesForReferencedIds(
  memory: Record<string, unknown>,
  storyState?: Record<string, unknown>
): boolean {
  const entities = memory.entities as
    Record<string, Record<string, Record<string, unknown>>> | undefined
  if (!entities) return false
  const locations = entities.locations
  const referenced = new Set<string>()

  // 从 events 收集
  const events = (memory.events ?? []) as Array<Record<string, unknown>>
  for (const event of events) {
    for (const key of ['locationId', 'holderId'] as const) {
      const val = event[key]
      if (typeof val === 'string' && isMachineId(val)) referenced.add(val)
    }
  }

  // 从 storyState canonicalFacts 收集
  if (storyState) {
    const facts = storyState.canonicalFacts as Array<Record<string, unknown>> | undefined
    if (facts) {
      for (const fact of facts) {
        if (fact.attribute === 'location') {
          const val = fact.value
          if (typeof val === 'string' && isMachineId(val)) referenced.add(val)
        }
      }
    }
    const characterLocations = storyState.characterLocations as Record<string, string> | undefined
    if (characterLocations) {
      for (const val of Object.values(characterLocations)) {
        if (isMachineId(val)) referenced.add(val)
      }
    }
    const keyItemsLocation = storyState.keyItemsLocation as Record<string, string> | undefined
    if (keyItemsLocation) {
      for (const val of Object.values(keyItemsLocation)) {
        if (isMachineId(val)) referenced.add(val)
      }
    }
  }

  let changed = false
  for (const id of referenced) {
    if (locations[id]) continue
    locations[id] = {
      id,
      name: id,
      introducedIn: 0,
    }
    changed = true
  }
  return changed
}

function repairStoryDir(storyDir: string, userMapping: Record<string, string> = {}): void {
  const ctx: RepairContext = {
    storyDir,
    idMapping: new Map(),
    newForeshadows: new Map(),
    newTasks: new Map(),
    updatedFiles: [],
  }

  const memoryPath = join(storyDir, 'story-memory.json')
  const memory = loadJson(memoryPath) as Record<string, unknown>

  // 预先扫描 meta.json 与 checkpoints 中的 canonicalFacts，把非法 location 值也纳入映射
  const canonicalFactInvalidLocations: string[] = []
  const metaPath = join(storyDir, 'meta.json')
  const meta = loadJson(metaPath) as Record<string, unknown>
  canonicalFactInvalidLocations.push(
    ...collectInvalidCanonicalFactLocationValues(meta.storyState as Record<string, unknown>)
  )

  const checkpointsDir = join(storyDir, 'checkpoints')
  for (const entry of readdirSync(checkpointsDir)) {
    if (!entry.endsWith('.json')) continue
    const cp = loadJson(join(checkpointsDir, entry)) as Record<string, unknown>
    const channelValues = (cp.checkpoint as Record<string, unknown> | undefined)?.channel_values as
      Record<string, unknown> | undefined
    canonicalFactInvalidLocations.push(
      ...collectInvalidCanonicalFactLocationValues(
        channelValues?.storyState as Record<string, unknown>
      )
    )
  }

  const { mapping, newForeshadows, newTasks } = buildIdMapping(
    memory,
    canonicalFactInvalidLocations,
    userMapping
  )
  ctx.idMapping = mapping
  ctx.newForeshadows = newForeshadows
  ctx.newTasks = newTasks

  if (ctx.idMapping.size > 0) {
    console.log(`[repair-story-memory-ids] 发现 ${ctx.idMapping.size} 个非法 ID/值：`)
    for (const [from, to] of ctx.idMapping) {
      console.log(`  ${from} -> ${to}`)
    }
    if (newForeshadows.size > 0) {
      console.log(`[repair-story-memory-ids] 将新建 ${newForeshadows.size} 个 foreshadow 条目。`)
    }
    if (newTasks.size > 0) {
      console.log(`[repair-story-memory-ids] 将新建 ${newTasks.size} 个 task 条目。`)
    }
  } else {
    console.log(
      `[repair-story-memory-ids] ${storyDir} 中没有非法 ID，继续检查 location 实体完整性。`
    )
  }

  // 1. story-memory.json
  let repairedMemory: StoryMemory
  if (ctx.idMapping.size > 0) {
    repairedMemory = transformStoryMemory(memory, ctx) as unknown as StoryMemory
  } else {
    repairedMemory = memory as unknown as StoryMemory
  }
  const memoryChanged =
    ctx.idMapping.size > 0 ||
    ensureLocationEntitiesForReferencedIds(
      repairedMemory as unknown as Record<string, unknown>,
      meta.storyState as Record<string, unknown>
    )
  if (memoryChanged) {
    saveJson(memoryPath, repairedMemory)
    ctx.updatedFiles.push(memoryPath)
  }

  // 2. checkpoints
  for (const entry of readdirSync(checkpointsDir)) {
    if (!entry.endsWith('.json')) continue
    const cpPath = join(checkpointsDir, entry)
    const cp = loadJson(cpPath) as Record<string, unknown>
    const repairedCp = ctx.idMapping.size > 0 ? transformCheckpoint(cp, ctx) : cp
    const channelValues = (repairedCp.checkpoint as Record<string, unknown> | undefined)
      ?.channel_values as Record<string, unknown> | undefined
    if (channelValues?.storyMemory) {
      ensureLocationEntitiesForReferencedIds(
        channelValues.storyMemory as Record<string, unknown>,
        channelValues.storyState as Record<string, unknown>
      )
    }
    if (channelValues?.storyMemory && channelValues?.storyState) {
      channelValues.storyState = reprojectStoryState(
        channelValues.storyMemory as unknown as StoryMemory,
        channelValues.storyState as unknown as StoryState
      )
    }
    saveJson(cpPath, repairedCp)
    ctx.updatedFiles.push(cpPath)
  }

  // 3. meta.json：先替换非法 ID/值，再重新投影
  if (meta.storyState) {
    if (ctx.idMapping.size > 0) {
      meta.storyState = transformMetaStoryState(
        meta.storyState as Record<string, unknown>,
        ctx.idMapping
      )
    }
    meta.storyState = reprojectStoryState(repairedMemory, meta.storyState as unknown as StoryState)
    saveJson(metaPath, meta)
    ctx.updatedFiles.push(metaPath)
  }

  console.log(`[repair-story-memory-ids] 已更新 ${ctx.updatedFiles.length} 个文件：`)
  for (const file of ctx.updatedFiles) {
    console.log(`  - ${file}`)
  }
}

function parseArgs(args: string[]): { storyDir: string; userMapping: Record<string, string> } {
  if (args.length === 0) {
    console.error('用法：npx tsx scripts/repair-story-memory-ids.ts <story-dir> [--mapping <path>]')
    process.exit(1)
  }

  const storyDir = resolve(args[0]!)
  let userMapping: Record<string, string> = {}
  const mappingIndex = args.indexOf('--mapping')
  if (mappingIndex >= 0 && args[mappingIndex + 1]) {
    const mappingPath = resolve(args[mappingIndex + 1]!)
    try {
      const raw = loadJson(mappingPath) as Record<string, unknown>
      userMapping = Object.fromEntries(
        Object.entries(raw).filter(([, v]) => typeof v === 'string')
      ) as Record<string, string>
      console.log(`[repair-story-memory-ids] 已加载用户映射文件：${mappingPath}`)
    } catch (err) {
      console.error(`[repair-story-memory-ids] 无法加载映射文件 ${mappingPath}：`, err)
      process.exit(1)
    }
  }

  return { storyDir, userMapping }
}

function main(): void {
  const args = process.argv.slice(2)
  const { storyDir, userMapping } = parseArgs(args)
  repairStoryDir(storyDir, userMapping)
}

main()
