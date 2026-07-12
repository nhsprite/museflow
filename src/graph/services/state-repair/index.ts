import { logger } from '../../../utils/logger.js'
import type { Issue } from '../../../types/agent.js'
import type { CanonicalFact, FactAttribute, StoryState } from '../../../types/story-state.js'
import { factAttributeFromLabel } from '../../../types/story-state.js'
import type { StoryMemory } from '../../../types/story-memory.js'
import {
  chatStructuredFallback,
  type JsonSchema,
  type Message,
  type ModelProvider,
} from '../../../model/provider.js'
import { generateId } from '../../../utils/id.js'
import { createEmptyStoryState } from '../../../storage/meta/stores/story-state.js'
import { resolveEntityAttribute } from '../../../utils/canonical-facts.js'
import { mergeStoryState } from '../../utils/reconciler/state-merge.js'
import { formatStoryState } from '../../utils/reconciler/format.js'

/**
 * LLM 提出的单条状态修正提案。所有字段均为结构化数据：
 * subject/attribute/newValue 使用实体 id 与属性枚举，
 * evidenceChapter 为 1-based 章号，oldValue 必须与当前记录精确相等。
 */
export interface StateRepairProposal {
  subject: string
  attribute: string
  oldValue: string
  newValue: string
  evidenceChapter: number
  rationale: string
}

export interface StateRepairInput {
  /** 触发修复的状态污染类 error issue。 */
  issues: Issue[]
  storyState: StoryState
  storyMemory: StoryMemory | null
  /** 已定稿章节摘要（按章序），作为提案的叙事上下文。 */
  chapterSummaries: string[]
  /** 当前章 index（0-based）。 */
  currentChapterIndex: number
}

export interface StateRepairOutcome {
  /** 通过结构化校验并已写入的权威事实。 */
  acceptedFacts: CanonicalFact[]
  /** 合并了 acceptedFacts 的 storyState；无有效提案时返回原引用。 */
  storyState: StoryState
  rejectedCount: number
}

export interface StateRepairValidationContext {
  knownEntityIds: Set<string>
  locationEntityIds: Set<string>
  storyState: StoryState
  /** 当前章 index（0-based）；evidenceChapter 必须 < 当前章号。 */
  currentChapterIndex: number
}

const STATE_REPAIR_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    proposals: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          subject: { type: 'string' },
          attribute: { type: 'string' },
          oldValue: { type: 'string' },
          newValue: { type: 'string' },
          evidenceChapter: { type: 'number' },
          rationale: { type: 'string' },
        },
        required: ['subject', 'attribute', 'oldValue', 'newValue', 'evidenceChapter', 'rationale'],
      },
    },
  },
  required: ['proposals'],
}

function collectKnownEntityIds(memory: StoryMemory): Set<string> {
  return new Set([
    ...Object.keys(memory.entities.characters),
    ...Object.keys(memory.entities.items),
    ...Object.keys(memory.entities.locations),
    ...Object.keys(memory.entities.factions),
  ])
}

/**
 * 对单条提案做严格结构化校验（精确相等 / 枚举 / 已知 id 集合，不做任何模糊文本匹配）。
 */
export function validateStateRepairProposal(
  proposal: StateRepairProposal,
  ctx: StateRepairValidationContext
): { accepted: boolean; attribute?: FactAttribute; reason?: string } {
  const subject = typeof proposal.subject === 'string' ? proposal.subject.trim() : ''
  if (subject.length === 0 || !ctx.knownEntityIds.has(subject)) {
    return { accepted: false, reason: `subject ${proposal.subject} 不是已知实体 id` }
  }

  const rawAttribute = typeof proposal.attribute === 'string' ? proposal.attribute : ''
  const attribute = factAttributeFromLabel(rawAttribute.trim())
  if (attribute === null) {
    return { accepted: false, reason: `attribute ${rawAttribute} 不是可识别的属性枚举` }
  }

  const newValue = typeof proposal.newValue === 'string' ? proposal.newValue.trim() : ''
  if (newValue.length === 0) {
    return { accepted: false, reason: 'newValue 为空' }
  }
  if (attribute === 'location' && !ctx.locationEntityIds.has(newValue)) {
    return { accepted: false, attribute, reason: `newValue ${newValue} 不是已知地点实体 id` }
  }

  const { evidenceChapter } = proposal
  if (
    typeof evidenceChapter !== 'number' ||
    !Number.isInteger(evidenceChapter) ||
    evidenceChapter < 1 ||
    evidenceChapter > ctx.currentChapterIndex
  ) {
    return {
      accepted: false,
      attribute,
      reason: `evidenceChapter ${String(evidenceChapter)} 不是早于当前章的合法章号`,
    }
  }

  const recorded = resolveEntityAttribute(ctx.storyState, subject, attribute)
  if (recorded === undefined) {
    return { accepted: false, attribute, reason: `${subject}/${attribute} 当前无记录值可核对` }
  }
  if (proposal.oldValue !== recorded) {
    return {
      accepted: false,
      attribute,
      reason: `oldValue 与当前记录值不精确相等（记录值: ${recorded}）`,
    }
  }
  if (newValue === recorded) {
    return { accepted: false, attribute, reason: 'newValue 与当前记录值相同，无需修复' }
  }

  return { accepted: true, attribute }
}

function buildRepairMessages(input: StateRepairInput, memory: StoryMemory): Message[] {
  const chapterNumber = input.currentChapterIndex + 1
  const issuesText = input.issues
    .map((issue) => {
      const dimension = issue.dimension ? `（维度: ${issue.dimension}）` : ''
      const suggestion = issue.suggestion ? `\n  建议: ${issue.suggestion}` : ''
      return `- [${issue.type}]${dimension} ${issue.description}${suggestion}`
    })
    .join('\n')

  const knownEntityIds = collectKnownEntityIds(memory)
  const locationIds = Object.keys(memory.entities.locations)
  const recentSummaries = input.chapterSummaries.slice(-3)

  return [
    {
      role: 'system',
      content: `你是故事状态记录修复助手。你的任务是修正"与已定稿章节正文矛盾的状态记录"。

背景：状态记录（角色/物品的位置、状态、持有者等结构化字段）可能因历史章节的事件提取遗漏而过期，与已定稿章节的正文矛盾。此时正文是正确的，需要修正的是状态记录。

提案规则（必须全部遵守）：
1. 每条提案修正一条状态记录：subject（实体 id）、attribute（属性枚举）、oldValue（当前记录值）、newValue（修正后的值）、evidenceChapter（证据章号，1-based）、rationale（依据说明）。
2. subject 必须来自【已知实体 id】列表，不得创造新实体。
3. attribute 必须使用以下枚举值之一，禁止输出中文自然语言标签：location, status, origin, maker, giver, holder, identity, known_info, promise, attitude, dialogue, decision, plan, key_event, event, occurrence, result, twist。
4. attribute 为 location 时，newValue 必须来自【已知地点 id】列表。
5. oldValue 必须与【当前状态记录】中该 subject + attribute 的记录值完全一致。
6. 证据只能来自已定稿章节：evidenceChapter 必须小于当前章号（${chapterNumber}）。
7. 只修正确有正文证据支持的记录；无法确定正确值时不要提案。不要修改正文，不要推测未发生的情节。

请输出 JSON，格式为 {"proposals": [{"subject": "...", "attribute": "...", "oldValue": "...", "newValue": "...", "evidenceChapter": 1, "rationale": "..."}, ...]}。没有可修正的记录时返回 {"proposals": []}。`,
    },
    {
      role: 'user',
      content: `【当前章号】第 ${chapterNumber} 章

【待修复的状态问题】
${issuesText}

【当前状态记录】
${formatStoryState(input.storyState, memory.entities)}

【已知实体 id】
${[...knownEntityIds].join('、')}

【已知地点 id】
${locationIds.join('、') || '（无）'}

【已定稿章节摘要（最近）】
${recentSummaries.length > 0 ? recentSummaries.map((s, i) => `- ${i + 1}. ${s}`).join('\n') : '（无）'}

请输出 JSON。`,
    },
  ]
}

async function requestRepairProposals(
  input: StateRepairInput,
  memory: StoryMemory,
  provider: ModelProvider
): Promise<StateRepairProposal[]> {
  const messages = buildRepairMessages(input, memory)
  let raw: unknown
  if (provider.chatStructured) {
    try {
      raw = await provider.chatStructured<{ proposals: StateRepairProposal[] }>(
        messages,
        STATE_REPAIR_SCHEMA,
        0.2
      )
    } catch (structuredErr) {
      logger.debug(
        '[MuseFlow] 状态修复结构化输出失败，回退到普通 chat 解析:',
        structuredErr instanceof Error ? structuredErr.message : String(structuredErr)
      )
      raw = await chatStructuredFallback<{ proposals: StateRepairProposal[] }>(
        provider,
        messages,
        STATE_REPAIR_SCHEMA,
        0.2
      )
    }
  } else {
    raw = await chatStructuredFallback<{ proposals: StateRepairProposal[] }>(
      provider,
      messages,
      STATE_REPAIR_SCHEMA,
      0.2
    )
  }

  const parsed = raw as { proposals?: StateRepairProposal[] }
  return Array.isArray(parsed.proposals) ? parsed.proposals : []
}

/**
 * 基于状态污染类 issue 让 LLM 提出结构化状态修正提案，
 * 经严格结构化校验后写入权威事实（source: 'state_repair'），
 * 并立即合并进 storyState 使后续重渲染/重校验生效。
 *
 * 无任何提案通过校验时不修改状态（返回原 storyState 引用），
 * routing 下轮会因 stateRepairAttempted=true 退回人工 request_rewrite。
 */
export async function repairCorruptedState(
  input: StateRepairInput,
  provider: ModelProvider
): Promise<StateRepairOutcome> {
  if (input.issues.length === 0 || !input.storyMemory) {
    return { acceptedFacts: [], storyState: input.storyState, rejectedCount: 0 }
  }

  let proposals: StateRepairProposal[]
  try {
    proposals = await requestRepairProposals(input, input.storyMemory, provider)
  } catch (err) {
    logger.warn(
      '[MuseFlow] 状态修复提案生成失败，跳过自动修复:',
      err instanceof Error ? err.message : String(err)
    )
    return { acceptedFacts: [], storyState: input.storyState, rejectedCount: 0 }
  }

  const validationCtx: StateRepairValidationContext = {
    knownEntityIds: collectKnownEntityIds(input.storyMemory),
    locationEntityIds: new Set(Object.keys(input.storyMemory.entities.locations)),
    storyState: input.storyState,
    currentChapterIndex: input.currentChapterIndex,
  }

  const acceptedFacts: CanonicalFact[] = []
  let rejectedCount = 0
  for (const proposal of proposals) {
    const verdict = validateStateRepairProposal(proposal, validationCtx)
    if (!verdict.accepted) {
      rejectedCount++
      logger.info(
        `[MuseFlow] 状态修复提案被拒：${proposal.subject}/${proposal.attribute}（${verdict.reason}）`
      )
      continue
    }
    acceptedFacts.push({
      id: generateId('fact'),
      subject: proposal.subject.trim(),
      attribute: verdict.attribute!,
      value: proposal.newValue.trim(),
      establishedIn: input.currentChapterIndex,
      confidence: 'high',
      source: 'state_repair',
      evidence: {
        chapterIndex: proposal.evidenceChapter - 1,
        quote: proposal.rationale.slice(0, 200),
      },
    })
  }

  if (acceptedFacts.length === 0) {
    logger.warn('[MuseFlow] 状态修复未产生任何通过校验的提案，保持状态不变')
    return { acceptedFacts: [], storyState: input.storyState, rejectedCount }
  }

  logger.info(`[MuseFlow] 状态修复写入 ${acceptedFacts.length} 条权威事实（state_repair）`)
  for (const fact of acceptedFacts) {
    logger.info(`  - [${fact.subject}] ${fact.attribute}: ${fact.value}`)
  }

  const storyState = mergeStoryState(input.storyState, {
    ...createEmptyStoryState(),
    canonicalFacts: acceptedFacts,
  })

  return { acceptedFacts, storyState, rejectedCount }
}
