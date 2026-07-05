import type { ModelProvider, Message, JsonSchema } from '../model/provider.js'
import { logger } from './logger.js'
import type { Issue } from '../types/agent.js'

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
    `判断每个 issue 描述是否表示该 issue 被撤回、不成立、不构成问题、或已被否定。例如"此条不成立"、"不构成严重矛盾"、"重新审视后发现不成立"等。只输出 JSON {"results": [true/false, ...]}，顺序与输入一致。`,
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
    `判断每个描述是否表示"未发现问题"、"未检测到问题"、"无明显问题"等正面/无问题反馈。只输出 JSON {"results": [true/false, ...]}，顺序与输入一致。`,
    descriptions,
    schema,
    false
  )
}

export interface IssueClassification {
  isStructural: boolean
  isCrossChapter: boolean
  isTaskConsistency: boolean
  isItemLocationConflict: boolean
  isInventedCharacter: boolean
  isOutlineStateConflict: boolean
  isLocal: boolean
  isStateCorruption: boolean
  isInterpretive: boolean
}

export async function batchClassifyIssues(
  provider: ModelProvider,
  issues: Issue[]
): Promise<IssueClassification[]> {
  const schema: JsonSchema = {
    type: 'object',
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            isStructural: { type: 'boolean' },
            isCrossChapter: { type: 'boolean' },
            isTaskConsistency: { type: 'boolean' },
            isItemLocationConflict: { type: 'boolean' },
            isInventedCharacter: { type: 'boolean' },
            isOutlineStateConflict: { type: 'boolean' },
            isLocal: { type: 'boolean' },
            isStateCorruption: { type: 'boolean' },
            isInterpretive: { type: 'boolean' },
          },
          required: [
            'isStructural',
            'isCrossChapter',
            'isTaskConsistency',
            'isItemLocationConflict',
            'isInventedCharacter',
            'isOutlineStateConflict',
            'isLocal',
            'isStateCorruption',
            'isInterpretive',
          ],
        },
      },
    },
    required: ['results'],
  }

  const defaultClassification: IssueClassification = {
    // 分类失败时保守地视为结构性问题，避免漏掉需要重写的严重一致性错误。
    isStructural: true,
    isCrossChapter: false,
    isTaskConsistency: false,
    isItemLocationConflict: false,
    isInventedCharacter: false,
    isOutlineStateConflict: false,
    isLocal: false,
    isStateCorruption: false,
    isInterpretive: false,
  }

  const items = issues.map(
    (issue) =>
      `type=${issue.type}, severity=${issue.severity}, description=${issue.description}${issue.location ? `, location=${issue.location}` : ''}`
  )

  return batchJudge(
    provider,
    `你是小说质量检查 issue 分类助手。对每个 issue，判断以下标签：
- isStructural: 是否结构性问题（如大纲违规、时间线矛盾、逻辑问题、严重偏离大纲、跨章知识错误）。
- isCrossChapter: 是否涉及前章知识/跨章一致性。
- isTaskConsistency: 是否涉及前章遗留差事未执行或处理不当。
- isItemLocationConflict: 是否涉及物品位置矛盾。
- isInventedCharacter: 是否涉及虚构/非官方角色。
- isOutlineStateConflict: 是否涉及大纲状态/canonical fact 冲突。
- isLocal: 是否是 severity=error 且非结构性问题（由 isStructural 推导即可）。
- isStateCorruption: 是否为物品位置冲突、虚构角色、或大纲状态冲突之一。
- isInterpretive: 是否属于解释性、主观性或风格一致性问题（如描写冗余、语言拖沓、风格不一致、节奏欠佳等），这类问题在最后阶段可安全降级为 warning。

注意：isLocal 在 isStructural 为 false 且 severity 为 error 时为 true。isStateCorruption 在 isItemLocationConflict、isInventedCharacter、isOutlineStateConflict 任意一个为 true 时为 true。

只输出 JSON {"results": [{...}, ...]}，顺序与输入一致。`,
    items,
    schema,
    defaultClassification
  )
}

export function generateIssueFingerprint(issue: Issue): string {
  const dimension = issue.dimension ?? 'unknown'
  const subject = issue.subject ?? issue.description?.slice(0, 40) ?? 'no-subject'
  return `${dimension}:${subject}`
}

export async function batchGenerateIssueFingerprints(
  provider: ModelProvider,
  issues: Issue[]
): Promise<string[]> {
  const schema: JsonSchema = {
    type: 'object',
    properties: {
      results: { type: 'array', items: { type: 'string' } },
    },
    required: ['results'],
  }

  const items = issues.map(
    (issue) =>
      `type=${issue.type}, description=${issue.description}${issue.location ? `, location=${issue.location}` : ''}`
  )

  return batchJudge(
    provider,
    `你是 issue 去重助手。对每个 issue，生成一个稳定的语义指纹字符串。指纹应忽略表述差异，保留核心问题本质。例如"描写冗余"和"语言拖沓"应生成相同或相近指纹；"角色A在B处"和"角色A位于B"也应相近。指纹应只包含核心实体和关系，不要太长。只输出 JSON {"results": ["指纹1", "指纹2", ...]}，顺序与输入一致。`,
    items,
    schema,
    ''
  )
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
1. 如果差事的核心动作、关键角色或核心目标在本章大纲描述中有明确体现，返回 true。
2. 如果差事只是 deadline 落在本章、铺垫、过渡、支线、背景介绍，返回 false。
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
  items: Array<{ text: string; subject: string; attribute: '所在位置' | '状态' }>
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

  return batchJudge(
    provider,
    `你是小说状态抽取助手。对每条输入，判断文本中是否描述了 subject 的位置或状态变化：
- changeKind="explicit_change"：文本明确写出 subject 的新位置/当前所在/持有者，或明确写出移动、交出、收回、携带、放置 subject 的动作，足以建立新的权威状态。
- changeKind="scene_context"：文本只写了场景地点、人物所在地点、或章节发生地点，subject 的位置只是从场景上下文推断出来的。
- changeKind="ambiguous"：subject 被提到，但地点/状态关系不明确，或可能是同类物品、别名、泛称、背景说明。
- changeKind="not_present"：文本没有描述该 subject。
- 若文本处于回忆、假设、梦境、条件句、未来计划或否定语境，则 changeKind="ambiguous" 或 "not_present"，skip=true，不提取。
- 只有 changeKind="explicit_change" 时才填写 location 或 state，并设置 skip=false；其他情况必须 skip=true 且 location/state 为 null。
- 若 attribute 为"所在位置"，提取 subject 的明确位置或明确持有者作为 location。
- 若 attribute 为"状态"，提取 subject 的明确状态作为 state。
- 不得把章节场景地点、人物地点、或持有者所在场景自动当成 subject 的位置。
- 只输出 JSON {"results": [{"skip": bool, "location": "..."|null, "state": "..."|null, "changeKind": "explicit_change"|"scene_context"|"ambiguous"|"not_present"}, ...]}，顺序与输入一致。`,
    items.map((i) => `attribute=${i.attribute}, subject=${i.subject}, text=${i.text}`),
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
    `判断每个大纲片段是否明确出现叙事时间推进（如几天后、次日、明年等），即本章时间锚点应相对前章调整。只输出 JSON {"results": [true/false, ...]}，顺序与输入一致。`,
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
    `判断每个冲突描述是否属于需要作者立即决策的阻断性矛盾：
1. 已死亡/已遇害的角色再次登场、说话或行动。
2. 已揭示/已公开的秘密被再次隐藏，或已暴露的信息被再次保密。
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
- looksLikeRevisionPlan: 是否更像修改计划、问题分析、修复建议，而不是正式章节正文（如包含"问题分析"、"修复建议"、"应该"、"可以"、"需要"等大量建议性表达，或列表式修改点）。
- containsChecklistArtifacts: 是否包含预写对齐检查表、自检清单、Markdown 表格检查项、待办方框等残留。
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
2. 如果 anchor 声称上一章某个事件已经完成、落地、收束或解决，但该事件的核心内容未出现在 previousContent 中，返回 valid=false 并在 reason 中说明。
3. 否则返回 valid=true。
只输出 JSON {"results": [{"valid": bool, "reason": "..."|null}, ...]}，顺序与输入一致。`,
    anchors.map((a) => `anchor=${a.anchor}\npreviousContent=${a.previousContent.slice(0, 1200)}`),
    schema,
    { valid: true }
  )
}
