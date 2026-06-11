import { BaseAgent, type AgentState, type AgentOutput } from './base.js'
import type { Message } from '../model/provider.js'

export class SummaryAgent extends BaseAgent {
  constructor() {
    super(undefined, 0.3)
  }

  protected buildPrompt(state: AgentState): Message[] {
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
    "storyState": {
      "characterLocations": { "角色名": "当前所在地点" },
      "characterStatus": { "角色名": "当前状态（受伤/中毒/健康/情绪等）" },
      "keyItemsLocation": { "物品名": "当前位置或持有者" },
      "activePlots": ["进行中情节线"],
      "revealedSecrets": ["本章新揭示的秘密"],
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

<character_facts_requirements>
  对于每个有台词或明确行为描写的角色，提取：
  <requirement>该角色在本章中明确承认/知道的事实</requirement>
  <requirement>该角色对本章关键信息的反应/态度</requirement>
  <requirement>该角色做出的关键承诺或威胁</requirement>
</character_facts_requirements>

<story_state_requirements>
  <requirement>characterLocations: 每个主要角色在本章结束时的所在位置</requirement>
  <requirement>characterStatus: 每个主要角色的身体状况、情绪状态、能力状态等</requirement>
  <requirement>keyItemsLocation: 关键物品在本章结束时的位置或持有者（如果物品位置发生变化，必须记录新位置）</requirement>
  <requirement>activePlots: 本章结束时尚未完结的情节线</requirement>
  <requirement>revealedSecrets: 本章中新揭示的秘密或真相（之前未揭示的）</requirement>
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
    const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
    if (codeBlockMatch) {
      try {
        return { success: true, data: JSON.parse(codeBlockMatch[1]!.trim()) }
      } catch { }
    }
    try {
      return { success: true, data: JSON.parse(trimmed) }
    } catch {
      return { success: false, error: 'JSON解析失败' }
    }
  }
}

  export function processSummaryOutput(output: AgentOutput): { summary: string; storyState?: import('../types/story-state.js').StoryState } | null {
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

  const extractStoryState = (): import('../types/story-state.js').StoryState | undefined => {
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

    return {
      characterLocations: toRecord(s['characterLocations']),
      characterStatus: toRecord(s['characterStatus']),
      keyItemsLocation: toRecord(s['keyItemsLocation']),
      activePlots: toStringArray(s['activePlots']),
      revealedSecrets: toStringArray(s['revealedSecrets']),
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

  const storyState = extractStoryState()

  if (storyState) {
    return { summary, storyState }
  }

  return { summary }
}
