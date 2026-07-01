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
import { generateId } from '../utils/id.js'
import type { CanonicalFact } from '../types/story-state.js'

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
      },
    )

    return [this.systemMessage(buildSummarySystemPrompt()), this.userMessage(userContent)]
  }

  protected parse(content: string): AgentOutput {
    return parseJsonFromLLM(content)
  }
}

interface ImportanceObject {
  text: string
  importance: string
}

const SOURCE_PATTERNS = [
  // subject + 由 + value + 打造/铸造/制造/所铸/制成
  { regex: /^(.+?)由(.+?)(?:打造|铸造|制造|所铸|制成)$/, attribute: '制造者' },
  // subject + 是 + value + 赠予/所赐/给予/赠送/送予/打的/制作/所做/所制
  { regex: /^(.+?)是(.+?)(?:赠予|所赐|给予|赠送|送予|打的|制作|所做|所制)$/, attribute: '来源' },
  // subject + 来自/源于/出自 + value
  { regex: /^(.+?)(?:来自|源于|出自|来源自)(.+)$/, attribute: '来源' },
  // subject + 的 + (制造者|来源|持有者|身份) + 是 + value
  { regex: /^(.+?)的(?:制造者|来源|持有者|身份)是(.+)$/, attribute: '来源' },
  // subject + 为 + value + 所铸/所制/所打/打造/持有/所有
  { regex: /^(.+?)为(.+?)(?:所铸|所制|所打|打造|持有|所有)$/, attribute: '来源' },
]

const SOURCE_KEYWORDS = /(?:由|是)(?:[^，。]+?)(?:打造|铸造|制造|所铸|制成|赠予|所赐|给予|赠送|送予|打的|制作|所做|所制)|(?:来自|源于|出自|来源自)[^，。]+|(?:制造者|来源|持有者|身份)是[^，。]+|为[^，。]+?(?:所铸|所制|所打|打造|持有|所有)/g

function extractSourceFactsFromText(text: string, defaultSubject: string, chapterIndex: number): CanonicalFact[] {
  const facts: CanonicalFact[] = []
  const cleanedText = text.replace(/[\s\n]+/g, '').trim()

  for (const pattern of SOURCE_PATTERNS) {
    const match = cleanedText.match(pattern.regex)
    if (match && match[1] && match[2]) {
      const subject = match[1].trim()
      const value = match[2].trim()
      if (subject.length > 0 && value.length > 0) {
        facts.push({
          id: generateId('fact'),
          subject,
          attribute: pattern.attribute,
          value,
          establishedIn: chapterIndex,
        })
      }
    }
  }

  // Fallback: if no structured pattern matched but source keywords exist,
  // create a fact with the default subject and the source snippet as value.
  if (facts.length === 0 && SOURCE_KEYWORDS.test(cleanedText)) {
    const sourceMatch = cleanedText.match(SOURCE_KEYWORDS)
    if (sourceMatch && sourceMatch[0]) {
      facts.push({
        id: generateId('fact'),
        subject: defaultSubject,
        attribute: '来源',
        value: sourceMatch[0].trim(),
        establishedIn: chapterIndex,
      })
    }
  }

  return facts
}

function extractSourceFacts(data: Record<string, unknown>, chapterIndex: number): CanonicalFact[] {
  const facts: CanonicalFact[] = []

  const keyItems = Array.isArray(data['keyItems']) ? data['keyItems'] as ImportanceObject[] : []
  for (const item of keyItems) {
    if (!item || typeof item !== 'object' || item.importance !== 'critical') continue
    const text = item.text || ''
    // Key item text format is typically "物品名: 描述"
    const [subjectPart, ...descParts] = text.split(/[:：]/)
    const subject = subjectPart ? subjectPart.trim() : text.trim()
    const description = descParts.join('：').trim()
    const targetText = description.length > 0 ? description : text
    facts.push(...extractSourceFactsFromText(targetText, subject, chapterIndex))
  }

  const characterFacts = Array.isArray(data['characterFacts']) ? data['characterFacts'] as Array<{ character?: string; facts?: ImportanceObject[] }> : []
  for (const entry of characterFacts) {
    if (!entry || typeof entry !== 'object') continue
    const character = entry.character || ''
    const factsList = Array.isArray(entry.facts) ? entry.facts : []
    for (const fact of factsList) {
      if (!fact || typeof fact !== 'object' || fact.importance !== 'critical') continue
      // Character facts about source usually mention an item; use the fact text itself as default subject.
      facts.push(...extractSourceFactsFromText(fact.text, character, chapterIndex))
    }
  }

  return facts
}

function inferAttributeFromCharacterFact(text: string): string {
  if (/承诺|约定|交易|条件|底线|誓言/.test(text)) return '承诺'
  if (/计划|策略|打算|方案|布局/.test(text)) return '计划'
  if (/知道|了解|获悉|得知|明白|掌握/.test(text)) return '已知信息'
  if (/决定|决心|选择|抉择/.test(text)) return '决定'
  if (/态度|立场|看法|观点/.test(text)) return '态度'
  return '已知信息'
}

/**
 * 把 characterFacts 中 importance=critical 的条目提升为 canonical facts。
 * 这些高约束性角色事实是一致性检查的主要依据。
 */
function extractCharacterFactsAsCanonical(data: Record<string, unknown>, chapterIndex: number): CanonicalFact[] {
  const facts: CanonicalFact[] = []
  const characterFacts = Array.isArray(data['characterFacts'])
    ? data['characterFacts'] as Array<{ character?: string; facts?: ImportanceObject[] }>
    : []

  for (const entry of characterFacts) {
    if (!entry || typeof entry !== 'object') continue
    const character = entry.character || ''
    if (character.length === 0) continue
    const factsList = Array.isArray(entry.facts) ? entry.facts : []
    for (const fact of factsList) {
      if (!fact || typeof fact !== 'object' || fact.importance !== 'critical') continue
      const text = fact.text || ''
      if (text.length === 0) continue
      facts.push({
        id: generateId('fact'),
        subject: character,
        attribute: inferAttributeFromCharacterFact(text),
        value: text,
        establishedIn: chapterIndex,
      })
    }
  }

  return facts
}

export function processSummaryOutput(
  output: AgentOutput,
  chapterIndex?: number,
  characters?: Character[],
  existingStoryState?: StoryState,
): { summary: string; storyState?: StoryState; verifiedBeats?: string[] } | null {
  if (!output.success || !output.data) return null
  const data = output.data as Record<string, unknown>

  const migrateStringArrayToImportanceObjects = (arr: unknown): Array<{ text: string; importance: string }> => {
    if (!Array.isArray(arr)) return []
    return arr.map(item => {
      if (typeof item === 'string') {
        return { text: item, importance: 'major' }
      }
      return item as { text: string; importance: string }
    })
  }

  const migrateCharacterFactEntries = (arr: unknown): unknown[] => {
    if (!Array.isArray(arr)) return []
    return arr.map(entry => {
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

  const disambiguateValue = (value: string, subject: string): string => {
    // 权威事实中禁止使用依赖上下文的代词；如果 LLM 仍然生成了，用完整 subject 兜底替换。
    const ambiguousPronouns = /此物|该物|前述物品|此件|那件/g
    if (!ambiguousPronouns.test(value)) return value
    logger.warn(`[MuseFlow] canonicalFact 中发现模糊指代，将用 '${subject}' 兜底澄清: ${value}`)
    return value.replace(ambiguousPronouns, subject)
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
      return val.filter((item): item is Record<string, unknown> =>
        item && typeof item === 'object'
      ).map((item, idx) => ({
        id: typeof item['id'] === 'string' ? item['id'] : `task_${idx}`,
        assignee: typeof item['assignee'] === 'string' ? item['assignee'] : '',
        description: typeof item['description'] === 'string' ? item['description'] : '',
        createdChapter: typeof item['createdChapter'] === 'number' ? item['createdChapter'] : (chapterIndex ?? -1),
        dueChapter: typeof item['dueChapter'] === 'number' ? item['dueChapter'] : undefined,
        dueTime: typeof item['dueTime'] === 'string' ? item['dueTime'] : undefined,
        status: (typeof item['status'] === 'string' ? item['status'] : 'pending') as import('../types/story-state.js').PendingTask['status'],
      })).filter(item => item.assignee.length > 0 && item.description.length > 0)
    }

    const toCanonicalFacts = (val: unknown): import('../types/story-state.js').CanonicalFact[] => {
      if (!Array.isArray(val)) return []
      return val
        .filter((item): item is Record<string, unknown> => item && typeof item === 'object')
        .map((item, idx) => {
          const supersedesRaw = Array.isArray(item['supersedes'])
            ? item['supersedes'].filter((s): s is Record<string, unknown> => s && typeof s === 'object')
            : []
          const subject = typeof item['subject'] === 'string' ? item['subject'] : ''
          const value = typeof item['value'] === 'string' ? item['value'] : ''
          return {
            id: typeof item['id'] === 'string' && item['id'].length > 0
              ? item['id']
              : `cf_${chapterIndex ?? 0}_${idx}`,
            subject,
            attribute: typeof item['attribute'] === 'string' ? item['attribute'] : '',
            value: disambiguateValue(value, subject),
            establishedIn: typeof item['establishedIn'] === 'number' ? item['establishedIn'] : (chapterIndex ?? -1),
            supersedes: supersedesRaw.length > 0
              ? supersedesRaw.map(s => ({
                  chapter: typeof s['chapter'] === 'number' ? s['chapter'] : -1,
                  oldValue: disambiguateValue(
                    typeof s['oldValue'] === 'string' ? s['oldValue'] : '',
                    subject
                  ),
                })).filter(s => s.oldValue.length > 0)
              : undefined,
          }
        })
        .filter(fact => fact.subject.length > 0 && fact.attribute.length > 0 && fact.value.length > 0)
    }

    return {
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

  const rawSourceFacts = data['sourceFacts']
  if (storyState && Array.isArray(rawSourceFacts)) {
    const parsedSourceFacts: import('../types/story-state.js').CanonicalFact[] = rawSourceFacts
      .filter((item): item is Record<string, unknown> => item && typeof item === 'object')
      .map((item, idx) => {
        const subject = typeof item['subject'] === 'string' ? item['subject'] : ''
        const value = typeof item['value'] === 'string' ? item['value'] : ''
        return {
          id: `cf_${chapterIndex ?? 0}_source_${idx}`,
          subject,
          attribute: typeof item['attribute'] === 'string' ? item['attribute'] : '',
          value: disambiguateValue(value, subject),
          establishedIn: chapterIndex ?? 0,
        }
      })
      .filter(f => f.subject.length > 0 && f.attribute.length > 0 && f.value.length > 0)

    const existingFacts = storyState.canonicalFacts ?? []
    const existingKeys = new Set(existingFacts.map(f => `${f.subject}|${f.attribute}|${f.value}`))
    const newFacts = parsedSourceFacts.filter(f => !existingKeys.has(`${f.subject}|${f.attribute}|${f.value}`))

    if (newFacts.length > 0) {
      storyState.canonicalFacts = [...existingFacts, ...newFacts]
    }
  }

  // Auto-promote source-like and character critical facts to canonicalFacts as a safety net.
  let autoPromotedCount = 0
  if (storyState) {
    const sourceFacts = extractSourceFacts(data, chapterIndex ?? 0)
    const characterFacts = extractCharacterFactsAsCanonical(data, chapterIndex ?? 0)
    const autoFacts = [...sourceFacts, ...characterFacts]
    if (autoFacts.length > 0) {
      const existingFacts = storyState.canonicalFacts ?? []
      const existingKeys = new Set(existingFacts.map(f => `${f.subject}|${f.attribute}|${f.value}`))
      const newFacts = autoFacts.filter(f => !existingKeys.has(`${f.subject}|${f.attribute}|${f.value}`))
      if (newFacts.length > 0) {
        autoPromotedCount = newFacts.length
        storyState.canonicalFacts = [...existingFacts, ...newFacts]
      }
    }
  }

  const totalPromoted = Math.max(
    0,
    (storyState?.canonicalFacts?.length ?? 0) - (existingStoryState?.canonicalFacts?.length ?? 0)
  )
  if (totalPromoted > 0) {
    const explicitCount = totalPromoted - autoPromotedCount
    logger.info(`SummaryAgent 新增 ${totalPromoted} 条权威事实（显式 ${explicitCount}，自动提升 ${autoPromotedCount}）`)
  }

  if (storyState && characters && characters.length > 0) {
    const report = sanitizeStoryState(storyState, characters, { preserveExisting: true, existingStoryState, chapterIndex })
    if (report.removedCharacters.length > 0) {
      logger.warn(`[MuseFlow] SummaryAgent 移除了 invented 角色: ${report.removedCharacters.join(', ')}`)
    }
    if (report.itemLocationConflicts.length > 0) {
      logger.info(`[MuseFlow] SummaryAgent 自动协调物品位置冲突: ${report.itemLocationConflicts.map(c => c.item).join(', ')}`)
    }
    storyState = report.state
  }

  const extractSupersededFacts = (): import('../types/story-state.js').SupersededFact[] | undefined => {
    const raw = data['supersededFacts']
    if (!Array.isArray(raw)) return undefined
    return raw.filter((item): item is Record<string, unknown> => 
      item && typeof item === 'object'
    ).map((item, idx) => ({
      subject: typeof item['subject'] === 'string' ? item['subject'] : `fact_${idx}`,
      oldFact: typeof item['oldFact'] === 'string' ? item['oldFact'] : '',
      reason: typeof item['reason'] === 'string' ? item['reason'] : '后续大纲已更新',
      chapterIndex: chapterIndex ?? -1,
    })).filter(item => item.oldFact.length > 0)
  }

  const extractVerifiedBeats = (): string[] => {
    const raw = data['verifiedBeats']
    if (!Array.isArray(raw)) return []
    return raw
      .filter((item): item is string => typeof item === 'string')
      .map(beat => beat.trim())
      .filter(beat => beat.length > 0)
  }

  const verifiedBeats = extractVerifiedBeats()

  if (storyState) {
    const extractedSupersededFacts = extractSupersededFacts() ?? []
    const existingSupersededFacts = storyState.supersededFacts ?? []
    const mergedSupersededFacts = [...existingSupersededFacts, ...extractedSupersededFacts]
    if (mergedSupersededFacts.length > 0) {
      storyState.supersededFacts = mergedSupersededFacts
    }
    return { summary, storyState, verifiedBeats }
  }

  return { summary, verifiedBeats }
}
