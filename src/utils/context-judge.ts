import type { ModelProvider, Message, JsonSchema } from '../model/provider.js'
import { logger } from './logger.js'
import type { Issue } from '../types/agent.js'

async function tryBatchJudge<T>(
  provider: ModelProvider,
  systemPrompt: string,
  items: string[],
  schema: JsonSchema,
  transform?: (raw: unknown) => T
): Promise<T[] | undefined> {
  if (items.length === 0) return []

  const messages: Message[] = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `请判断以下 ${items.length} 个条目，按顺序返回 JSON 数组：\n\n${items.map((item, i) => `${i + 1}. ${item}`).join('\n')}`,
    },
  ]

  let rawResponse: unknown
  try {
    if (provider.chatStructured) {
      const response = await provider.chatStructured<{ results: T[] }>(messages, schema, 0.1)
      rawResponse = response
      const results = response.results
      if (Array.isArray(results) && results.length === items.length) {
        return transform ? results.map(transform) : results
      }
      logger.warn(`[MuseFlow] chatStructured 返回的 results 长度不匹配：期望 ${items.length}，实际 ${Array.isArray(results) ? results.length : '非数组'}`)
      return undefined
    }

    const text = await provider.chat(messages, 0.1)
    rawResponse = text
    const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()
    const parsed = JSON.parse(cleaned) as { results: T[] }
    const results = parsed.results
    if (Array.isArray(results) && results.length === items.length) {
      return transform ? results.map(transform) : results
    }
    logger.warn(`[MuseFlow] chat 返回的 results 长度不匹配：期望 ${items.length}，实际 ${Array.isArray(results) ? results.length : '非数组'}`)
    return undefined
  } catch (err) {
    const preview = typeof rawResponse === 'string'
      ? rawResponse.slice(0, 200)
      : rawResponse !== undefined
        ? JSON.stringify(rawResponse).slice(0, 200)
        : '（无响应）'
    logger.warn(
      `[MuseFlow] 批量语境判断失败（条目数 ${items.length}）。响应预览：${preview}`,
      err
    )
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

  // 1. Try full batch first.
  const fullResult = await tryBatchJudge(provider, systemPrompt, items, schema, transform)
  if (fullResult) return fullResult

  // 2. If full batch failed and there are multiple items, split into halves and retry.
  if (items.length > 1) {
    logger.info(`[MuseFlow] 批量判断失败，尝试二分降级（条目数 ${items.length}）`)
    const mid = Math.ceil(items.length / 2)
    const left = items.slice(0, mid)
    const right = items.slice(mid)
    const [leftResult, rightResult] = await Promise.all([
      batchJudge(provider, systemPrompt, left, schema, fallback, transform),
      batchJudge(provider, systemPrompt, right, schema, fallback, transform),
    ])
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
    issue => `type=${issue.type}, severity=${issue.severity}, description=${issue.description}${issue.location ? `, location=${issue.location}` : ''}`
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
    issue => `type=${issue.type}, description=${issue.description}${issue.location ? `, location=${issue.location}` : ''}`
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
    items.map(i => `【本章大纲描述】\n${i.outlineDescription}\n\n【前章遗留差事】\n${i.taskDescription}`),
    schema,
    false
  )
}

interface EntityChangeResult {
  /** 若句子处于回忆、假设、梦境、条件或否定语境，则跳过此条。 */
  skip: boolean
  /** 提取到的新位置（地点），无则为 null。 */
  location: string | null
  /** 提取到的新状态，无则为 null。 */
  state: string | null
}

export async function batchExtractEntityChanges(
  provider: ModelProvider,
  items: Array<{ sentence: string; subject: string; attribute: '所在位置' | '状态' }>
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
          },
          required: ['skip', 'location', 'state'],
        },
      },
    },
    required: ['results'],
  }

  const defaultResult: EntityChangeResult = { skip: false, location: null, state: null }

  return batchJudge(
    provider,
    `你是小说状态抽取助手。对每条输入，判断句子中是否描述了 subject 的位置或状态变化：
- 若句子处于回忆、假设、梦境、条件句、未来计划或否定语境，则 skip=true，不提取。
- 若 attribute 为"所在位置"，提取 subject 所在的地点作为 location。
- 若 attribute 为"状态"，提取 subject 的状态作为 state。
- 只输出 JSON {"results": [{"skip": bool, "location": "..."|null, "state": "..."|null}, ...]}，顺序与输入一致。`,
    items.map(i => `attribute=${i.attribute}, subject=${i.subject}, sentence=${i.sentence}`),
    schema,
    defaultResult,
    raw => {
      if (typeof raw !== 'object' || raw === null) return defaultResult
      const r = raw as Record<string, unknown>
      return {
        skip: r.skip === true,
        location: typeof r.location === 'string' ? r.location : null,
        state: typeof r.state === 'string' ? r.state : null,
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
    texts.map(t => t.slice(0, 2000)),
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
    anchors.map(a => `anchor=${a.anchor}\npreviousContent=${a.previousContent.slice(0, 1200)}`),
    schema,
    { valid: true }
  )
}
