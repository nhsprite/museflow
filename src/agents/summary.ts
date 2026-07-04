import { logger } from '../utils/logger.js'
import type { ModelProvider } from '../model/provider.js'
import { BaseAgent, type AgentOutput } from './base.js'
import type { SummaryAgentInput } from './types.js'
import type { Character } from '../types/character.js'
import type { StoryState } from '../types/story-state.js'
import type { Message } from '../model/provider.js'

import { sanitizeStoryState } from '../graph/utils/reconciler/index.js'
import {
  buildSummarySystemPrompt,
  buildSummaryUserPrompt,
  buildClaimedBeatsSection,
  buildCharacterWhitelistSection,
} from './prompts/summary-prompt.js'
import { parseJsonFromLLM } from '../utils/json.js'
import type { CanonicalFact, CanonicalFactSource, ChapterHandoff } from '../types/story-state.js'
import type { VerifiedBeatEvidence } from '../types/outline.js'

export class SummaryAgent extends BaseAgent<SummaryAgentInput> {
  constructor(provider: ModelProvider) {
    super(provider, 0.3)
  }

  protected buildPrompt(state: SummaryAgentInput): Message[] {
    const whitelistSection = buildCharacterWhitelistSection({
      charactersList: state.charactersList,
      outlineCharacters: state.outlineCharacters,
      establishedCharacters: state.establishedCharacters,
    })

    const userContent = buildSummaryUserPrompt(
      {
        claimedBeatsSection: buildClaimedBeatsSection(state.claimedBeats ?? []),
        whitelistSection,
      },
      {
        chapterTitle: state.chapterTitle ?? '未知',
        displayChapterNumber:
          state.chapterIndex !== undefined ? `第${state.chapterIndex + 1}章` : '未知',
        chapterContent: state.chapterContent ?? '（无内容）',
      }
    )

    return [this.systemMessage(buildSummarySystemPrompt()), this.userMessage(userContent)]
  }

  protected parse(content: string): AgentOutput {
    return parseJsonFromLLM(content)
  }
}

const ALLOWED_CANONICAL_FACT_ATTRIBUTES = new Set([
  '所在位置',
  '位置',
  '身份',
  '状态',
  '持有者',
  '来源',
  '制造者',
  '赠予者',
  '材质',
  '归属',
  '承诺',
  '约定',
  '条件',
  '已知信息',
  '计划',
  '策略',
  '决定',
  '态度',
  '关键事件',
  '事件',
  '关系',
  'location',
  'status',
  'identity',
  'holder',
  'source',
  'creator',
  'donor',
  'material',
  'ownership',
  'promise',
  'agreement',
  'condition',
  'knowledge',
  'plan',
  'strategy',
  'decision',
  'attitude',
  'event',
  'relationship',
])

function isAllowedCanonicalFactAttribute(attribute: string): boolean {
  return ALLOWED_CANONICAL_FACT_ATTRIBUTES.has(attribute.trim())
}

function filterHardCanonicalFacts(
  facts: CanonicalFact[],
  chapterContent: string | undefined
): CanonicalFact[] {
  if (!chapterContent) return facts

  let unsupportedChapterTextFacts = 0
  let unsupportedAttributeFacts = 0
  const kept: CanonicalFact[] = []

  for (const fact of facts) {
    if (fact.source !== 'chapter_text') {
      kept.push(fact)
      continue
    }

    if (!isAllowedCanonicalFactAttribute(fact.attribute)) {
      unsupportedAttributeFacts++
      continue
    }

    if (fact.confidence === 'low' || !fact.evidence?.quote) {
      unsupportedChapterTextFacts++
      continue
    }

    kept.push(fact)
  }

  if (unsupportedChapterTextFacts > 0 || unsupportedAttributeFacts > 0) {
    logger.warn(
      `[MuseFlow] SummaryAgent 权威事实晋升过滤：${unsupportedChapterTextFacts} 条缺少可靠正文证据，${unsupportedAttributeFacts} 条 attribute 不在结构化枚举内，已从硬 canonicalFacts 移除`
    )
  }

  return kept
}

export function processSummaryOutput(
  output: AgentOutput,
  chapterIndex?: number,
  characters?: Character[],
  existingStoryState?: StoryState,
  chapterContent?: string,
  claimedBeats?: string[]
): {
  summary: string
  storyState?: StoryState
  verifiedBeats?: string[]
  verifiedBeatEvidence?: VerifiedBeatEvidence[]
} | null {
  if (!output.success || !output.data) return null
  const data = output.data as Record<string, unknown>

  const migrateStringArrayToImportanceObjects = (
    arr: unknown
  ): Array<{ text: string; importance: string }> => {
    if (!Array.isArray(arr)) return []
    return arr.map((item) => {
      if (typeof item === 'string') {
        return { text: item, importance: 'major' }
      }
      return item as { text: string; importance: string }
    })
  }

  const migrateCharacterFactEntries = (arr: unknown): unknown[] => {
    if (!Array.isArray(arr)) return []
    return arr.map((entry) => {
      if (!entry || typeof entry !== 'object') return entry
      const e = entry as Record<string, unknown>
      const rawFacts = e['facts']
      if (Array.isArray(rawFacts)) {
        return {
          character: e['character'],
          facts: migrateStringArrayToImportanceObjects(rawFacts),
        }
      }
      return e
    })
  }

  const toConfidence = (val: unknown): 'high' | 'medium' | 'low' => {
    if (val === 'high' || val === 'medium' || val === 'low') return val
    return 'high'
  }

  const toCanonicalFactSource = (val: unknown): CanonicalFactSource => {
    if (
      val === 'chapter_text' ||
      val === 'outline_inference' ||
      val === 'author_override' ||
      val === 'reconciliation'
    ) {
      return val
    }
    return 'chapter_text'
  }

  const parseCanonicalFact = (
    item: Record<string, unknown>,
    idx: number,
    defaultSource: CanonicalFactSource = 'chapter_text'
  ): CanonicalFact | null => {
    const supersedesRaw = Array.isArray(item['supersedes'])
      ? item['supersedes'].filter((s): s is Record<string, unknown> => s && typeof s === 'object')
      : []
    const subject = typeof item['subject'] === 'string' ? item['subject'] : ''
    const value = typeof item['value'] === 'string' ? item['value'] : ''

    if (subject.length === 0) return null
    const attribute = typeof item['attribute'] === 'string' ? item['attribute'] : ''
    if (attribute.length === 0) return null
    if (value.length === 0) return null

    const evidenceRaw = item['evidence']
    const evidence =
      evidenceRaw && typeof evidenceRaw === 'object'
        ? {
            chapterIndex:
              chapterIndex ??
              (typeof (evidenceRaw as Record<string, unknown>)['chapterIndex'] === 'number'
                ? ((evidenceRaw as Record<string, unknown>)['chapterIndex'] as number)
                : -1),
            quote:
              typeof (evidenceRaw as Record<string, unknown>)['quote'] === 'string'
                ? ((evidenceRaw as Record<string, unknown>)['quote'] as string)
                : '',
          }
        : undefined

    return {
      id:
        typeof item['id'] === 'string' && item['id'].length > 0
          ? item['id']
          : `cf_${chapterIndex ?? 0}_${idx}`,
      subject,
      attribute,
      value,
      establishedIn:
        chapterIndex ?? (typeof item['establishedIn'] === 'number' ? item['establishedIn'] : -1),
      confidence: toConfidence(item['confidence']),
      source: toCanonicalFactSource(item['source']) ?? defaultSource,
      ...(evidence && evidence.quote.length > 0 ? { evidence } : {}),
      supersedes:
        supersedesRaw.length > 0
          ? supersedesRaw
              .map((s) => ({
                chapter: typeof s['chapter'] === 'number' ? s['chapter'] : -1,
                oldValue: typeof s['oldValue'] === 'string' ? s['oldValue'] : '',
              }))
              .filter((s) => s.oldValue.length > 0)
          : undefined,
    }
  }

  const extractStoryState = (): StoryState | undefined => {
    const raw = data['storyState']
    if (!raw || typeof raw !== 'object') return undefined
    const s = raw as Record<string, unknown>

    const toRecord = (val: unknown): Record<string, string> => {
      if (!val || typeof val !== 'object') return {}
      const result: Record<string, string> = {}
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        if (typeof v === 'string') result[k] = v
      }
      return result
    }

    const toStringArray = (val: unknown): string[] => {
      if (!Array.isArray(val)) return []
      return val.filter((v): v is string => typeof v === 'string')
    }

    const toPendingTasks = (val: unknown): import('../types/story-state.js').PendingTask[] => {
      if (!Array.isArray(val)) return []
      return val
        .filter((item): item is Record<string, unknown> => item && typeof item === 'object')
        .map((item, idx) => ({
          id: typeof item['id'] === 'string' ? item['id'] : `task_${idx}`,
          assignee: typeof item['assignee'] === 'string' ? item['assignee'] : '',
          description: typeof item['description'] === 'string' ? item['description'] : '',
          createdChapter:
            typeof item['createdChapter'] === 'number'
              ? item['createdChapter']
              : (chapterIndex ?? -1),
          dueChapter: typeof item['dueChapter'] === 'number' ? item['dueChapter'] : undefined,
          dueTime: typeof item['dueTime'] === 'string' ? item['dueTime'] : undefined,
          status: (typeof item['status'] === 'string'
            ? item['status']
            : 'pending') as import('../types/story-state.js').PendingTask['status'],
        }))
        .filter((item) => item.assignee.length > 0 && item.description.length > 0)
    }

    const toCanonicalFacts = (val: unknown): CanonicalFact[] => {
      if (!Array.isArray(val)) return []
      return val
        .filter((item): item is Record<string, unknown> => item && typeof item === 'object')
        .map((item, idx) => parseCanonicalFact(item, idx, 'chapter_text'))
        .filter((fact): fact is CanonicalFact => fact !== null)
    }

    const toChapterHandoff = (val: unknown): ChapterHandoff | undefined => {
      if (!val || typeof val !== 'object') return undefined
      const raw = val as Record<string, unknown>
      const endScene = typeof raw['endScene'] === 'string' ? raw['endScene'].trim() : ''
      const endTime = typeof raw['endTime'] === 'string' ? raw['endTime'].trim() : ''
      const lastAction = typeof raw['lastAction'] === 'string' ? raw['lastAction'].trim() : ''
      const requiredNextOpening =
        typeof raw['requiredNextOpening'] === 'string' ? raw['requiredNextOpening'].trim() : ''
      const charactersPresent = toStringArray(raw['charactersPresent'])
      const openQuestions = toStringArray(raw['openQuestions'])

      if (
        endScene.length === 0 &&
        endTime.length === 0 &&
        lastAction.length === 0 &&
        requiredNextOpening.length === 0 &&
        charactersPresent.length === 0 &&
        openQuestions.length === 0
      ) {
        return undefined
      }

      const handoff: ChapterHandoff = {
        chapterNumber:
          typeof raw['chapterNumber'] === 'number'
            ? raw['chapterNumber']
            : (chapterIndex ?? -1) + 1,
        endScene,
        endTime,
        charactersPresent,
        lastAction,
        openQuestions,
      }
      if (requiredNextOpening.length > 0) {
        handoff.requiredNextOpening = requiredNextOpening
      }
      return handoff
    }

    const chapterHandoff = toChapterHandoff(s['chapterHandoff'])
    const extracted: StoryState = {
      characterLocations: toRecord(s['characterLocations']),
      characterStatus: toRecord(s['characterStatus']),
      keyItemsLocation: toRecord(s['keyItemsLocation']),
      keyItemsState: toRecord(s['keyItemsState']),
      activePlots: toStringArray(s['activePlots']),
      revealedSecrets: toStringArray(s['revealedSecrets']),
      pendingTasks: toPendingTasks(s['pendingTasks']),
      canonicalFacts: toCanonicalFacts(s['canonicalFacts']),
      currentScene: typeof s['currentScene'] === 'string' ? s['currentScene'] : '',
      storyTime: typeof s['storyTime'] === 'string' ? s['storyTime'] : '',
    }
    if (chapterHandoff) {
      extracted.chapterHandoff = chapterHandoff
    }
    return extracted
  }

  const summary = JSON.stringify({
    characters: data['characters'] ?? [],
    characterFacts: migrateCharacterFactEntries(data['characterFacts']),
    keyEvents: migrateStringArrayToImportanceObjects(data['keyEvents']),
    locations: migrateStringArrayToImportanceObjects(data['locations']),
    keyItems: migrateStringArrayToImportanceObjects(data['keyItems']),
    activePlots: migrateStringArrayToImportanceObjects(data['activePlots']),
    mood: data['mood'] ?? '',
  })

  let storyState = extractStoryState()

  // Merge explicit sourceFacts (LLM-provided canonical facts) into storyState.canonicalFacts.
  const rawSourceFacts = data['sourceFacts']
  if (storyState && Array.isArray(rawSourceFacts)) {
    const parsedSourceFacts: CanonicalFact[] = rawSourceFacts
      .filter((item): item is Record<string, unknown> => item && typeof item === 'object')
      .map((item, idx) => parseCanonicalFact(item, idx, 'chapter_text'))
      .filter((fact): fact is CanonicalFact => fact !== null)

    if (parsedSourceFacts.length > 0) {
      const existingFacts = storyState.canonicalFacts ?? []
      const existingKeys = new Set(
        existingFacts.map((f) => `${f.subject}|${f.attribute}|${f.value}`)
      )
      const newFacts = parsedSourceFacts.filter(
        (f) => !existingKeys.has(`${f.subject}|${f.attribute}|${f.value}`)
      )
      if (newFacts.length > 0) {
        storyState.canonicalFacts = [...existingFacts, ...newFacts]
      }
    }
  }

  if (storyState && characters && characters.length > 0) {
    const report = sanitizeStoryState(storyState, characters, {
      preserveExisting: true,
      existingStoryState,
      chapterIndex,
    })
    if (report.removedCharacters.length > 0) {
      logger.warn(
        `[MuseFlow] SummaryAgent 移除了 invented 角色: ${report.removedCharacters.join(', ')}`
      )
    }
    if (report.itemLocationConflicts.length > 0) {
      logger.info(
        `[MuseFlow] SummaryAgent 自动协调物品位置冲突: ${report.itemLocationConflicts.map((c) => c.item).join(', ')}`
      )
    }
    storyState = report.state
  }

  const extractSupersededFacts = ():
    import('../types/story-state.js').SupersededFact[] | undefined => {
    const raw = data['supersededFacts']
    if (!Array.isArray(raw)) return undefined
    return raw
      .filter((item): item is Record<string, unknown> => item && typeof item === 'object')
      .map((item, idx) => ({
        subject: typeof item['subject'] === 'string' ? item['subject'] : `fact_${idx}`,
        oldFact: typeof item['oldFact'] === 'string' ? item['oldFact'] : '',
        reason: typeof item['reason'] === 'string' ? item['reason'] : '后续大纲已更新',
        chapterIndex: chapterIndex ?? -1,
      }))
      .filter((item) => item.oldFact.length > 0)
  }

  const extractVerifiedBeats = (): string[] => {
    const raw = data['verifiedBeats']
    if (!Array.isArray(raw)) return []
    const rawBeats = raw
      .filter((item): item is string => typeof item === 'string')
      .map((beat) => beat.trim())
      .filter((beat) => beat.length > 0)

    if (!claimedBeats || claimedBeats.length === 0) {
      return rawBeats
    }

    const normalized: string[] = []
    const allowed = new Set(claimedBeats)
    for (const rawBeat of rawBeats) {
      if (allowed.has(rawBeat)) {
        if (!normalized.includes(rawBeat)) {
          normalized.push(rawBeat)
        }
      } else {
        logger.warn(
          `[MuseFlow] SummaryAgent 返回的 verifiedBeat 与 claimedBeats 不匹配，已丢弃：${rawBeat.slice(0, 80)}`
        )
      }
    }
    return normalized
  }

  const verifiedBeats = extractVerifiedBeats()

  const extractVerifiedBeatEvidence = (): VerifiedBeatEvidence[] => {
    const raw = data['verifiedBeatEvidence']
    if (!Array.isArray(raw)) return []
    const allowedBeats = claimedBeats && claimedBeats.length > 0 ? claimedBeats : verifiedBeats
    const matched: VerifiedBeatEvidence[] = []
    const seen = new Set<string>()

    for (const item of raw) {
      if (!item || typeof item !== 'object') continue
      const record = item as Record<string, unknown>
      const rawBeat = typeof record['beat'] === 'string' ? record['beat'].trim() : ''
      const beat = allowedBeats.length > 0 && allowedBeats.includes(rawBeat) ? rawBeat : ''
      if (!beat || !verifiedBeats.includes(beat)) continue

      const evidence = record['evidence']
      if (!evidence || typeof evidence !== 'object') continue
      const quote =
        typeof (evidence as Record<string, unknown>)['quote'] === 'string'
          ? ((evidence as Record<string, unknown>)['quote'] as string).trim()
          : ''
      if (quote.length === 0) continue

      const chapter =
        typeof (evidence as Record<string, unknown>)['chapterIndex'] === 'number'
          ? ((evidence as Record<string, unknown>)['chapterIndex'] as number)
          : (chapterIndex ?? -1)
      const confidence = toConfidence(record['confidence'])
      const key = `${beat}|${chapter}|${quote}`
      if (seen.has(key)) continue
      seen.add(key)
      matched.push({ beat, chapterIndex: chapter, quote, confidence })
    }

    return matched
  }

  const verifiedBeatEvidence = extractVerifiedBeatEvidence()

  if (storyState) {
    if (storyState.canonicalFacts && storyState.canonicalFacts.length > 0) {
      storyState.canonicalFacts = filterHardCanonicalFacts(
        storyState.canonicalFacts,
        chapterContent
      )
    }

    const extractedSupersededFacts = extractSupersededFacts() ?? []
    const existingSupersededFacts = storyState.supersededFacts ?? []
    const mergedSupersededFacts = [...existingSupersededFacts, ...extractedSupersededFacts]
    if (mergedSupersededFacts.length > 0) {
      storyState.supersededFacts = mergedSupersededFacts
    }

    const newCount =
      (storyState.canonicalFacts?.length ?? 0) - (existingStoryState?.canonicalFacts?.length ?? 0)
    if (newCount > 0) {
      logger.info(`SummaryAgent 新增 ${newCount} 条权威事实`)
    }

    return {
      summary,
      storyState,
      verifiedBeats,
      ...(verifiedBeatEvidence.length > 0 ? { verifiedBeatEvidence } : {}),
    }
  }

  return {
    summary,
    verifiedBeats,
    ...(verifiedBeatEvidence.length > 0 ? { verifiedBeatEvidence } : {}),
  }
}
