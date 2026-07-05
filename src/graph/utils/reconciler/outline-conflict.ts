import { logger } from '../../../utils/logger.js'
import type {
  StoryState,
  Conflict,
  ConflictSeverity,
  CanonicalFact,
} from '../../../types/story-state.js'
import type { ModelProvider, Message, JsonSchema } from '../../../model/provider.js'
import type { StoryMemory, StoryEvent } from '../../../types/story-memory.js'
import type { StoryArc } from '../../../types/outline.js'
import { generateId } from '../../../utils/id.js'
import { detectEntityConflictsFromMemory } from './conflict.js'

interface OutlineAuthorizedFact {
  subject: string
  attribute: string
  value: string
  contradictsExisting: boolean
}

const OUTLINE_AUTHORIZATION_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    facts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          subject: { type: 'string' },
          attribute: { type: 'string' },
          value: { type: 'string' },
          contradictsExisting: { type: 'boolean' },
        },
        required: ['subject', 'attribute', 'value', 'contradictsExisting'],
      },
    },
  },
  required: ['facts'],
}

function canonicalFactExists(
  facts: CanonicalFact[] | undefined,
  subject: string,
  attribute: string,
  value: string
): boolean {
  if (!facts || facts.length === 0) return false
  return facts.some((f) => f.subject === subject && f.attribute === attribute && f.value === value)
}

function canonicalFactConflicts(
  facts: CanonicalFact[] | undefined,
  subject: string,
  attribute: string
): boolean {
  if (!facts || facts.length === 0) return false
  return facts.some((f) => f.subject === subject && f.attribute === attribute)
}

/**
 * 从本章大纲中提取首次引入、且不与已有 canonicalFacts 矛盾的具体事实，
 * 作为本章起草前的预授权权威事实写入 storyState。
 *
 * 这是通用机制：不针对特定书籍、题材或章节，仅基于大纲文本和已有权威事实做判断。
 */
export async function authorizeOutlineFacts(
  state: StoryState,
  outline: string,
  chapterIndex: number,
  provider?: ModelProvider
): Promise<CanonicalFact[]> {
  if (!provider || !outline || outline.trim().length === 0) {
    return []
  }

  const existingFacts = state.canonicalFacts ?? []
  const factsText = formatCanonicalFacts(state)

  const messages: Message[] = [
    {
      role: 'system',
      content: `你是故事大纲事实提取助手。你的任务是从本章大纲中提取本章首次引入的、具体的故事事实，用于写入权威事实库。

提取范围（只提取具体、持久、会影响后续章节一致性的事实）：
1. 新地点：角色或物品前往、所在、转移到的具体地点。
2. 新物品细节：物品新增的外观特征、来源、归属、状态变化。
3. 新角色状态/关系：由本章大纲确立的持久状态、身份关系、约束条件。

判断规则：
- 只提取大纲中明确写入的事实，不要推测或补全。
- 如果某个事实已经在"已确立的权威事实"中记录，不要重复提取。
- 如果某个事实与"已确立的权威事实"直接矛盾（同一 subject + attribute 但值不同），将 contradictsExisting 设为 true，不要返回它。
- 不要提取一次性动作、情绪描写、氛围描写、纯过渡内容。
- attribute 请使用简洁中文标签，如"所在位置"、"状态"、"来源"、"归属"、"关系"等。

请输出 JSON，格式为 {"facts": [{"subject": "...", "attribute": "...", "value": "...", "contradictsExisting": false}, ...]}。`,
    },
    {
      role: 'user',
      content: `【本章大纲】\n${outline}\n\n【已确立的权威事实】\n${factsText}\n\n请输出 JSON。`,
    },
  ]

  try {
    let raw: unknown
    if (provider.chatStructured) {
      try {
        raw = await provider.chatStructured<{ facts: OutlineAuthorizedFact[] }>(
          messages,
          OUTLINE_AUTHORIZATION_SCHEMA,
          0.3
        )
      } catch (structuredErr) {
        // 部分兼容端（如 MiniMax-M3 通过 Anthropic 协议）会返回 markdown 包裹的 JSON 或截断 JSON
        logger.debug(
          '结构化输出失败，回退到普通 chat 解析:',
          structuredErr instanceof Error ? structuredErr.message : String(structuredErr)
        )
        const text = await provider.chat(messages, 0.3)
        raw = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim())
      }
    } else {
      const text = await provider.chat(messages, 0.3)
      raw = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim())
    }

    const parsed = raw as { facts?: OutlineAuthorizedFact[] }
    const facts: CanonicalFact[] = []
    const skipped: string[] = []

    for (const fact of parsed.facts ?? []) {
      if (!fact.subject || !fact.attribute || !fact.value) continue
      const subject = fact.subject.trim()
      const attribute = fact.attribute.trim()
      const value = fact.value.trim()
      if (subject.length === 0 || attribute.length === 0 || value.length === 0) continue

      if (fact.contradictsExisting || canonicalFactConflicts(existingFacts, subject, attribute)) {
        skipped.push(`${subject}/${attribute}`)
        continue
      }

      if (canonicalFactExists(existingFacts, subject, attribute, value)) {
        continue
      }

      facts.push({
        id: generateId('fact'),
        subject,
        attribute,
        value,
        establishedIn: chapterIndex,
        confidence: 'medium',
        source: 'outline_inference',
      })
    }

    if (facts.length > 0) {
      logger.info(`大纲预授权 ${facts.length} 个新事实`)
      for (const f of facts) {
        logger.debug(`  - [${f.subject}] ${f.attribute}: ${f.value}`)
      }
    }

    if (skipped.length > 0) {
      logger.info(`大纲预授权跳过 ${skipped.length} 个与权威事实冲突/重复的条目`)
      for (const s of skipped) {
        logger.debug(`  - ${s}`)
      }
    }

    return facts
  } catch (err) {
    logger.warn(
      '[MuseFlow] 大纲事实预授权失败，跳过:',
      err instanceof Error ? err.message : String(err)
    )
    return []
  }
}

interface OutlineStateConflictResult {
  conflicts: Array<{
    subject: string
    attribute: string
    oldValue: string
    newValue: string
    severity: ConflictSeverity
    description: string
  }>
  constraints: string[]
}

const DETECTION_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    conflicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          subject: { type: 'string' },
          attribute: { type: 'string' },
          oldValue: { type: 'string' },
          newValue: { type: 'string' },
          severity: { type: 'string', enum: ['auto', 'warning', 'blocking'] },
          description: { type: 'string' },
        },
        required: ['subject', 'attribute', 'oldValue', 'newValue', 'severity', 'description'],
      },
    },
    constraints: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['conflicts', 'constraints'],
}

function buildOutlineStateConflictId(subject: string, attribute: string, index: number): string {
  return `outline-state:${subject}:${attribute}:${index}`
}

function formatCanonicalFacts(state: StoryState): string {
  const facts = state.canonicalFacts ?? []
  if (facts.length === 0) return '（暂无权威事实）'

  return facts
    .map((f) => {
      const lines = [
        `- [${f.subject}] ${f.attribute}: ${f.value}（第${f.establishedIn + 1}章确立）`,
      ]
      if (f.supersedes && f.supersedes.length > 0) {
        for (const old of f.supersedes) {
          lines.push(`  覆盖第${old.chapter + 1}章旧值: ${old.oldValue}`)
        }
      }
      return lines.join('\n')
    })
    .join('\n')
}

export function extractOutlineEvents(outline: StoryArc): StoryEvent[] {
  return outline.keyBeats.map((beat) => ({
    id: `outline-beat-${beat.id}`,
    type: 'plot-advance' as const,
    plotId: 'outline',
    beatId: beat.id,
    chapterIndex: 0,
    source: 'outline' as const,
  }))
}

export async function detectOutlineStateConflicts(
  state: StoryState & { storyMemory?: StoryMemory | null },
  outline: string,
  chapterIndex: number,
  provider?: ModelProvider,
  storyArc?: StoryArc
): Promise<{ conflicts: Conflict[]; constraints: string[] }> {
  if (!outline || outline.trim().length === 0) {
    return { conflicts: [], constraints: [] }
  }

  if (state.storyMemory && storyArc) {
    const outlineEvents = extractOutlineEvents(storyArc)
    const conflicts = detectEntityConflictsFromMemory(state.storyMemory, outlineEvents)
    return { conflicts, constraints: [] }
  }

  if (!provider) {
    return { conflicts: [], constraints: [] }
  }

  const factsText = formatCanonicalFacts(state)

  const messages: Message[] = [
    {
      role: 'system',
      content: `你是故事状态-大纲对齐检测助手。你的任务是：
1. 检查本章大纲要求是否与已确立的权威事实（canonical facts）存在潜在冲突。
2. 识别权威事实中对本章大纲构成硬约束的事实，并输出为 constraints。

判断规则：
- 如果权威事实明确记录了某个限制、承诺、约定、策略底线，而本章大纲似乎要求违反该限制，则报冲突。
- 如果权威事实只是普通的位置/状态记录，而大纲正常推进了该位置/状态的变化，不要报冲突。
- 如果冲突导致大纲核心动作无法执行（权威事实已使该动作的前提不成立），severity 为 blocking。
- 如果只是需要作者在写作时特别留意、明确交代，severity 为 warning。
- 不要编造权威事实中没有的冲突；不要基于常识推断，只基于提供的 canonical facts。

请输出 JSON，包含 conflicts 数组和 constraints 字符串数组。`,
    },
    {
      role: 'user',
      content: `【第 ${chapterIndex + 1} 章大纲】\n${outline}\n\n【已确立的权威事实】\n${factsText}\n\n请输出 JSON：\n{\n  "conflicts": [...],\n  "constraints": ["约束1", "约束2", ...]\n}`,
    },
  ]

  try {
    let raw: unknown
    if (provider.chatStructured) {
      try {
        raw = await provider.chatStructured<OutlineStateConflictResult>(
          messages,
          DETECTION_SCHEMA,
          0.3
        )
      } catch (structuredErr) {
        logger.debug(
          '结构化大纲-状态冲突检测失败，回退到普通 chat 解析:',
          structuredErr instanceof Error ? structuredErr.message : String(structuredErr)
        )
        const text = await provider.chat(messages, 0.3)
        raw = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim())
      }
    } else {
      const text = await provider.chat(messages, 0.3)
      raw = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim())
    }

    const parsed = raw as OutlineStateConflictResult
    const conflicts: Conflict[] = (parsed.conflicts ?? []).map((c, idx) => ({
      id: buildOutlineStateConflictId(c.subject, c.attribute, idx),
      type: 'contradiction',
      subject: c.subject,
      attribute: c.attribute,
      oldValue: c.oldValue,
      newValue: c.newValue,
      outlineReference: outline.slice(0, 200),
      severity: c.severity,
      description: c.description,
    }))

    const constraints = (parsed.constraints ?? []).filter(
      (c): c is string => typeof c === 'string' && c.length > 0
    )

    if (conflicts.length > 0) {
      logger.info(`[MuseFlow] 检测到 ${conflicts.length} 个大纲-状态潜在冲突`)
      for (const c of conflicts) {
        logger.info(`  - [${c.severity}] ${c.description}`)
      }
    }

    return { conflicts, constraints }
  } catch (err) {
    logger.warn(
      '[MuseFlow] 大纲-状态冲突检测失败，跳过:',
      err instanceof Error ? err.message : String(err)
    )
    return { conflicts: [], constraints: [] }
  }
}
