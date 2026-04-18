import type { ReducedGraphState } from './state.js'
import type { ChapterMeta } from '../types/chapter.js'
import type { Character } from '../types/character.js'
import {
  WorldbuilderAgent,
  CharacterAgent,
  OutlineAgent,
  ChapterAgent,
  QualityAgent,
  ForeshadowingAgent,
  HallucinationAgent,
  ConsistencyAgent,
} from '../agents/index.js'
import { generateId } from '../utils/id.js'
import type { AgentState } from '../agents/base.js'
import { writeChapterContent, readChapterContent } from '../storage/filesystem/writer.js'
import { saveOutline } from '../storage/database/dao/chapter.js'
import { getGenreSkill } from '../genres/registry.js'
import { toDisplayChapterNumber } from '../utils/chapter-display.js'

let worldbuilderAgent: WorldbuilderAgent | null = null
let characterAgent: CharacterAgent | null = null
let outlineAgent: OutlineAgent | null = null
let chapterAgent: ChapterAgent | null = null
let qualityAgent: QualityAgent | null = null
let foreshadowingAgent: ForeshadowingAgent | null = null
let hallucinationAgent: HallucinationAgent | null = null
let consistencyAgent: ConsistencyAgent | null = null

function getWorldbuilderAgent(): WorldbuilderAgent {
  if (!worldbuilderAgent) worldbuilderAgent = new WorldbuilderAgent()
  return worldbuilderAgent
}

function getCharacterAgent(): CharacterAgent {
  if (!characterAgent) characterAgent = new CharacterAgent()
  return characterAgent
}

function getOutlineAgent(): OutlineAgent {
  if (!outlineAgent) outlineAgent = new OutlineAgent()
  return outlineAgent
}

function getChapterAgent(): ChapterAgent {
  if (!chapterAgent) chapterAgent = new ChapterAgent()
  return chapterAgent
}

function getQualityAgent(): QualityAgent {
  if (!qualityAgent) qualityAgent = new QualityAgent()
  return qualityAgent
}

function getForeshadowingAgent(): ForeshadowingAgent {
  if (!foreshadowingAgent) foreshadowingAgent = new ForeshadowingAgent()
  return foreshadowingAgent
}

function getHallucinationAgent(): HallucinationAgent {
  if (!hallucinationAgent) hallucinationAgent = new HallucinationAgent()
  return hallucinationAgent
}

function getConsistencyAgent(): ConsistencyAgent {
  if (!consistencyAgent) consistencyAgent = new ConsistencyAgent()
  return consistencyAgent
}

function charactersToString(characters: Character[]): string {
  return characters.map(c =>
    `【${c.name}】${c.description || '（无描述）'}`
  ).join('\n')
}

export async function build_world(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  const agent = getWorldbuilderAgent()
  const agentState: AgentState = {
    idea: state.idea,
    genre: state.genre,
    totalChapters: state.totalChapters,
  }

  const output = await agent.run(agentState)
  const world = agent.processOutput(output, state.story.id)

  return { world }
}

export async function create_characters(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  const agent = getCharacterAgent()
  const worldContent = state.world?.content
  const agentState: AgentState = {
    idea: state.idea,
    genre: state.genre,
    totalChapters: state.totalChapters,
    ...(worldContent ? { world: worldContent } : {}),
  }

  const output = await agent.run(agentState)
  const characters = agent.processOutput(output, state.story.id)

  return { characters }
}

export async function create_outline(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  const agent = getOutlineAgent()
  const worldContent = state.world?.content
  const agentState: AgentState = {
    idea: state.idea,
    genre: state.genre,
    totalChapters: state.totalChapters,
    ...(worldContent ? { world: worldContent } : {}),
    characters: charactersToString(state.characters),
  }

  const output = await agent.run(agentState)
  const outline = agent.processOutput(output)
  saveOutline(state.story.id, outline)

  return { outline }
}

export async function draft_chapter(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  const agent = getChapterAgent()
  const chapterIndex = state.currentChapterIndex
  const outlineItem = state.outline[chapterIndex]
  const worldContent = state.world?.content

  const previousChapters = state.chapters
    .slice(0, chapterIndex)
    .filter((c): c is ChapterMeta => c !== null)
    .map(c => c.summary || '')
    .join('\n\n')

  const agentState: AgentState = {
    idea: state.idea,
    genre: state.genre,
    totalChapters: state.totalChapters,
    ...(worldContent ? { world: worldContent } : {}),
    characters: charactersToString(state.characters),
    outline: outlineItem ? `第${toDisplayChapterNumber(chapterIndex)}章：${outlineItem.title}\n${outlineItem.description}` : state.outline.map((o, i) => `第${toDisplayChapterNumber(i)}章：${o.title}`).join('\n'),
    previousChapters,
    chapterIndex,
    chapterSummaries: state.chapterSummaries,
  }

  const output = await agent.run(agentState)

  const content = output.content ?? ''
  await writeChapterContent(state.story.outputDir, chapterIndex, content)

  const now = Date.now()
  const newChapter: ChapterMeta = {
    id: generateId(),
    storyId: state.story.id,
    number: toDisplayChapterNumber(chapterIndex),
    title: null,
    outline: outlineItem?.description || null,
    summary: null,
    foreshadows: null,
    status: 'drafting',
    createdAt: now,
    updatedAt: now,
  }

  const newChapters = [...state.chapters]
  newChapters[chapterIndex] = newChapter

  return { chapters: newChapters }
}

function countChineseWords(text: string): number {
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) ?? []).length
  const englishWords = (text.match(/[a-zA-Z]+/g) ?? []).length
  return chineseChars + englishWords
}

export async function validate_chapter(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  const chapterIndex = state.currentChapterIndex
  const content = await readChapterContent(state.story.outputDir, chapterIndex)

  if (content === null) {
    return {
      pendingIssues: [
        ...state.pendingIssues,
        {
          id: generateId(),
          type: 'word_count' as const,
          severity: 'error' as const,
          description: `第 ${chapterIndex + 1} 章正文文件未找到`,
        },
      ],
    }
  }

  const wordCount = countChineseWords(content)
  const genre = getGenreSkill(state.genre)
  const min = genre?.chapterWordCountMin ?? 1500
  const max = genre?.chapterWordCountMax ?? 8000

  const newIssues = [...state.pendingIssues]

  if (wordCount < min) {
    newIssues.push({
      id: generateId(),
      type: 'word_count' as const,
      severity: 'error',
      description: `第 ${chapterIndex + 1} 章字数 ${wordCount} 低于最低要求 ${min} 字`,
    })
  } else if (wordCount > max) {
    newIssues.push({
      id: generateId(),
      type: 'word_count' as const,
      severity: 'warning',
      description: `第 ${chapterIndex + 1} 章字数 ${wordCount} 超过建议上限 ${max} 字`,
    })
  }

  return { pendingIssues: newIssues }
}

export async function quality_pass(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  const agent = getQualityAgent()
  const chapterIndex = state.currentChapterIndex
  const chapter = state.chapters[chapterIndex]

  if (!chapter) return { chapters: state.chapters }

  const chapterSummary = chapter.summary ?? undefined
  const agentState: AgentState = {
    idea: state.idea,
    genre: state.genre,
    totalChapters: state.totalChapters,
    ...(chapterSummary ? { chapterContent: chapterSummary } : {}),
  }

  const output = await agent.run(agentState)
  const { issues } = agent.processOutput(output)

  const updatedChapter: ChapterMeta = {
    ...chapter,
    updatedAt: Date.now(),
  }

  const newChapters = [...state.chapters]
  newChapters[chapterIndex] = updatedChapter

  return { chapters: newChapters, pendingIssues: [...state.pendingIssues, ...issues] }
}

export async function detect_foreshadowing(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  const agent = getForeshadowingAgent()
  const chapterIndex = state.currentChapterIndex
  const chapter = state.chapters[chapterIndex]

  if (!chapter) return { foreshadowStack: state.foreshadowStack }

  const chapterSummary = chapter.summary ?? undefined
  const agentState: AgentState = {
    idea: state.idea,
    genre: state.genre,
    totalChapters: state.totalChapters,
    ...(chapterSummary ? { chapterContent: chapterSummary } : {}),
  }

  const output = await agent.run(agentState)
  const foreshadowStack = agent.processOutput(output, chapterIndex, state.foreshadowStack)

  return { foreshadowStack }
}

export async function detect_hallucination(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  const agent = getHallucinationAgent()
  const chapterIndex = state.currentChapterIndex
  const chapter = state.chapters[chapterIndex]

  if (!chapter) return { pendingIssues: state.pendingIssues }

  const worldContent = state.world?.content
  const chapterSummary = chapter.summary ?? undefined
  const agentState: AgentState = {
    idea: state.idea,
    genre: state.genre,
    totalChapters: state.totalChapters,
    ...(worldContent ? { world: worldContent } : {}),
    characters: charactersToString(state.characters),
    ...(chapterSummary ? { chapterContent: chapterSummary } : {}),
  }

  const output = await agent.run(agentState)
  const issues = agent.processOutput(output)

  return { pendingIssues: [...state.pendingIssues, ...issues] }
}

export async function detect_consistency(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  const agent = getConsistencyAgent()
  const chapterIndex = state.currentChapterIndex
  const chapter = state.chapters[chapterIndex]

  if (!chapter) return { pendingIssues: state.pendingIssues }

  const chapterSummary = chapter.summary ?? undefined
  const agentState: AgentState = {
    idea: state.idea,
    genre: state.genre,
    totalChapters: state.totalChapters,
    ...(chapterSummary ? { chapterContent: chapterSummary } : {}),
    chapterSummaries: state.chapterSummaries,
  }

  const output = await agent.run(agentState)
  const issues = agent.processOutput(output)

  return { pendingIssues: [...state.pendingIssues, ...issues] }
}

export async function request_rewrite(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  const issues = state.pendingIssues.filter(i => i.severity === 'error')
  if (issues.length > 0) {
    console.error('[MuseFlow] 严重问题需要重写:', issues)
  }
  return { rewriteRequested: true }
}

export async function finalize_chapter(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  const chapterIndex = state.currentChapterIndex
  const chapter = state.chapters[chapterIndex]

  if (chapter) {
    const summary = chapter.summary || ''
    if (summary && !state.chapterSummaries.includes(summary)) {
      state.chapterSummaries.push(summary)
    }
  }

  const nextIndex = state.currentChapterIndex + 1
  return {
    currentChapterIndex: nextIndex,
    pendingIssues: [],
    rewriteRequested: false,
    rewriteApproved: false,
    chapterSummaries: state.chapterSummaries,
  }
}

export async function finalize_story(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  return {}
}
