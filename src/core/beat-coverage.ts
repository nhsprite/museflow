import {
  chatStructuredFallback,
  type JsonSchema,
  type Message,
  type ModelProvider,
} from '../model/provider.js'
import type { StoryArc } from '../types/outline.js'
import type { BeatId, StoryMemory } from '../types/story-memory.js'
import { logger } from '../utils/logger.js'
import { getMandatoryBeatEntries, type MandatoryBeatEntry } from '../utils/mandatory-beat-ids.js'

export {
  getCoveredMandatoryBeatId,
  getVerifiedBeatIdsWithCoverage,
  isBeatProven,
  mergeKeyBeatCoverageMetadata,
} from '../utils/beat-coverage.js'

interface BeatCoverageDecision {
  keyBeatId: BeatId
  covered: boolean
  mandatoryBeatId: BeatId
}

interface BeatCoverageAuditResult {
  decisions: BeatCoverageDecision[]
}

export interface BeatCoverageAudit {
  storyArc: StoryArc
  changed: boolean
  linkedKeyBeatIds: BeatId[]
  independentKeyBeatIds: BeatId[]
}

const BEAT_COVERAGE_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          keyBeatId: { type: 'string' },
          covered: { type: 'boolean' },
          mandatoryBeatId: { type: 'string' },
        },
        required: ['keyBeatId', 'covered', 'mandatoryBeatId'],
        additionalProperties: false,
      },
    },
  },
  required: ['decisions'],
}

const BEAT_COVERAGE_SYSTEM_PROMPT = `你是长篇叙事结构审计员。请判断每个 key beat 是否已经被某个 mandatory beat 完整覆盖。

只有完成 mandatory beat 必然同时完成 key beat 的全部叙事义务时，才能判定 covered=true。仅仅主题相关、部分重叠、前置铺垫、后续结果或同一角色参与都不构成覆盖。
mandatoryBeatId 只能从该 key beat 提供的 candidates 中选择。若没有完整覆盖项，返回 covered=false 且 mandatoryBeatId 为空字符串。
每个 keyBeatId 必须且只能返回一次，不得利用输入之外的故事信息。`

function parseCoverageDecisions(
  raw: unknown,
  candidates: StoryArc['keyBeats'],
  allowedMandatoryIds: ReadonlyMap<BeatId, ReadonlySet<BeatId>>
): BeatCoverageDecision[] | null {
  if (!raw || typeof raw !== 'object') return null
  const decisions = (raw as Partial<BeatCoverageAuditResult>).decisions
  if (!Array.isArray(decisions) || decisions.length !== candidates.length) return null

  const candidateIds = new Set(candidates.map((candidate) => candidate.id))
  const seen = new Set<BeatId>()
  const parsed: BeatCoverageDecision[] = []
  for (const decision of decisions) {
    if (!decision || typeof decision !== 'object') return null
    const value = decision as Partial<BeatCoverageDecision>
    if (
      typeof value.keyBeatId !== 'string' ||
      !candidateIds.has(value.keyBeatId) ||
      seen.has(value.keyBeatId) ||
      typeof value.covered !== 'boolean' ||
      typeof value.mandatoryBeatId !== 'string'
    ) {
      return null
    }
    if (value.covered) {
      if (!allowedMandatoryIds.get(value.keyBeatId)?.has(value.mandatoryBeatId)) return null
    } else if (value.mandatoryBeatId !== '') {
      return null
    }
    seen.add(value.keyBeatId)
    parsed.push({
      keyBeatId: value.keyBeatId,
      covered: value.covered,
      mandatoryBeatId: value.mandatoryBeatId,
    })
  }
  return parsed
}

export async function auditKeyBeatCoverage(
  storyArc: StoryArc,
  provider: ModelProvider
): Promise<BeatCoverageAudit> {
  const candidates = storyArc.keyBeats.filter(
    (keyBeat) => keyBeat.coveredByMandatoryBeatId === undefined
  )
  if (candidates.length === 0) {
    return { storyArc, changed: false, linkedKeyBeatIds: [], independentKeyBeatIds: [] }
  }

  const mandatoryBeats = getMandatoryBeatEntries(storyArc)
  const allowedMandatoryIds = new Map<BeatId, ReadonlySet<BeatId>>()
  const auditInput = candidates.map((keyBeat) => {
    const available = mandatoryBeats.filter((entry) => entry.actIndex <= keyBeat.deadlineAct)
    allowedMandatoryIds.set(keyBeat.id, new Set(available.map((entry) => entry.id)))
    return {
      keyBeat: {
        id: keyBeat.id,
        beat: keyBeat.beat,
        deadlineAct: keyBeat.deadlineAct,
      },
      candidates: available.map((entry) => ({
        id: entry.id,
        beat: entry.beat,
        actIndex: entry.actIndex,
      })),
    }
  })
  const messages: Message[] = [
    { role: 'system', content: BEAT_COVERAGE_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `请审计以下结构化 beat 覆盖关系：\n${JSON.stringify(auditInput, null, 2)}`,
    },
  ]

  let decisions: BeatCoverageDecision[] | null = null
  let lastError: unknown
  for (let attempt = 0; attempt < 2 && decisions === null; attempt++) {
    try {
      const raw = provider.chatStructured
        ? await provider.chatStructured<unknown>(messages, BEAT_COVERAGE_SCHEMA, 0)
        : await chatStructuredFallback<unknown>(provider, messages, BEAT_COVERAGE_SCHEMA, 0)
      decisions = parseCoverageDecisions(raw, candidates, allowedMandatoryIds)
      if (decisions === null && attempt === 0) {
        logger.warn('[MuseFlow] key beat 覆盖关系审计响应无效，正在重试')
      }
    } catch (error) {
      lastError = error
      if (attempt === 0) {
        logger.warn('[MuseFlow] key beat 覆盖关系审计调用失败，正在重试')
      }
    }
  }

  if (!decisions) {
    logger.warn(
      lastError === undefined
        ? '[MuseFlow] key beat 覆盖关系审计响应无效，保持原状态'
        : `[MuseFlow] key beat 覆盖关系审计失败，保持原状态：${lastError instanceof Error ? lastError.message : String(lastError)}`
    )
    return { storyArc, changed: false, linkedKeyBeatIds: [], independentKeyBeatIds: [] }
  }

  const decisionById = new Map(decisions.map((decision) => [decision.keyBeatId, decision] as const))
  const linkedKeyBeatIds: BeatId[] = []
  const independentKeyBeatIds: BeatId[] = []
  const keyBeats = storyArc.keyBeats.map((keyBeat) => {
    const decision = decisionById.get(keyBeat.id)
    if (!decision) return keyBeat
    if (decision.covered) {
      linkedKeyBeatIds.push(keyBeat.id)
      return { ...keyBeat, coveredByMandatoryBeatId: decision.mandatoryBeatId }
    }
    independentKeyBeatIds.push(keyBeat.id)
    return { ...keyBeat, coveredByMandatoryBeatId: null }
  })

  return {
    storyArc: { ...storyArc, keyBeats },
    changed: true,
    linkedKeyBeatIds,
    independentKeyBeatIds,
  }
}

export interface KeyBeatCoverageLink {
  keyBeatId: BeatId
  mandatoryBeatId: BeatId
}

const BEAT_COVERAGE_VERIFY_SCHEMA: JsonSchema = {
  type: 'object',
  properties: { covered: { type: 'boolean' } },
  required: ['covered'],
}

const BEAT_COVERAGE_VERIFY_SYSTEM_PROMPT = `你是长篇叙事结构审计员。故事因一个 required key beat 缺少验证证据而无法继续。请复核：完成给定 mandatory beat 是否必然同时完成该 key beat 的全部叙事义务。

只有完成 mandatory beat 必然同时完成 key beat 的全部叙事义务时，才能判定 covered=true。仅仅主题相关、部分重叠、前置铺垫、后续结果或同一角色参与都不构成覆盖。
若两条描述指向同一叙事义务，仅措辞详略或限定语不同，则完成其一即完成其二，应判 covered=true。
不得利用输入之外的故事信息。`

async function verifyPairCoverage(
  provider: ModelProvider,
  keyBeat: StoryArc['keyBeats'][number],
  candidate: MandatoryBeatEntry
): Promise<boolean> {
  const messages: Message[] = [
    { role: 'system', content: BEAT_COVERAGE_VERIFY_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `请复核以下 beat 覆盖关系：\n${JSON.stringify(
        {
          keyBeat: { id: keyBeat.id, beat: keyBeat.beat, deadlineAct: keyBeat.deadlineAct },
          mandatoryBeat: { id: candidate.id, beat: candidate.beat, actIndex: candidate.actIndex },
        },
        null,
        2
      )}`,
    },
  ]

  // 部分模型对同一 pair 的判定存在偶发翻转：covered=true 一旦出现即可信
  // （否定判定实测稳定），而单次 false 可能是假阴性。多次采样取任一 true。
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const raw = provider.chatStructured
        ? await provider.chatStructured<unknown>(messages, BEAT_COVERAGE_VERIFY_SCHEMA, 0)
        : await chatStructuredFallback<unknown>(provider, messages, BEAT_COVERAGE_VERIFY_SCHEMA, 0)
      if (raw && typeof raw === 'object' && (raw as { covered?: unknown }).covered === true) {
        return true
      }
    } catch {
      // 复核调用失败按未覆盖处理，保持保守阻断
    }
  }
  return false
}

/**
 * 阻断前的聚焦复核：批量审计在一次调用中裁决全部 key beat，可能漏掉等价义务
 * （假阴性会让故事永久阻断在"重写截止幕末章、截断后续全部章节"的路径上）。
 * 对即将阻断的 key beat 逐一与已证明的 mandatory beat 做 pairwise 复核，
 * 确认覆盖关系后返回可共享证明的关联。
 */
export async function verifyUnprovenKeyBeatCoverage(
  storyArc: StoryArc,
  memory: StoryMemory,
  keyBeatIds: BeatId[],
  provider: ModelProvider
): Promise<KeyBeatCoverageLink[]> {
  const mandatoryBeats = getMandatoryBeatEntries(storyArc)
  const links: KeyBeatCoverageLink[] = []

  for (const keyBeatId of keyBeatIds) {
    const keyBeat = storyArc.keyBeats.find((candidate) => candidate.id === keyBeatId)
    if (!keyBeat || keyBeat.coveredByMandatoryBeatId) continue
    const provenCandidates = mandatoryBeats.filter(
      (entry) =>
        entry.actIndex <= keyBeat.deadlineAct &&
        (memory.beats[entry.id]?.provenByEventIds.length ?? 0) > 0
    )
    for (const candidate of provenCandidates) {
      if (await verifyPairCoverage(provider, keyBeat, candidate)) {
        links.push({ keyBeatId, mandatoryBeatId: candidate.id })
        break
      }
    }
  }

  return links
}
