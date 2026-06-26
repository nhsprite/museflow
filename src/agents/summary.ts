import { logger } from '../utils/logger.js'
import { BaseAgent, type AgentState, type AgentOutput } from './base.js'
import type { Character } from '../types/character.js'
import type { StoryState } from '../types/story-state.js'
import type { Message } from '../model/provider.js'
import { extractJsonBlock, repairMalformedJson } from '../model/provider.js'
import { sanitizeStoryState } from '../utils/story-state-validation.js'
import { OFFICIAL_CHARACTER_RULES, STATE_AUTHORITY_RULES } from './prompt-fragments.js'

export class SummaryAgent extends BaseAgent {
  constructor() {
    super(undefined, 0.3)
  }

  protected buildPrompt(state: AgentState): Message[] {
    const establishedSection = state.establishedCharacters && state.establishedCharacters.length > 0
      ? `<established_characters>
以下角色已在前面章节的摘要或故事状态中出现，允许继续出现：
${state.establishedCharacters.map(c => `- ${c.name}${c.description ? `：${c.description}` : ''}`).join('\n')}
</established_characters>`
      : ''

    const whitelistSection = state.charactersList && state.charactersList.length > 0
      ? `<official_characters>
以下为本故事官方角色与大纲登场角色。摘要中涉及的有名有姓、有亲属关系、有身份地位的角色必须来自此列表或下方【前文已建立角色】列表；本章首次合理登场的新角色也可以列出，但必须在描述中注明"本章新登场"：
${state.charactersList.map(c => `- ${c.name}${c.description ? `：${c.description}` : ''}`).join('\n')}
</official_characters>${state.outlineCharacters && state.outlineCharacters.length > 0 ? `
<outline_characters>
以下角色由大纲明确命名并将在本章或之前章节登场，允许出现：
${state.outlineCharacters.map(c => `- ${c.name}${c.description ? `：${c.description}` : ''}`).join('\n')}
</outline_characters>` : ''}${establishedSection}`
      : establishedSection

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
        "subject": "被覆盖的事实主体（如某物品/角色）",
        "oldFact": "本章中提到的、但已知被后续大纲覆盖的旧事实",
        "reason": "被覆盖的原因（如'后续大纲已更新此设定'）"
      }
    ],
    "storyState": {
      "characterLocations": { "角色名": "当前所在地点" },
      "characterStatus": { "角色名": "当前状态（受伤/中毒/健康/情绪等）" },
      "keyItemsLocation": { "物品名": "当前位置或持有者" },
      "keyItemsState": { "物品名": "当前状态（活跃/沉寂/受损/充能中/封印等）" },
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
      "storyTime": "故事内时间（如第三天傍晚）"
    }
  }
</output_format>

<importance_criteria>
  <critical>对后续章节有决定性影响，远距离章节也必须保留。例如：角色死亡、重大身份揭露、核心物品获得、关键伏笔埋下</critical>
  <major>对近期章节有影响，中期距离保留。例如：角色关系变化、新能力获得、重要对话承诺</major>
  <minor>仅对本章或极近期有参考价值，远距离可丢弃。例如：场景细节描写、临时情绪反应、次要角色互动</minor>
</importance_criteria>

  <character_identity_continuity>
  <requirement>描述角色身份时，必须沿用前文已建立的核心身份，不要因本章临时承担的任务而改变核心定位</requirement>
  <requirement>例如：如果某角色在前文是"助理"，本章即使临时帮忙整理文件、传话或跑腿，也应描述为"助理，本章临时协助整理文件"，而不是改写为"秘书"或"司机"</requirement>
  <requirement>核心身份变化必须基于明确的剧情事件（如被正式收房、被逐出府邸、身份揭露），不能因临时任务而变化</requirement>
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
  <requirement>包括"明日去某处"、"后日办某事"、"三日期限内完成"等明确行动指令</requirement>
  <requirement>如果本章完成了前章遗留的差事，将其 status 标记为 "done"</requirement>
  <requirement>如果本章推迟了前章遗留的差事，保持 status 为 "pending" 并更新 dueTime 或 dueChapter</requirement>
  <requirement>如果后续大纲已覆盖某条差事，将其 status 标记为 "superseded"</requirement>
  <requirement>每个 pending task 必须包含 assignee（执行者）和 description（具体内容）</requirement>
</pending_tasks_requirements>

<superseded_facts_requirements>
  <requirement>如果本章提到的某个"事实"已知被后续章节的大纲覆盖或更新（如某物品的位置、某个角色的身份等），请在 supersededFacts 中记录该旧事实</requirement>
  <requirement>这有助于后续章节避免将旧事实当作当前有效信息来使用</requirement>
  <example>如果本章说"样本在实验室A"，但后续大纲已更新为"样本在实验室B"，则记录 supersededFact: {subject: "样本", oldFact: "样本在实验室A", reason: "后续大纲已更新位置"}</example>
</superseded_facts_requirements>

<canonical_facts_requirements>
  <requirement>从本章内容中提取所有被本章明确确立或更新的"权威事实"，写入 storyState.canonicalFacts</requirement>
  <requirement>每个权威事实必须包含：subject（事实主体）、attribute（属性维度）、value（权威值）</requirement>
  <requirement>如果某个权威事实覆盖了前文章节中的旧认知，必须填写 supersedes 数组，指明被覆盖的章节索引和旧值</requirement>
  <requirement>章节索引从0开始计数：第1章对应0，第2章对应1，以此类推</requirement>
  <requirement>示例：某物品在本章从"实验室A"转移到"实验室B"，则记录 canonicalFact: {subject: "该物品", attribute: "所在位置", value: "实验室B", establishedIn: 当前章节索引, supersedes: [{chapter: 旧章节索引, oldValue: "实验室A"}]}</requirement>
  <requirement>只记录本章有明确变化或重新确认的事实；没有变化的事实不必重复记录</requirement>
</canonical_facts_requirements>

  <story_state_requirements>
  <requirement>characterLocations: 每个主要角色在本章结束时的所在位置</requirement>
  <requirement>characterStatus: 每个主要角色的身体状况、情绪状态、能力状态等</requirement>
  <requirement>keyItemsLocation: 关键物品在本章结束时的位置或持有者（如果物品位置发生变化，必须记录新位置）</requirement>
  <requirement>keyItemsState: 关键物品在本章结束时的状态（如"活跃/沉寂/受损/充能中/封印"）。如果物品状态发生变化，必须记录新状态</requirement>
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
    const trimmed = content.trim()
    const jsonText = extractJsonBlock(trimmed)
    try {
      return { success: true, data: JSON.parse(jsonText) }
    } catch {
      try {
        return { success: true, data: JSON.parse(repairMalformedJson(jsonText)) }
      } catch {
        return { success: false, error: 'JSON解析失败' }
      }
    }
  }
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

    const toCanonicalFacts = (val: unknown): import('../types/story-state.js').CanonicalFact[] => {
      if (!Array.isArray(val)) return []
      return val
        .filter((item): item is Record<string, unknown> => item && typeof item === 'object')
        .map((item, idx) => {
          const supersedesRaw = Array.isArray(item['supersedes'])
            ? item['supersedes'].filter((s): s is Record<string, unknown> => s && typeof s === 'object')
            : []
          return {
            id: typeof item['id'] === 'string' && item['id'].length > 0
              ? item['id']
              : `cf_${chapterIndex ?? 0}_${idx}`,
            subject: typeof item['subject'] === 'string' ? item['subject'] : '',
            attribute: typeof item['attribute'] === 'string' ? item['attribute'] : '',
            value: typeof item['value'] === 'string' ? item['value'] : '',
            establishedIn: typeof item['establishedIn'] === 'number' ? item['establishedIn'] : (chapterIndex ?? -1),
            supersedes: supersedesRaw.length > 0
              ? supersedesRaw.map(s => ({
                  chapter: typeof s['chapter'] === 'number' ? s['chapter'] : -1,
                  oldValue: typeof s['oldValue'] === 'string' ? s['oldValue'] : '',
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

  if (storyState && characters && characters.length > 0) {
    const report = sanitizeStoryState(storyState, characters, { preserveExisting: true, existingStoryState })
    if (report.removedCharacters.length > 0) {
      logger.warn(`[MuseFlow] SummaryAgent 移除了 invented 角色: ${report.removedCharacters.join(', ')}`)
    }
    if (report.itemLocationConflicts.length > 0) {
      logger.warn(`[MuseFlow] SummaryAgent 检测到物品位置冲突: ${report.itemLocationConflicts.map(c => c.item).join(', ')}`)
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
    const supersededFacts = extractSupersededFacts()
    if (supersededFacts && supersededFacts.length > 0) {
      storyState.supersededFacts = supersededFacts
    }
    return { summary, storyState }
  }

  return { summary }
}
