import type { ModelProvider, Message, JsonSchema } from '../model/provider.js'
import { logger } from './logger.js'
import type { Issue } from '../types/agent.js'
import type { FactAttribute } from '../types/story-state.js'
import { labelFromFactAttribute } from '../types/story-state.js'
import { extractChapterEndingSnippet } from '../graph/utils/chapter-window.js'

const MAX_BATCH_JUDGE_ITEMS = 20

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function itemId(index: number): string {
  return `item_${index + 1}`
}

function getResultsItemSchema(schema: JsonSchema): unknown {
  const results = schema.properties['results']
  if (!isRecord(results)) return {}
  return results['items'] ?? {}
}

function buildIndexedResultsSchema(schema: JsonSchema): JsonSchema {
  return {
    type: 'object',
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            value: getResultsItemSchema(schema),
          },
          required: ['id', 'value'],
        },
      },
    },
    required: ['results'],
  }
}

function mapResult<T>(raw: unknown, transform?: (raw: unknown) => T): T {
  return transform ? transform(raw) : (raw as T)
}

function parseBatchResults<T>(
  rawResults: unknown,
  expectedIds: string[],
  transform?: (raw: unknown) => T
): T[] | undefined {
  if (!Array.isArray(rawResults)) return undefined

  const hasIndexedResult = rawResults.some(
    (result) => isRecord(result) && typeof result['id'] === 'string' && 'value' in result
  )

  if (hasIndexedResult) {
    const expected = new Set(expectedIds)
    const byId = new Map<string, unknown>()
    for (const result of rawResults) {
      if (!isRecord(result) || typeof result['id'] !== 'string' || !('value' in result)) {
        return undefined
      }
      const id = result['id']
      if (!expected.has(id)) {
        continue
      }
      if (byId.has(id)) {
        return undefined
      }
      byId.set(id, result['value'])
    }
    if (!expectedIds.every((id) => byId.has(id))) {
      return undefined
    }
    return expectedIds.map((id) => mapResult(byId.get(id), transform))
  }

  if (rawResults.length !== expectedIds.length) {
    return undefined
  }
  return rawResults.map((result) => mapResult(result, transform))
}

function describeResults(rawResults: unknown): string {
  if (Array.isArray(rawResults)) {
    return `数组（长度 ${rawResults.length}）`
  }
  if (rawResults === undefined) {
    return '未定义'
  }
  return `${typeof rawResults}（${JSON.stringify(rawResults).slice(0, 200)}）`
}

async function tryBatchJudge<T>(
  provider: ModelProvider,
  systemPrompt: string,
  items: string[],
  schema: JsonSchema,
  transform?: (raw: unknown) => T
): Promise<T[] | undefined> {
  if (items.length === 0) return []

  const ids = items.map((_item, i) => itemId(i))
  const messages: Message[] = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `请判断以下 ${items.length} 个条目。每个条目都有 ITEM_ID。\n\n返回要求：\n- 只输出 JSON，格式为 {"results":[{"id":"item_1","value":...}, ...]}。\n- results 必须包含每个输入 ITEM_ID；不要新增、删除、合并或改写 ITEM_ID。\n- value 按系统任务要求填写。\n\n${items.map((item, i) => `ITEM_ID=${ids[i]}\n${item}`).join('\n\n')}`,
    },
  ]

  let rawResponse: unknown
  try {
    if (provider.chatStructured) {
      const response = await provider.chatStructured<{ results: unknown[] }>(
        messages,
        buildIndexedResultsSchema(schema),
        0.1
      )
      rawResponse = response
      const results = response.results
      const parsed = parseBatchResults(results, ids, transform)
      if (parsed) {
        return parsed
      }
      const actualDesc = describeResults(results)
      const preview = JSON.stringify(rawResponse).slice(0, 400)
      logger.warn(
        `[MuseFlow] chatStructured 返回的 results 不匹配：期望 ${items.length} 个，实际 ${actualDesc}。响应预览：${preview}`
      )
      return undefined
    }

    const text = await provider.chat(messages, 0.1)
    rawResponse = text
    const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()
    const response = JSON.parse(cleaned) as { results: unknown[] }
    const results = response.results
    const parsed = parseBatchResults(results, ids, transform)
    if (parsed) {
      return parsed
    }
    const actualDesc = describeResults(results)
    logger.warn(
      `[MuseFlow] chat 返回的 results 不匹配：期望 ${items.length} 个，实际 ${actualDesc}。响应预览：${rawResponse?.toString().slice(0, 400)}`
    )
    return undefined
  } catch (err) {
    const preview =
      typeof rawResponse === 'string'
        ? rawResponse.slice(0, 200)
        : rawResponse !== undefined
          ? JSON.stringify(rawResponse).slice(0, 200)
          : '（无响应）'
    logger.warn(`[MuseFlow] 批量语境判断失败（条目数 ${items.length}）。响应预览：${preview}`, err)
    return undefined
  }
}

async function batchJudge<T>(
  provider: ModelProvider,
  systemPrompt: string,
  items: string[],
  schema: JsonSchema,
  fallback: T,
  transform?: (raw: unknown) => T
): Promise<T[]> {
  if (items.length === 0) return []

  if (items.length > MAX_BATCH_JUDGE_ITEMS) {
    logger.debug(
      `[MuseFlow] 批量判断条目较多，按 ${MAX_BATCH_JUDGE_ITEMS} 条分块处理（条目数 ${items.length}）`
    )
    const results: T[] = []
    for (let start = 0; start < items.length; start += MAX_BATCH_JUDGE_ITEMS) {
      const chunk = items.slice(start, start + MAX_BATCH_JUDGE_ITEMS)
      results.push(
        ...(await batchJudge(provider, systemPrompt, chunk, schema, fallback, transform))
      )
    }
    return results
  }

  // 1. Try full batch first.
  const fullResult = await tryBatchJudge(provider, systemPrompt, items, schema, transform)
  if (fullResult) return fullResult

  // 2. If full batch failed and there are multiple items, split into halves and retry.
  if (items.length > 1) {
    logger.info(`[MuseFlow] 批量判断失败，尝试二分降级（条目数 ${items.length}）`)
    const mid = Math.ceil(items.length / 2)
    const left = items.slice(0, mid)
    const right = items.slice(mid)
    const leftResult = await batchJudge(provider, systemPrompt, left, schema, fallback, transform)
    const rightResult = await batchJudge(provider, systemPrompt, right, schema, fallback, transform)
    return [...leftResult, ...rightResult]
  }

  // 3. Single item also failed: use fallback.
  logger.warn(`[MuseFlow] 单条语境判断失败，使用回退值。`)
  return items.map(() => fallback)
}

export async function batchJudgeWithdrawnIssues(
  provider: ModelProvider,
  descriptions: string[]
): Promise<boolean[]> {
  const schema: JsonSchema = {
    type: 'object',
    properties: {
      results: { type: 'array', items: { type: 'boolean' } },
    },
    required: ['results'],
  }

  return batchJudge(
    provider,
    `判断每个 issue 描述是否表示该 issue 被撤回、不成立、不构成问题、或已被否定。关注结论的语义倾向（否定性、撤销性、重新评估后判定无效），而非具体措辞。只输出 JSON {"results": [true/false, ...]}，顺序与输入一致。`,
    descriptions,
    schema,
    false
  )
}

export async function batchJudgePositiveFeedback(
  provider: ModelProvider,
  descriptions: string[]
): Promise<boolean[]> {
  const schema: JsonSchema = {
    type: 'object',
    properties: {
      results: { type: 'array', items: { type: 'boolean' } },
    },
    required: ['results'],
  }

  return batchJudge(
    provider,
    `判断每个描述是否表示正面/无问题反馈（即审查后认为当前内容已满足要求、不存在需要修改的问题）。关注结论的语义倾向，而非具体措辞。只输出 JSON {"results": [true/false, ...]}，顺序与输入一致.`,
    descriptions,
    schema,
    false
  )
}

/**
 * 对 issue 元数据（description）做确定性哈希，用于生成跨轮稳定的指纹。
 * 这是机器可读元数据的哈希，不是对 prose 的语义匹配。
 */
function hashIssueDescription(description: string): string {
  let hash = 5381
  for (let i = 0; i < description.length; i++) {
    hash = ((hash << 5) + hash + description.charCodeAt(i)) >>> 0
  }
  return hash.toString(16)
}

export function generateIssueFingerprint(issue: Issue): string {
  const dimension = issue.dimension ?? 'unknown'
  const source = issue.source ?? 'unknown'
  const location = issue.locationRef
    ? `p${issue.locationRef.paragraphIndex ?? -1}s${issue.locationRef.sentenceIndex ?? -1}`
    : ''

  // 优先使用结构化字段生成指纹，减少对 description 自然语言文本的依赖。
  if (issue.subject) {
    return `${issue.type}:${dimension}:${source}:${issue.subject}${location ? ':' + location : ''}`
  }
  if (location) {
    return `${issue.type}:${dimension}:${source}:${location}:${hashIssueDescription(issue.description)}`
  }
  // 无结构化字段时以 description 哈希兜底，保证跨轮指纹稳定。
  return `${issue.type}:${dimension}:${source}:__generic__:${hashIssueDescription(issue.description)}`
}

export async function batchJudgeTaskRelevance(
  provider: ModelProvider,
  items: Array<{ taskDescription: string; outlineDescription: string }>
): Promise<boolean[]> {
  const schema: JsonSchema = {
    type: 'object',
    properties: {
      results: { type: 'array', items: { type: 'boolean' } },
    },
    required: ['results'],
  }

  return batchJudge(
    provider,
    `你是小说章节规划校验助手。判断每个前章遗留差事是否与本章大纲描述直接相关：
1. 如果差事的核心内容在本章大纲描述中有明确体现，返回 true。
2. 如果差事只是时间 deadline 落在本章、或仅作为辅助性叙事功能出现（未直接推进差事核心内容），返回 false。
3. 只输出 JSON {"results": [true/false, ...]}，顺序与输入一致，不要解释。`,
    items.map(
      (i) => `【本章大纲描述】\n${i.outlineDescription}\n\n【前章遗留差事】\n${i.taskDescription}`
    ),
    schema,
    false
  )
}

export type EntityChangeKind = 'explicit_change' | 'scene_context' | 'ambiguous' | 'not_present'

export interface EntityChangeResult {
  /** 若句子处于回忆、假设、梦境、条件或否定语境，则跳过此条。 */
  skip: boolean
  /** 提取到的新位置（地点），无则为 null。 */
  location: string | null
  /** 提取到的新状态，无则为 null。 */
  state: string | null
  /** 描述文本与 subject 变更之间的关系。只有 explicit_change 可以驱动 storyState 更新。 */
  changeKind: EntityChangeKind
}

function parseEntityChangeKind(value: unknown): EntityChangeKind {
  switch (value) {
    case 'explicit_change':
    case 'scene_context':
    case 'ambiguous':
    case 'not_present':
      return value
    default:
      return 'not_present'
  }
}

export async function batchExtractEntityChanges(
  provider: ModelProvider,
  items: Array<{ text: string; subject: string; attribute: FactAttribute }>
): Promise<EntityChangeResult[]> {
  const schema: JsonSchema = {
    type: 'object',
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            skip: { type: 'boolean' },
            location: { type: ['string', 'null'] },
            state: { type: ['string', 'null'] },
            changeKind: {
              type: 'string',
              enum: ['explicit_change', 'scene_context', 'ambiguous', 'not_present'],
            },
          },
          required: ['skip', 'location', 'state', 'changeKind'],
        },
      },
    },
    required: ['results'],
  }

  const defaultResult: EntityChangeResult = {
    skip: true,
    location: null,
    state: null,
    changeKind: 'not_present',
  }

  const attributeLabels = ['location', 'status']
    .map((attr) => `${attr}=${labelFromFactAttribute(attr as FactAttribute)}`)
    .join('\n')

  return batchJudge(
    provider,
    `你是小说状态抽取助手。对每条输入，判断文本中是否描述了 subject 的指定属性变化：
- changeKind="explicit_change"：文本明确写出 subject 的新属性值，或明确写出导致该属性值改变的动作，足以建立新的权威状态。
- changeKind="scene_context"：属性值只是从场景、上下文或其他人物的同类属性中推断出来的，文本没有直接说明 subject 本身。
- changeKind="ambiguous"：subject 被提到，但属性关系不明确，或可能是同类对象、别名、泛称、背景说明。
- changeKind="not_present"：文本没有描述该 subject 的该属性。
- 若文本处于非现实、假设、条件、计划或否定语境，则 changeKind="ambiguous" 或 "not_present"，skip=true，不提取。
- 只有 changeKind="explicit_change" 时才填写 location 或 state，并设置 skip=false；其他情况必须 skip=true 且 location/state 为 null。
- 当前支持的属性标签映射如下：
${attributeLabels}
- 当 attribute 为 location 时，提取 subject 的明确位置或明确持有者作为 location。
- 当 attribute 为 status 时，提取 subject 的明确状态作为 state。
- 不得把章节场景、其他人物的状态/位置、或持有者所在场景自动当成 subject 的属性值。
- 只输出 JSON {"results": [{"skip": bool, "location": "..."|null, "state": "..."|null, "changeKind": "explicit_change"|"scene_context"|"ambiguous"|"not_present"}, ...]}，顺序与输入一致。`,
    items.map(
      (i) =>
        `attribute=${labelFromFactAttribute(i.attribute)}, subject=${i.subject}, text=${i.text}`
    ),
    schema,
    defaultResult,
    (raw) => {
      if (typeof raw !== 'object' || raw === null) return defaultResult
      const r = raw as Record<string, unknown>
      return {
        skip: r.skip === true,
        location: typeof r.location === 'string' ? r.location : null,
        state: typeof r.state === 'string' ? r.state : null,
        changeKind: parseEntityChangeKind(r.changeKind),
      }
    }
  )
}

export async function batchDetectTimeJumps(
  provider: ModelProvider,
  outlines: string[]
): Promise<boolean[]> {
  const schema: JsonSchema = {
    type: 'object',
    properties: {
      results: { type: 'array', items: { type: 'boolean' } },
    },
    required: ['results'],
  }

  return batchJudge(
    provider,
    `判断每个大纲片段是否明确出现相对前章的叙事时间推进。关注时间推进的语义，而非具体措辞。只输出 JSON {"results": [true/false, ...]}，顺序与输入一致。`,
    outlines,
    schema,
    false
  )
}

interface FixedContentValidation {
  looksLikeRevisionPlan: boolean
  containsChecklistArtifacts: boolean
}

export async function batchJudgeBlockingConflictDescriptions(
  provider: ModelProvider,
  descriptions: string[]
): Promise<boolean[]> {
  const schema: JsonSchema = {
    type: 'object',
    properties: {
      results: { type: 'array', items: { type: 'boolean' } },
    },
    required: ['results'],
  }

  return batchJudge(
    provider,
    `判断每个冲突描述是否属于需要作者立即决策的阻断性矛盾：即描述表明某个已被前置章节确立为已发生状态的关键事实在本章被反向处理。关注事实状态的前后逆转，而非具体措辞。
只输出 JSON {"results": [true/false, ...]}，顺序与输入一致。`,
    descriptions,
    schema,
    false
  )
}

export async function batchValidateFixedContent(
  provider: ModelProvider,
  texts: string[]
): Promise<FixedContentValidation[]> {
  const schema: JsonSchema = {
    type: 'object',
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            looksLikeRevisionPlan: { type: 'boolean' },
            containsChecklistArtifacts: { type: 'boolean' },
          },
          required: ['looksLikeRevisionPlan', 'containsChecklistArtifacts'],
        },
      },
    },
    required: ['results'],
  }

  const defaultResult: FixedContentValidation = {
    looksLikeRevisionPlan: false,
    containsChecklistArtifacts: false,
  }

  return batchJudge(
    provider,
    `你是小说正文质量校验助手。对每段文本，判断：
- looksLikeRevisionPlan: 是否更像修改计划、问题分析、修复建议，而不是正式章节正文。关注文本是否承担建议、计划或指令功能，而非具体措辞。
- containsChecklistArtifacts: 是否包含机器/计划性残留内容，而非正常叙事文本。关注非叙事内容的结构化形态，而非具体措辞。
只输出 JSON {"results": [{"looksLikeRevisionPlan": bool, "containsChecklistArtifacts": bool}, ...]}，顺序与输入一致。`,
    texts.map((t) => t.slice(0, 2000)),
    schema,
    defaultResult
  )
}

interface TimeAnchorValidation {
  valid: boolean
  reason?: string
}

export async function batchValidateTimeAnchors(
  provider: ModelProvider,
  anchors: Array<{ anchor: string; previousContent: string }>
): Promise<TimeAnchorValidation[]> {
  const schema: JsonSchema = {
    type: 'object',
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            valid: { type: 'boolean' },
            reason: { type: ['string', 'null'] },
          },
          required: ['valid'],
        },
      },
    },
    required: ['results'],
  }

  return batchJudge(
    provider,
    `你是小说时间锚点校验助手。对每个 chapterTimeAnchor 和上一章正文片段，判断锚点是否有效：
1. 如果 anchor 不涉及上一章（无时间回指），返回 valid=true。
2. 如果 anchor 声称上一章某个事件已经达成终态，但该事件的核心内容未出现在 previousContent 中，返回 valid=false 并在 reason 中说明。
3. 否则返回 valid=true。
只输出 JSON {"results": [{"valid": bool, "reason": "..."|null}, ...]}，顺序与输入一致。`,
    anchors.map(
      // 上一章事件的终态几乎总在结尾，取结尾片段与 detect_continuity 的口径保持一致。
      (a) => `anchor=${a.anchor}\npreviousContent=${extractChapterEndingSnippet(a.previousContent)}`
    ),
    schema,
    { valid: true }
  )
}
