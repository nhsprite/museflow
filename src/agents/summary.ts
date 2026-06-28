import { logger } from '../utils/logger.js'
import { BaseAgent, type AgentState, type AgentOutput } from './base.js'
import type { Character } from '../types/character.js'
import type { StoryState } from '../types/story-state.js'
import type { Message } from '../model/provider.js'

import { sanitizeStoryState } from '../graph/utils/reconciler.js'
import { OFFICIAL_CHARACTER_RULES, STATE_AUTHORITY_RULES, buildCharacterWhitelistSection } from './prompt-fragments.js'
import { parseJsonFromLLM } from '../utils/json.js'
import { generateId } from '../utils/id.js'
import type { CanonicalFact } from '../types/story-state.js'

export class SummaryAgent extends BaseAgent {
  constructor() {
    super(undefined, 0.3)
  }

  protected buildPrompt(state: AgentState): Message[] {
    const whitelistSection = buildCharacterWhitelistSection({
      charactersList: state.charactersList,
      outlineCharacters: state.outlineCharacters,
      establishedCharacters: state.establishedCharacters,
    })

    return [
      this.systemMessage('<role>你是一位故事结构分析专家，擅长从章节内容中提取关键信息。你必须提取所有角色的关键事实（说过的话、知道的信息、态度变化），以及角色位置、状态、物品追踪等结构化状态信息。</role>'),
      this.userMessage(`<task>
  请分析以下章节内容，生成结构化摘要和故事状态。
</task>

<chapter_info>
  <title>${state.chapterTitle ?? '未知'}</title>
  <number>${state.chapterIndex !== undefined ? `第${state.chapterIndex + 1}章` : '未知'}</number>
</chapter_info>

<chapter_content>
  ${state.chapterContent ?? '（无内容）'}
</chapter_content>

${whitelistSection}
${OFFICIAL_CHARACTER_RULES}
${STATE_AUTHORITY_RULES}

<output_format>
  请提取并返回以下信息（JSON格式）：
  {
    "characters": ["角色名: 当前状态描述"],
    "characterFacts": [
      {
        "character": "角色名",
        "facts": [
          {
            "text": "该角色在本章中明确知道的信息/亲口说过的话/明确的态度（用第三人称客观描述）",
            "importance": "critical|major|minor"
          }
        ]
      }
    ],
    "keyEvents": [
      {
        "text": "本章发生的对后续章节有重要影响的关键事件（用第三人称客观描述）",
        "importance": "critical|major|minor"
      }
    ],
    "locations": [
      {
        "text": "地点: 描述",
        "importance": "critical|major|minor"
      }
    ],
    "keyItems": [
      {
        "text": "物品: 描述和状态",
        "importance": "critical|major|minor"
      }
    ],
    "activePlots": [
      {
        "text": "当前进行中的情节线",
        "importance": "critical|major|minor"
      }
    ],
    "mood": "本章整体氛围/情绪",
    "supersededFacts": [
      {
        "subject": "被覆盖的事实主体",
        "oldFact": "本章中提到的、但已知被后续大纲覆盖的旧事实",
        "reason": "被覆盖的原因"
      }
    ],
    "storyState": {
      "characterLocations": { "角色名": "当前所在地点" },
      "characterStatus": { "角色名": "当前状态" },
      "keyItemsLocation": { "物品名": "当前位置或持有者" },
      "keyItemsState": { "物品名": "当前状态" },
      "activePlots": ["进行中情节线"],
      "revealedSecrets": ["本章新揭示的秘密"],
      "pendingTasks": [
        {
          "id": "任务唯一标识",
          "assignee": "被指派的执行角色",
          "description": "任务具体内容",
          "createdChapter": 1,
          "dueChapter": 2,
          "dueTime": "故事内截止时间（可选）",
          "status": "pending"
        }
      ],
      "canonicalFacts": [
        {
          "id": "可选，留空",
          "subject": "事实主体（角色/物品/地点/组织等）",
          "attribute": "属性维度（所在位置/身份/状态/持有者等）",
          "value": "本章结束时确立的权威值",
          "establishedIn": 1,
          "supersedes": [
            { "chapter": 0, "oldValue": "被覆盖的旧值" }
          ]
        }
      ],
      "currentScene": "本章主要场景",
      "storyTime": "故事内时间"
    }
  }
</output_format>

<importance_criteria>
  <critical>对后续章节有决定性影响，远距离章节也必须保留</critical>
  <major>对近期章节有影响，中期距离保留</major>
  <minor>仅对本章或极近期有参考价值，远距离可丢弃</minor>
</importance_criteria>

  <character_identity_continuity>
  <requirement>描述角色身份时，必须沿用前文已建立的核心身份，不要因本章临时承担的任务而改变核心定位</requirement>
  <requirement>核心身份变化必须基于明确的剧情事件，不能因临时任务而变化</requirement>
  <requirement>如果本章确实发生了导致身份变化的事件，在 characterFacts 中明确标注，并在 summary 中说明变化原因</requirement>
  </character_identity_continuity>

  <character_facts_requirements>
  对于每个有台词或明确行为描写的角色，提取：
  <requirement>该角色在本章中明确承认/知道的事实</requirement>
  <requirement>该角色对本章关键信息的反应/态度</requirement>
  <requirement>该角色做出的关键承诺或威胁</requirement>
  <requirement>对于其他角色明确告知的条件、要求、约定、交易条款等，必须作为该角色的已知事实记录，且 importance 必须标记为 critical</requirement>
</character_facts_requirements>

<critical_facts_priority>
  <requirement>以下类型的事实必须标记为 critical，确保在远距离章节摘要中仍被保留：</requirement>
  <requirement>- 角色之间明确达成的交易、条件、约定或承诺</requirement>
  <requirement>- 角色明确知道的关键信息或秘密</requirement>
  <requirement>- 角色做出的重大决定或制定的计划</requirement>
  <requirement>- 关键物品的位置或状态变化</requirement>
</critical_facts_priority>

<pending_tasks_requirements>
  <requirement>提取本章中角色领受的、需要在后续章节执行的差事或任务</requirement>
  <requirement>如果本章完成了前章遗留的差事，将其 status 标记为 "done"</requirement>
  <requirement>如果本章推迟了前章遗留的差事，保持 status 为 "pending" 并更新 dueTime 或 dueChapter</requirement>
  <requirement>如果后续大纲已覆盖某条差事，将其 status 标记为 "superseded"</requirement>
  <requirement>每个 pending task 必须包含 assignee（执行者）和 description（具体内容）</requirement>
</pending_tasks_requirements>

<superseded_facts_requirements>
  <requirement>如果本章提到的某个事实已知被后续章节的大纲覆盖或更新，请在 supersededFacts 中记录该旧事实</requirement>
  <requirement>这有助于后续章节避免将旧事实当作当前有效信息来使用</requirement>
</superseded_facts_requirements>

<canonical_facts_requirements>
  <requirement>从本章内容中提取所有被本章明确确立或更新的"权威事实"，写入 storyState.canonicalFacts</requirement>
  <requirement>每个权威事实必须包含：subject（事实主体）、attribute（属性维度）、value（权威值）</requirement>
  <requirement>如果某个权威事实覆盖了前文章节中的旧认知，必须填写 supersedes 数组，指明被覆盖的章节索引和旧值</requirement>
  <requirement>章节索引从0开始计数：第1章对应0，第2章对应1，以此类推</requirement>
  <requirement>只记录本章有明确变化或重新确认的事实；没有变化的事实不必重复记录</requirement>
  <requirement>权威事实的 value 必须使用完整、无歧义的名称，禁止使用"此物"、"该物"、"前述物品"、"此件"、"那件"等依赖上下文的代词。value 中必须重复使用 subject 的完整名称，或写出能唯一识别该物品的完整描述；如果涉及多个同类物品，必须分别写明其完整名称和用途。</requirement>
  <requirement>如果某个事实涉及"某物品不用于某用途"，必须同时写明该物品的完整名称和该用途的完整名称，避免后续章节将两个不同用途的物品混淆。</requirement>
  <requirement>【关键】必须提取以下高约束性事实，并标记为 critical 重要性：
    - 关键物品/设定的来源、制造者、赠予者、材质、来历（attribute 建议为"来源"、"制造者"或"材质"）
    - 角色之间明确达成的承诺、约定、交易条件、限制、底线
    - 角色制定的计划、策略及其关键约束条件
    - 关键物品/角色的身份、归属、持有者
  </requirement>
</canonical_facts_requirements>

  <story_state_requirements>
  <requirement>characterLocations: 每个主要角色在本章结束时的所在位置</requirement>
  <requirement>characterStatus: 每个主要角色的身体状况、情绪状态、能力状态等</requirement>
  <requirement>keyItemsLocation: 关键物品在本章结束时的唯一位置或持有者。同一物品只能有一条记录；如果位置发生变化，只记录本章结束时的最终位置，不得同时保留旧位置</requirement>
  <requirement>keyItemsLocation 必须使用统一、标准的物品名称，禁止同一物品以多个别名并存</requirement>
  <requirement>如果某个关键物品位置没有变化，直接省略该物品或使用"同前"，不要重复记录相同位置</requirement>
  <requirement>keyItemsState: 关键物品在本章结束时的状态。如果物品状态发生变化，必须记录新状态</requirement>
  <requirement>activePlots: 本章结束时尚未完结的情节线</requirement>
  <requirement>revealedSecrets: 本章中新揭示的秘密或真相（之前未揭示的）</requirement>
  <requirement>pendingTasks: 本章中角色新领受的、或前章遗留并在本章状态发生变化的待办差事</requirement>
  <requirement>currentScene: 本章主要发生的场景/地点</requirement>
  <requirement>storyTime: 故事内的时间标记</requirement>
</story_state_requirements>

<warnings>
  <warning>你必须严格从上方提供的章节内容中提取事实，禁止编造、推测或引入内容中未出现的角色和事件</warning>
  <warning>storyState 中的信息必须与章节内容完全一致，禁止推测角色位置或物品位置</warning>
  <warning>如果某个角色在本章中没有台词或明确行为，则不要为其创建 characterFacts 条目</warning>
  <warning>如果某个角色在本章中位置没有变化，且前章已知其位置，可以标注为"同前"</warning>
</warnings>

<note>只返回JSON，不要其他内容。</note>`),
    ]
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

export function processSummaryOutput(
  output: AgentOutput,
  chapterIndex?: number,
  characters?: Character[],
  existingStoryState?: StoryState,
): { summary: string; storyState?: StoryState } | null {
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

    const disambiguateValue = (value: string, subject: string): string => {
      // 权威事实中禁止使用依赖上下文的代词；如果 LLM 仍然生成了，用完整 subject 兜底替换。
      const ambiguousPronouns = /此物|该物|前述物品|此件|那件/g
      if (!ambiguousPronouns.test(value)) return value
      logger.warn(`[MuseFlow] canonicalFact 中发现模糊指代，将用 '${subject}' 兜底澄清: ${value}`)
      return value.replace(ambiguousPronouns, subject)
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

  // Auto-promote source-like critical facts to canonicalFacts as a safety net.
  if (storyState) {
    const sourceFacts = extractSourceFacts(data, chapterIndex ?? 0)
    if (sourceFacts.length > 0) {
      const existingFacts = storyState.canonicalFacts ?? []
      const existingKeys = new Set(existingFacts.map(f => `${f.subject}|${f.attribute}`))
      const newFacts = sourceFacts.filter(f => !existingKeys.has(`${f.subject}|${f.attribute}`))
      if (newFacts.length > 0) {
        logger.info(`[MuseFlow] SummaryAgent 自动提升 ${newFacts.length} 条来源类权威事实`)
        storyState.canonicalFacts = [...existingFacts, ...newFacts]
      }
    }
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

  if (storyState) {
    const extractedSupersededFacts = extractSupersededFacts() ?? []
    const existingSupersededFacts = storyState.supersededFacts ?? []
    const mergedSupersededFacts = [...existingSupersededFacts, ...extractedSupersededFacts]
    if (mergedSupersededFacts.length > 0) {
      storyState.supersededFacts = mergedSupersededFacts
    }
    return { summary, storyState }
  }

  return { summary }
}
