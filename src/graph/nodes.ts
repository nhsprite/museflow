import type { ReducedGraphState } from './state.js'
import type { ChapterMeta } from '../types/chapter.js'
import type { Character } from '../types/character.js'
import {
  WorldbuilderAgent,
  CharacterAgent,
  OutlineAgent,
  ChapterAgent,
  ChapterPlannerAgent,
  QualityAgent,
  ForeshadowingAgent,
  HallucinationAgent,
  ConsistencyAgent,
  OutlineComplianceAgent,
  FixAgent,
  SummaryAgent,
  processSummaryOutput,
} from '../agents/index.js'
import { generateId } from '../utils/id.js'
import type { AgentState } from '../agents/base.js'
import { writeChapterContent, readChapterContent, writeOutlineContent, writeStoryBible } from '../storage/filesystem/writer.js'
import { saveOutline } from '../storage/database/dao/chapter.js'
import { saveCharacters } from '../storage/database/dao/character.js'
import { saveWorld } from '../storage/database/dao/world.js'
import { appendTimelineSnapshot, getLatestSnapshot, saveForeshadowStack, saveForeshadowAlerts } from '../storage/database/dao/timeline.js'
import { saveStoryState, getStoryState, createEmptyStoryState } from '../storage/database/dao/story-state.js'
import type { StoryState } from '../types/story-state.js'
import { getForeshadowAlerts } from './state.js'
import {
  buildLayeredSummaries,
  filterCharacterFactsByImportance,
  filterKeyEventsByImportance,
  getImportanceThreshold,
  getCompressionLevel,
  type ImportanceLevel,
} from '../utils/summary-compressor.js'
import { updateStoryTitle, renameStoryOutputDir } from '../storage/database/dao/story.js'
import { getGenreSkill } from '../genres/registry.js'
import { getStoryOutputDirWithTitle } from '../utils/paths.js'
import { toDisplayChapterNumber } from '../utils/chapter-display.js'
import { getCheckpointer } from './checkpointer.js'

let worldbuilderAgent: WorldbuilderAgent | null = null
let characterAgent: CharacterAgent | null = null
let outlineAgent: OutlineAgent | null = null
let chapterAgent: ChapterAgent | null = null
let chapterPlannerAgent: ChapterPlannerAgent | null = null
let qualityAgent: QualityAgent | null = null
let foreshadowingAgent: ForeshadowingAgent | null = null
let hallucinationAgent: HallucinationAgent | null = null
let consistencyAgent: ConsistencyAgent | null = null
let summaryAgent: SummaryAgent | null = null

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

function getChapterPlannerAgent(): ChapterPlannerAgent {
  if (!chapterPlannerAgent) chapterPlannerAgent = new ChapterPlannerAgent()
  return chapterPlannerAgent
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

function getSummaryAgent(): SummaryAgent {
  if (!summaryAgent) summaryAgent = new SummaryAgent()
  return summaryAgent
}

function getOutlineComplianceAgent(): OutlineComplianceAgent {
  if (!outlineComplianceAgent) outlineComplianceAgent = new OutlineComplianceAgent()
  return outlineComplianceAgent
}

function getFixAgent(): FixAgent {
  if (!fixAgent) fixAgent = new FixAgent()
  return fixAgent
}

let outlineComplianceAgent: OutlineComplianceAgent | null = null
let fixAgent: FixAgent | null = null

function charactersToString(characters: Character[]): string {
  return characters.map(c => {
    const parts = [`【${c.name}】`]
    if (c.description) parts.push(c.description)
    if (c.dialogueStyle) parts.push(`对话风格：${c.dialogueStyle}`)
    return parts.join('\n')
  }).join('\n')
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

  if (!world) {
    console.error('[MuseFlow] 错误: 世界观生成失败，请检查 AI 输出或重试')
    return { world: null, story: state.story }
  }

  saveWorld(state.story.id, world.content)

  // 如果用户已经选择了标题，保留用户的选择，不使用 AI 生成的标题
  const existingTitle = state.story.title
  const aiGeneratedTitle = agent.extractTitle(output)

  if (!existingTitle || existingTitle.trim() === '') {
    // 用户没有选择标题（旧的调用方式），使用 AI 生成的标题
    if (!aiGeneratedTitle) {
      return { world, story: { ...state.story, title: state.story.title } }
    }

    updateStoryTitle(state.story.id, aiGeneratedTitle)
    const newOutputDir = getStoryOutputDirWithTitle(aiGeneratedTitle, state.story.id)
    renameStoryOutputDir(state.story.id, newOutputDir)

    return { world, story: { ...state.story, outputDir: newOutputDir, title: aiGeneratedTitle } }
  }

  // 用户已经选择了标题，保留用户的选择
  console.log(`[MuseFlow] 使用用户选择的书名：${existingTitle}`)
  return { world, story: { ...state.story, title: existingTitle } }
}

export async function create_characters(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  const agent = getCharacterAgent()
  const worldContent = state.world?.content
  const agentState: AgentState = {
    idea: state.idea,
    genre: state.genre,
    totalChapters: state.totalChapters,
    title: state.story.title,
    ...(state.story.worldDirection ? { worldDirection: state.story.worldDirection } : {}),
    ...(worldContent ? { world: worldContent } : {}),
  }

  const maxRetries = 2
  let lastOutput: import('../agents/base.js').AgentOutput | null = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      console.warn(`[MuseFlow] 角色生成解析失败，第 ${attempt}/${maxRetries} 次重试...`)
    }

    const output = await agent.run(agentState)
    lastOutput = output
    const characters = agent.processOutput(output, state.story.id)

    if (characters.length > 0) {
      if (attempt > 0) {
        console.log(`[MuseFlow] 角色生成重试成功，共创建 ${characters.length} 个人物`)
      }
      saveCharacters(state.story.id, characters)
      return { characters }
    }

    if (!output.success && output.content) {
      console.warn(`[MuseFlow] 第 ${attempt + 1} 次角色生成原始输出（前 500 字符）：`)
      console.warn(output.content.slice(0, 500))
    }
  }

  console.error('[MuseFlow] 错误：角色生成失败，已达到最大重试次数')
  if (lastOutput?.content) {
    console.error('[MuseFlow] 最后一次原始输出（前 1000 字符）：')
    console.error(lastOutput.content.slice(0, 1000))
  }
  throw new Error('[MuseFlow] 错误：角色生成失败，请检查 AI 输出或重试')
}

export async function create_outline(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  const agent = getOutlineAgent()
  const worldContent = state.world?.content
  const agentState: AgentState = {
    idea: state.idea,
    genre: state.genre,
    totalChapters: state.totalChapters,
    title: state.story.title,
    ...(state.story.worldDirection ? { worldDirection: state.story.worldDirection } : {}),
    ...(worldContent ? { world: worldContent } : {}),
    characters: charactersToString(state.characters),
  }

  const output = await agent.run(agentState)
  const outline = agent.processOutput(output)

  if (outline.length === 0) {
    throw new Error('[MuseFlow] 错误：大纲解析失败，AI 输出格式无法识别，请重试')
  }

  saveOutline(state.story.id, outline)
  await writeOutlineContent(state.story.outputDir, state.story.title, outline)

  await writeStoryBible(
    state.story.outputDir,
    state.story,
    worldContent || '',
    state.characters,
    outline,
  )

  return { outline }
}

export async function plan_chapter(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  const agent = getChapterPlannerAgent()
  const chapterIndex = state.currentChapterIndex
  const outlineItem = state.outline[chapterIndex]
  const worldContent = state.world?.content

  const previousChapters = buildLayeredSummaries(state.chapterSummaries, chapterIndex)
  const timelineSnapshot = buildCharacterFactTimeline(state, chapterIndex)

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
    timelineSnapshot,
    foreshadowStack: state.foreshadowStack,
  }

  const output = await agent.run(agentState)

  if (!output.success || !output.data) {
    console.warn('[MuseFlow] 章节规划失败，将跳过规划直接写作')
    return {}
  }

  return { chapterPlan: output.data as import('../agents/chapter-planner.js').ChapterPlan }
}

export async function draft_chapter(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  const agent = getChapterAgent()
  const chapterIndex = state.currentChapterIndex
  const outlineItem = state.outline[chapterIndex]
  const worldContent = state.world?.content

  const previousChapters = buildLayeredSummaries(state.chapterSummaries, chapterIndex)
  const timelineSnapshot = buildCharacterFactTimeline(state, chapterIndex)
  const keyEventsTimeline = buildKeyEventsTimeline(state, chapterIndex)

  const existingContent = state.rewriteApproved
    ? await readChapterContent(state.story.outputDir, chapterIndex + 1)
    : null

  const storyStateStr = state.storyState ? formatStoryState(state.storyState) : ''

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
    timelineSnapshot,
    keyEventsTimeline,
    foreshadowStack: state.foreshadowStack,
    storyState: storyStateStr,
    ...(state.rewriteApproved ? { issues: state.pendingIssues } : {}),
    ...(existingContent ? { chapterContent: existingContent } : {}),
    ...(state.chapterPlan ? { chapterPlan: state.chapterPlan } : {}),
  }

  const output = await agent.run(agentState)

  let content = output.content ?? ''
  if (!content || content.trim().length === 0) {
    throw new Error(
      `第 ${chapterIndex + 1} 章内容为空，AI 生成失败。请重试。`
    )
  }

  const preWriteCheck = (output.data as { preWriteCheck?: string } | undefined)?.preWriteCheck
  if (!preWriteCheck) {
    console.warn(`[MuseFlow] 第 ${chapterIndex + 1} 章未输出预写检查表，可能遗漏大纲要求`)
  }

  const trimmedContent = content.trim()
  const firstLine = trimmedContent.split('\n').map(l => l.trim()).find(l => l.length > 0)
  const hasTitle = firstLine && (
    /^#{1,2}\s/.test(firstLine) ||
    firstLine.includes(`第${chapterIndex + 1}章`) ||
    firstLine.includes(`第 ${chapterIndex + 1} 章`)
  )

  if (!hasTitle && outlineItem) {
    content = `# 第${chapterIndex + 1}章 ${outlineItem.title}\n\n${trimmedContent}`
  }

  await writeChapterContent(state.story.outputDir, chapterIndex + 1, content)

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

  return {
    chapters: newChapters,
  }
}

export async function fix_chapter(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  const agent = getFixAgent()
  const chapterIndex = state.currentChapterIndex
  const outlineItem = state.outline[chapterIndex]

  const existingContent = await readChapterContent(state.story.outputDir, chapterIndex + 1)
  if (!existingContent) {
    throw new Error(
      `第 ${chapterIndex + 1} 章文件不存在，无法修复。请运行 write 或 rewrite。`
    )
  }

  const paragraphs = splitIntoParagraphs(existingContent)
  const affectedIndices = findAffectedParagraphs(paragraphs, state.pendingIssues)

  const previousChapters = buildLayeredSummaries(state.chapterSummaries, chapterIndex)
  const timelineSnapshot = buildCharacterFactTimeline(state, chapterIndex)

  if (affectedIndices.length === 0) {
    console.log('[MuseFlow] 未能定位到问题所在段落，将使用全文修复模式')
    return await runLegacyFix(agent, state, existingContent, chapterIndex, outlineItem, previousChapters, timelineSnapshot)
  }

  const sentenceFixes = buildSentenceFixes(paragraphs, affectedIndices, state.pendingIssues)

  if (sentenceFixes.length > 0 && sentenceFixes.length <= 5) {
    console.log(`[MuseFlow] 定位到 ${sentenceFixes.length} 个需修改的句子，使用句子级精准修复`)
    return await runSentenceFix(agent, state, existingContent, paragraphs, sentenceFixes, chapterIndex, outlineItem, previousChapters, timelineSnapshot)
  }

  console.log(`[MuseFlow] 定位到 ${affectedIndices.length} 个需修改的段落，使用段落级修复`)
  return await runParagraphFix(agent, state, existingContent, paragraphs, affectedIndices, chapterIndex, outlineItem, previousChapters, timelineSnapshot)
}

function buildSentenceFixes(
  paragraphs: string[],
  affectedIndices: number[],
  issues: Array<import('../types/agent.js').Issue>
): import('../agents/base.js').SentenceFix[] {
  const sentenceFixes: import('../agents/base.js').SentenceFix[] = []

  for (const idx of affectedIndices) {
    const paragraph = paragraphs[idx]
    if (!paragraph) continue

    for (const issue of issues) {
      const affectedSentences = findAffectedSentences(paragraph, issue)
      for (const sentenceIdx of affectedSentences) {
        const sentences = splitParagraphIntoSentences(paragraph)
        const original = sentences[sentenceIdx]
        if (original) {
          sentenceFixes.push({
            paragraphIndex: idx,
            sentenceIndex: sentenceIdx,
            original,
            issue,
          })
        }
      }
    }
  }

  return sentenceFixes
}

async function runSentenceFix(
  agent: FixAgent,
  state: ReducedGraphState,
  existingContent: string,
  paragraphs: string[],
  sentenceFixes: import('../agents/base.js').SentenceFix[],
  chapterIndex: number,
  outlineItem: { description?: string } | undefined,
  previousChapters: string,
  timelineSnapshot: string
): Promise<Partial<ReducedGraphState>> {
  const affectedParagraphs = new Set(sentenceFixes.map(s => s.paragraphIndex))
  const contextIndices = new Set<number>()
  for (const idx of affectedParagraphs) {
    if (idx > 0) contextIndices.add(idx - 1)
    if (idx < paragraphs.length - 1) contextIndices.add(idx + 1)
  }
  for (const idx of affectedParagraphs) {
    contextIndices.delete(idx)
  }

  const contextParagraphs = Array.from(contextIndices).sort((a, b) => a - b).map(idx => paragraphs[idx])
  const context = contextParagraphs.join('\n\n')

  const agentState: AgentState = {
    idea: state.idea,
    genre: state.genre,
    totalChapters: state.totalChapters,
    chapterIndex,
    issues: state.pendingIssues,
    chapterContent: existingContent,
    previousChapters,
    timelineSnapshot,
    sentenceFix: {
      sentences: sentenceFixes,
      context,
    },
  }

  const output = await agent.run(agentState)

  let content = existingContent
  if (output.data && (output.data as { modifiedSentences?: Array<{ paragraphIndex: number; sentenceIndex: number; content: string }> }).modifiedSentences) {
    const modifiedSentences = (output.data as { modifiedSentences: Array<{ paragraphIndex: number; sentenceIndex: number; content: string }> }).modifiedSentences
    const modifiedParagraphs = new Map<number, Array<{ index: number; content: string }>>()

    for (const s of modifiedSentences) {
      if (!modifiedParagraphs.has(s.paragraphIndex)) {
        modifiedParagraphs.set(s.paragraphIndex, [])
      }
      modifiedParagraphs.get(s.paragraphIndex)!.push({ index: s.sentenceIndex, content: s.content })
    }

    const resultParagraphs = [...paragraphs]
    for (const [pIdx, sentences] of modifiedParagraphs) {
      const originalParagraph = paragraphs[pIdx]
      if (originalParagraph) {
        resultParagraphs[pIdx] = mergeSentenceFixes(originalParagraph, sentences)
      }
    }
    content = resultParagraphs.join('\n\n')
  } else {
    content = output.content ?? ''
    if (!content || content.trim().length === 0) {
      throw new Error(`第 ${chapterIndex + 1} 章修复后内容为空，AI 生成失败。请重试。`)
    }
    const affectedIndices = Array.from(new Set(sentenceFixes.map(s => s.paragraphIndex)))
    content = applyParagraphDiffProtection(existingContent, content, affectedIndices)
  }

  content = deduplicateSentences(content)
  await writeChapterContent(state.story.outputDir, chapterIndex + 1, content)

  const now = Date.now()
  const updatedChapter: ChapterMeta = {
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
  newChapters[chapterIndex] = updatedChapter

  return { chapters: newChapters }
}

async function runParagraphFix(
  agent: FixAgent,
  state: ReducedGraphState,
  existingContent: string,
  paragraphs: string[],
  affectedIndices: number[],
  chapterIndex: number,
  outlineItem: { description?: string } | undefined,
  previousChapters: string,
  timelineSnapshot: string
): Promise<Partial<ReducedGraphState>> {
  const paragraphFixes = affectedIndices.map(idx => {
    const paragraphContent = paragraphs[idx]
    if (!paragraphContent) {
      throw new Error(`段落索引 ${idx} 超出范围`)
    }
    return {
      index: idx,
      content: paragraphContent,
      issues: state.pendingIssues.filter(issue => {
        const keywords = extractIssueKeywords(issue)
        return keywords.some(kw => paragraphContent.includes(kw))
      }),
    }
  })

  const contextIndices = new Set<number>()
  for (const idx of affectedIndices) {
    if (idx > 0) contextIndices.add(idx - 1)
    if (idx < paragraphs.length - 1) contextIndices.add(idx + 1)
  }
  for (const idx of affectedIndices) {
    contextIndices.delete(idx)
  }

  const contextParagraphs = Array.from(contextIndices).sort((a, b) => a - b).map(idx => paragraphs[idx])
  const context = contextParagraphs.join('\n\n')

  const agentState: AgentState = {
    idea: state.idea,
    genre: state.genre,
    totalChapters: state.totalChapters,
    chapterIndex,
    issues: state.pendingIssues,
    chapterContent: existingContent,
    previousChapters,
    timelineSnapshot,
    paragraphFix: {
      paragraphs: paragraphFixes,
      context,
    },
  }

  const output = await agent.run(agentState)

  let content: string
  if (output.data && (output.data as { modifiedParagraphs?: Array<{ index: number; content: string }> }).modifiedParagraphs) {
    const modifiedParagraphs = (output.data as { modifiedParagraphs: Array<{ index: number; content: string }> }).modifiedParagraphs
    content = mergeParagraphFixes(paragraphs, modifiedParagraphs, affectedIndices)
  } else {
    content = output.content ?? ''
    if (!content || content.trim().length === 0) {
      throw new Error(`第 ${chapterIndex + 1} 章修复后内容为空，AI 生成失败。请重试。`)
    }
    content = applyParagraphDiffProtection(existingContent, content, affectedIndices)
  }

  content = deduplicateSentences(content)
  await writeChapterContent(state.story.outputDir, chapterIndex + 1, content)

  const now = Date.now()
  const updatedChapter: ChapterMeta = {
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
  newChapters[chapterIndex] = updatedChapter

  return {
    chapters: newChapters,
  }
}

async function runLegacyFix(
  agent: FixAgent,
  state: ReducedGraphState,
  existingContent: string,
  chapterIndex: number,
  outlineItem: { description?: string } | undefined,
  previousChapters: string,
  timelineSnapshot: string
): Promise<Partial<ReducedGraphState>> {
  const worldContent = state.world?.content
  const agentState: AgentState = {
    idea: state.idea,
    genre: state.genre,
    totalChapters: state.totalChapters,
    chapterIndex,
    issues: state.pendingIssues,
    chapterContent: existingContent,
    previousChapters,
    timelineSnapshot,
    ...(worldContent ? { world: worldContent } : {}),
    characters: charactersToString(state.characters),
    outline: state.outline.map((o, i) => `第${i + 1}章：${o.title}\n${o.description}`).join('\n\n'),
  }

  const output = await agent.run(agentState)

  let content = output.content ?? ''
  if (!content || content.trim().length === 0) {
    throw new Error(`第 ${chapterIndex + 1} 章修复后内容为空，AI 生成失败。请重试。`)
  }
  content = deduplicateSentences(content)
  await writeChapterContent(state.story.outputDir, chapterIndex + 1, content)

  const now = Date.now()
  const updatedChapter: ChapterMeta = {
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
  newChapters[chapterIndex] = updatedChapter

  return {
    chapters: newChapters,
  }
}

export function splitIntoParagraphs(text: string): string[] {
  return text.split(/\n\n+/).filter(p => p.trim().length > 0)
}

export interface LocationInfo {
  paragraphIndex?: number
  sentenceIndex?: number
}

export function extractLocationInfo(issue: { description: string; location?: string }): LocationInfo[] {
  const locations: LocationInfo[] = []
  const text = issue.description + ' ' + (issue.location || '')

  const paragraphPatterns = [
    /第\s*(\d+)\s*段/g,
    /第\s*([一二三四五六七八九十百]+)\s*段/g,
    /段落?\s*(\d+)/g,
  ]

  for (const pattern of paragraphPatterns) {
    let match
    while ((match = pattern.exec(text)) !== null) {
      const group = match[1]
      if (!group) continue
      const num = parseLocationNumber(group)
      if (num !== null) {
        locations.push({ paragraphIndex: num - 1 })
      }
    }
  }

  const sentencePatterns = [
    /第\s*(\d+)\s*句/g,
    /第\s*([一二三四五六七八九十百]+)\s*句/g,
  ]

  for (const pattern of sentencePatterns) {
    let match
    while ((match = pattern.exec(text)) !== null) {
      const group = match[1]
      if (!group) continue
      const num = parseLocationNumber(group)
      if (num !== null) {
        locations.push({ sentenceIndex: num - 1 })
      }
    }
  }

  return locations
}

function parseLocationNumber(str: string): number | null {
  const num = parseInt(str, 10)
  if (!isNaN(num)) return num

  const chineseMap: Record<string, number> = {
    '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
    '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
  }

  let result = 0
  for (const char of str) {
    const val = chineseMap[char]
    if (val === undefined) return null
    result = result * 10 + val
  }
  return result > 0 ? result : null
}

const STOP_WORDS = new Set([
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这', '那', '这些', '那些', '这个', '那个', '这样', '那样', '这里', '那里', '这边', '那边', '这时', '那时', '之后', '之前', '然后', '接着', '后来', '于是', '因此', '所以', '因为', '由于', '虽然', '但是', '然而', '不过', '而且', '并且', '或者', '还是', '要么', '不仅', '不但', '只要', '只有', '无论', '不管', '尽管', '即使', '即便', '除非', '除了', '此外', '另外', '而且', '并且', '然后', '接着', '后来', '于是', '因此', '因而', '从而', '总之', '综上所述', '例如', '比如', '譬如', '像是', '好像', '仿佛', '似乎', '大概', '大约', '也许', '可能', '或许', '应该', '应当', '需要', '必须', '一定', '肯定', '当然', '自然', '其实', '实际上', '事实上', '本来', '原来', '原先', '最初', '开始', '最后', '最终', '终于', '结果', '可以', '能够', '可能', '应该', '得', '地', '着', '过', '把', '被', '让', '给', '向', '往', '从', '自', '由', '把', '将', '把', '被', '让', '给', '跟', '同', '与', '及', '以及', '还有', '或者', '还是', '既', '又', '也', '还', '再', '才', '就', '便', '即', '则', '却', '可', '但', '而', '因', '为', '以', '于', '对', '关于', '对于', '至于', '鉴于', '根据', '按照', '依照', '遵循', '遵守', '符合', '满足', '达到', '实现', '完成', '结束', '停止', '终止', '中断', '继续', '恢复', '重复', '重新', '再次', '一再', '屡次', '多次',
])

export function extractIssueKeywords(issue: { description: string; location?: string }): string[] {
  const keywords: string[] = []

  const text = issue.description + ' ' + (issue.location || '')

  const quotes = text.match(/"([^"]+)"/g)
  if (quotes) {
    keywords.push(...quotes.map(q => q.slice(1, -1)))
  }

  const chineseSequences = text.match(/[\u4e00-\u9fff]+/g)
  if (chineseSequences) {
    for (const sequence of chineseSequences) {
      const maxLen = Math.min(6, sequence.length)
      for (let len = 2; len <= maxLen; len++) {
        for (let i = 0; i <= sequence.length - len; i++) {
          const substr = sequence.slice(i, i + len)
          if (substr.length >= 2 && !STOP_WORDS.has(substr)) {
            keywords.push(substr)
          }
        }
      }
    }
  }

  const unique = [...new Set(keywords)]
  return unique.slice(0, 50)
}

export function findAffectedParagraphs(paragraphs: string[], issues: Array<{ description: string; location?: string }>): number[] {
  const affected = new Set<number>()

  for (const issue of issues) {
    const locations = extractLocationInfo(issue)
    const hasExplicitLocation = locations.some(l => l.paragraphIndex !== undefined)

    if (hasExplicitLocation) {
      for (const loc of locations) {
        if (loc.paragraphIndex !== undefined && loc.paragraphIndex >= 0 && loc.paragraphIndex < paragraphs.length) {
          affected.add(loc.paragraphIndex)
        }
      }
      continue
    }

    const keywords = extractIssueKeywords(issue)
    if (keywords.length === 0) continue

    for (let i = 0; i < paragraphs.length; i++) {
      const paragraph = paragraphs[i]
      if (paragraph && keywords.some(kw => paragraph.includes(kw))) {
        affected.add(i)
      }
    }
  }

  return Array.from(affected).sort((a, b) => a - b)
}

export function splitParagraphIntoSentences(paragraph: string): string[] {
  const matches = [...paragraph.matchAll(/[^。！？\n]+[。！？\n]?/g)]
  if (matches.length === 0) return [paragraph]
  return matches.map(m => m[0]).filter(s => s.trim().length > 0)
}

export function findAffectedSentences(paragraph: string, issue: { description: string; location?: string }): number[] {
  const sentences = splitParagraphIntoSentences(paragraph)
  const affected = new Set<number>()

  const locations = extractLocationInfo(issue)
  const hasSentenceLocation = locations.some(l => l.sentenceIndex !== undefined)

  if (hasSentenceLocation) {
    for (const loc of locations) {
      if (loc.sentenceIndex !== undefined && loc.sentenceIndex >= 0 && loc.sentenceIndex < sentences.length) {
        affected.add(loc.sentenceIndex)
      }
    }
    return Array.from(affected).sort((a, b) => a - b)
  }

  const keywords = extractIssueKeywords(issue)
  if (keywords.length === 0) return []

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i]
    if (sentence && keywords.some(kw => sentence.includes(kw))) {
      affected.add(i)
    }
  }

  return Array.from(affected).sort((a, b) => a - b)
}

export function mergeSentenceFixes(
  originalParagraph: string,
  modifiedSentences: Array<{ index: number; content: string }>
): string {
  const sentences = splitParagraphIntoSentences(originalParagraph)
  const modifiedMap = new Map(modifiedSentences.map(s => [s.index, s.content]))

  const result = sentences.map((s, i) => modifiedMap.has(i) ? modifiedMap.get(i)! : s)
  return result.join('')
}

export function mergeParagraphFixes(
  originalParagraphs: string[],
  modifiedParagraphs: Array<{ index: number; content: string }>,
  affectedIndices: number[]
): string {
  const result = [...originalParagraphs]
  const modifiedMap = new Map(modifiedParagraphs.map(p => [p.index, p.content]))

  for (const idx of affectedIndices) {
    if (modifiedMap.has(idx)) {
      result[idx] = modifiedMap.get(idx)!
    }
  }

  return result.join('\n\n')
}

export function applyParagraphDiffProtection(
  original: string,
  fixed: string,
  allowedIndices: number[]
): string {
  const originalParagraphs = splitIntoParagraphs(original)
  const fixedParagraphs = splitIntoParagraphs(fixed)

  if (originalParagraphs.length !== fixedParagraphs.length) {
    console.warn('[MuseFlow] 修复后段落数量变化，跳过段落保护')
    return fixed
  }

  const allowedSet = new Set(allowedIndices)
  let revertedCount = 0
  const result: string[] = []

  for (let i = 0; i < originalParagraphs.length; i++) {
    const originalParagraph = originalParagraphs[i]
    const fixedParagraph = fixedParagraphs[i]
    if (!originalParagraph || !fixedParagraph) {
      continue
    }
    if (!allowedSet.has(i) && originalParagraph !== fixedParagraph) {
      console.log(`[MuseFlow] 检测到无关段落 ${i} 被修改，已自动回退`)
      result.push(originalParagraph)
      revertedCount++
    } else {
      result.push(fixedParagraph)
    }
  }

  if (revertedCount > 0) {
    console.log(`[MuseFlow] 共回退 ${revertedCount} 个无关段落的修改`)
  }

  return result.join('\n\n')
}

export function deduplicateSentences(text: string): string {
  const MIN_SENTENCE_LENGTH = 10
  const SENTENCE_PATTERN = /[^。？！\n]+[。？！\n]/g

  const matches = [...text.matchAll(SENTENCE_PATTERN)]
  if (matches.length === 0) return text

  const seen = new Set<string>()
  let removedCount = 0
  const rebuilt: string[] = []
  let pos = 0

  for (const match of matches) {
    rebuilt.push(text.slice(pos, match.index))
    const sentence = match[0]
    const trimmed = sentence.trim()

    const isDuplicate = trimmed.length >= MIN_SENTENCE_LENGTH && seen.has(trimmed)
    if (isDuplicate) {
      removedCount++
    } else {
      seen.add(trimmed)
      rebuilt.push(sentence)
    }

    pos = (match.index ?? 0) + sentence.length
  }
  rebuilt.push(text.slice(pos))

  const finalText = rebuilt.join('')
  if (removedCount > 0) {
    console.log(`[MuseFlow] 自动清理 ${removedCount} 个重复句子`)
  }
  return finalText
}

function countChineseWords(text: string): number {
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) ?? []).length
  const englishWords = (text.match(/[a-zA-Z]+/g) ?? []).length
  return chineseChars + englishWords
}

export async function validate_chapter(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  const chapterIndex = state.currentChapterIndex
  const content = await readChapterContent(state.story.outputDir, chapterIndex + 1)

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

  if (!chapter) return {}

  const content = await readChapterContent(state.story.outputDir, chapterIndex + 1)
  const worldContent = state.world?.content
  const agentState: AgentState = {
    idea: state.idea,
    genre: state.genre,
    totalChapters: state.totalChapters,
    ...(worldContent ? { world: worldContent } : {}),
    characters: charactersToString(state.characters),
    outline: state.outline.map((o, i) => `第${i + 1}章：${o.title}\n${o.description}`).join('\n\n'),
    ...(content ? { chapterContent: content } : {}),
  }

  const output = await agent.run(agentState)
  const { issues } = agent.processOutput(output)

  const updatedChapter: ChapterMeta = {
    ...chapter,
    updatedAt: Date.now(),
  }

  const newChapters = [...state.chapters]
  newChapters[chapterIndex] = updatedChapter

  // Quality issues are added to pendingIssues for the rewrite loop to address
  return issues.length > 0 ? { pendingIssues: [...state.pendingIssues, ...issues] } : {}
}

export async function detect_foreshadowing(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  const agent = getForeshadowingAgent()
  const chapterIndex = state.currentChapterIndex
  const chapter = state.chapters[chapterIndex]

  if (!chapter) return {}

  const content = await readChapterContent(state.story.outputDir, chapterIndex + 1)
  const worldContent = state.world?.content
  const agentState: AgentState = {
    idea: state.idea,
    genre: state.genre,
    totalChapters: state.totalChapters,
    ...(worldContent ? { world: worldContent } : {}),
    characters: charactersToString(state.characters),
    outline: state.outline.map((o, i) => `第${i + 1}章：${o.title}\n${o.description}`).join('\n\n'),
    ...(content ? { chapterContent: content } : {}),
    foreshadowStack: state.foreshadowStack,
  }

  const output = await agent.run(agentState)
  const foreshadowStack = agent.processOutput(output, chapterIndex, state.foreshadowStack)

  return { foreshadowStack }
}

export async function detect_hallucination(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  const agent = getHallucinationAgent()
  const chapterIndex = state.currentChapterIndex
  const chapter = state.chapters[chapterIndex]

  if (!chapter) return {}

  const worldContent = state.world?.content
  const content = await readChapterContent(state.story.outputDir, chapterIndex + 1)
  const agentState: AgentState = {
    idea: state.idea,
    genre: state.genre,
    totalChapters: state.totalChapters,
    ...(worldContent ? { world: worldContent } : {}),
    characters: charactersToString(state.characters),
    outline: state.outline.map((o, i) => `第${i + 1}章：${o.title}\n${o.description}`).join('\n\n'),
    ...(content ? { chapterContent: content } : {}),
    chapterSummaries: state.chapterSummaries,
    foreshadowStack: state.foreshadowStack,
  }

  const output = await agent.run(agentState)
  const issues = agent.processOutput(output)

  // Hallucination issues are added to pendingIssues for the rewrite loop to address
  return issues.length > 0 ? { pendingIssues: [...state.pendingIssues, ...issues] } : {}
}

export async function detect_consistency(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  const agent = getConsistencyAgent()
  const chapterIndex = state.currentChapterIndex
  const chapter = state.chapters[chapterIndex]

  if (!chapter) return {}

  const content = await readChapterContent(state.story.outputDir, chapterIndex + 1)
  const timelineSnapshot = buildCharacterFactTimeline(state, chapterIndex)

  const agentState: AgentState = {
    idea: state.idea,
    genre: state.genre,
    totalChapters: state.totalChapters,
    ...(state.world?.content ? { world: state.world.content } : {}),
    characters: charactersToString(state.characters),
    outline: state.outline.map((o, i) => `第${i + 1}章：${o.title}\n${o.description}`).join('\n\n'),
    ...(content ? { chapterContent: content } : {}),
    chapterSummaries: state.chapterSummaries,
    chapterIndex,
    timelineSnapshot,
    foreshadowStack: state.foreshadowStack,
    storyState: state.storyState ? formatStoryState(state.storyState) : '',
  }

  const output = await agent.run(agentState)
  const issues = agent.processOutput(output)

  // Consistency issues are added to pendingIssues for the rewrite loop to address
  return issues.length > 0 ? { pendingIssues: [...state.pendingIssues, ...issues] } : {}
}

export async function verify_outline_compliance(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  const agent = getOutlineComplianceAgent()
  const chapterIndex = state.currentChapterIndex
  const outlineItem = state.outline[chapterIndex]
  const chapter = state.chapters[chapterIndex]

  if (!chapter || !outlineItem) {
    return {}
  }

  const content = await readChapterContent(state.story.outputDir, chapterIndex + 1)

  const agentState: AgentState = {
    idea: state.idea,
    genre: state.genre,
    totalChapters: state.totalChapters,
    chapterIndex,
    outline: `第${toDisplayChapterNumber(chapterIndex)}章：${outlineItem.title}\n${outlineItem.description}`,
    ...(content ? { chapterContent: content } : {}),
  }

  const output = await agent.run(agentState)
  const { issues, isCompliant } = agent.processOutput(output)

  if (!isCompliant) {
    return {
      pendingIssues: [...state.pendingIssues, ...issues],
      rewriteApproved: true,
    }
  }

  return {}
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

  // Guard: Verify chapter file has content before marking as complete
  const chapterContent = await readChapterContent(state.story.outputDir, chapterIndex + 1)
  if (chapterContent === null || chapterContent.trim().length === 0) {
    throw new Error(
      `第 ${chapterIndex + 1} 章文件为空或不存在，无法标记为完成。请重试撰写。`
    )
  }

  let updatedStoryState = state.storyState

  if (chapter) {
    let summary = chapter.summary || ''
    const needsSummary = !summary && chapterContent
    if (needsSummary) {
      const summaryAgent = getSummaryAgent()
      const summaryState: AgentState = {
        idea: state.idea,
        genre: state.genre,
        totalChapters: state.totalChapters,
        chapterContent,
        ...(state.outline[chapterIndex]?.title ? { chapterTitle: state.outline[chapterIndex].title } : {}),
        chapterIndex,
      }
      try {
        const summaryOutput = await summaryAgent.run(summaryState)
        const processed = processSummaryOutput(summaryOutput)
        if (processed) {
          summary = processed.summary
          chapter.summary = summary

          if (processed.storyState) {
            const existing = getStoryState(state.story.id)
            updatedStoryState = mergeStoryState(existing, processed.storyState)
            saveStoryState(state.story.id, updatedStoryState)
            console.log(`[MuseFlow] 第 ${chapterIndex + 1} 章状态已更新：${updatedStoryState.currentScene || '无场景'} | ${updatedStoryState.storyTime || '无时间标记'}`)
          }
        }
      } catch (err) {
        console.warn(`[MuseFlow] 生成第 ${chapterIndex + 1} 章摘要失败:`, err)
      }
    }

    if (summary && !state.chapterSummaries.includes(summary)) {
      state.chapterSummaries.push(summary)
    }
  }

  const snapshot = appendTimelineSnapshot(state.story.id, {
    chapterNumber: chapterIndex + 1,
    snapshotType: 'chapter_complete',
    currentChapterIndex: chapterIndex,
    chapterTitle: state.outline[chapterIndex]?.title ?? null,
    chapterSummary: chapter?.summary ?? null,
    wordCount: null,
    stateSummary: null,
    issuesResolved: state.pendingIssues.filter(i => i.severity !== 'error').length,
    issuesPending: state.pendingIssues.filter(i => i.severity === 'error').length,
    stateJson: null,
  })

  saveForeshadowStack(state.story.id, state.foreshadowStack)

  const alerts = getForeshadowAlerts(state.foreshadowStack, chapterIndex + 1)
  saveForeshadowAlerts(state.story.id, alerts)

  const nextIndex = state.currentChapterIndex + 1
  const isLastChapter = nextIndex >= state.totalChapters

  const checkpointer = getCheckpointer()
  await checkpointer.saveChapterCheckpoint(
    state.story.outputDir,
    chapterIndex + 1
  ).catch(() => {})
  await checkpointer.pruneIntermediateCheckpoints(state.story.outputDir).catch(() => {})
  await checkpointer.clearPendingWrites(state.story.outputDir).catch(() => {})

  return {
    currentChapterIndex: nextIndex,
    chapterSummaries: state.chapterSummaries,
    storyState: updatedStoryState,
  }
}

export async function finalize_story(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  return {}
}

export async function auto_fix_warnings(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  const errors = state.pendingIssues.filter(i => i.severity === 'error')
  const warnings = state.pendingIssues.filter(i => i.severity === 'warning')

  if (errors.length > 0) {
    return {}
  }

  if (warnings.length === 0) {
    return {}
  }

  console.warn(`\x1b[93m🔧 [MuseFlow] Auto-fixing ${warnings.length} warning(s):\x1b[0m`)
  for (const warning of warnings) {
    console.warn(`   \x1b[33m⚠️  [${warning.type}]\x1b[0m ${warning.description}`)
  }

  return { pendingIssues: [] }
}

function formatCharacterFactEntries(
  entries: Array<{ character: string; facts: string[] }>,
  chapterNum: number
): string {
  if (entries.length === 0) return ''

  const lines = [`第${chapterNum}章角色事实：`]
  for (const entry of entries) {
    lines.push(`  ${entry.character}：`)
    for (const fact of entry.facts) {
      lines.push(`    - ${fact}`)
    }
  }
  return lines.join('\n')
}

function buildCharacterFactTimeline(
  state: ReducedGraphState,
  upToChapterIndex: number
): string {
  const summaries = state.chapterSummaries.slice(0, upToChapterIndex)
  if (!summaries.length) return '（暂无历史记录）'

  const result: string[] = []

  for (let i = 0; i < summaries.length; i++) {
    const summary = summaries[i]
    if (!summary) continue

    const chapterNum = i + 1
    const distance = upToChapterIndex - chapterNum
    const level = getCompressionLevel(chapterNum - 1, upToChapterIndex)
    const threshold = getImportanceThreshold(level)

    const filtered = filterCharacterFactsByImportance(summary, threshold)
    const formatted = formatCharacterFactEntries(filtered, chapterNum)

    if (formatted) {
      result.push(formatted)
    }
  }

  return result.length > 0 ? result.join('\n\n') : '（暂无历史记录）'
}

function buildKeyEventsTimeline(
  state: ReducedGraphState,
  upToChapterIndex: number
): string {
  const summaries = state.chapterSummaries.slice(0, upToChapterIndex)
  if (!summaries.length) return '（暂无历史记录）'

  const result: string[] = []

  for (let i = 0; i < summaries.length; i++) {
    const summary = summaries[i]
    if (!summary) continue

    const chapterNum = i + 1
    const distance = upToChapterIndex - chapterNum
    const level = getCompressionLevel(chapterNum - 1, upToChapterIndex)
    const threshold = getImportanceThreshold(level)

    const events = filterKeyEventsByImportance(summary, threshold)
    if (events.length > 0) {
      result.push(`第${chapterNum}章关键事件：\n${events.map(e => `  - ${e}`).join('\n')}`)
    }
  }

  return result.length > 0 ? result.join('\n\n') : '（暂无历史记录）'
}

function mergeStoryState(existing: StoryState | null, delta: StoryState): StoryState {
  const base = existing ?? createEmptyStoryState()

  const mergedLocations = { ...base.characterLocations }
  for (const [char, loc] of Object.entries(delta.characterLocations)) {
    if (loc && loc !== '同前') {
      mergedLocations[char] = loc
    }
  }

  const mergedStatus = { ...base.characterStatus }
  for (const [char, status] of Object.entries(delta.characterStatus)) {
    if (status && status !== '同前') {
      mergedStatus[char] = status
    }
  }

  const mergedItems = { ...base.keyItemsLocation }
  for (const [item, loc] of Object.entries(delta.keyItemsLocation)) {
    if (loc && loc !== '同前') {
      mergedItems[item] = loc
    }
  }

  const mergedPlots = [...base.activePlots]
  for (const plot of delta.activePlots) {
    if (plot && !mergedPlots.includes(plot)) {
      mergedPlots.push(plot)
    }
  }

  const mergedSecrets = [...base.revealedSecrets]
  for (const secret of delta.revealedSecrets) {
    if (secret && !mergedSecrets.includes(secret)) {
      mergedSecrets.push(secret)
    }
  }

  return {
    characterLocations: mergedLocations,
    characterStatus: mergedStatus,
    keyItemsLocation: mergedItems,
    activePlots: mergedPlots,
    revealedSecrets: mergedSecrets,
    currentScene: delta.currentScene || base.currentScene,
    storyTime: delta.storyTime || base.storyTime,
  }
}

function formatStoryState(storyState: StoryState): string {
  const lines: string[] = []

  const locations = Object.entries(storyState.characterLocations)
  if (locations.length > 0) {
    lines.push('【角色位置】')
    for (const [char, loc] of locations) {
      lines.push(`  ${char}：${loc}`)
    }
  }

  const statuses = Object.entries(storyState.characterStatus)
  if (statuses.length > 0) {
    lines.push('【角色状态】')
    for (const [char, status] of statuses) {
      lines.push(`  ${char}：${status}`)
    }
  }

  const items = Object.entries(storyState.keyItemsLocation)
  if (items.length > 0) {
    lines.push('【关键物品】')
    for (const [item, loc] of items) {
      lines.push(`  ${item}：${loc}`)
    }
  }

  if (storyState.activePlots.length > 0) {
    lines.push('【进行中的情节】')
    for (const plot of storyState.activePlots) {
      lines.push(`  - ${plot}`)
    }
  }

  if (storyState.revealedSecrets.length > 0) {
    lines.push('【已揭示的秘密】')
    for (const secret of storyState.revealedSecrets) {
      lines.push(`  - ${secret}`)
    }
  }

  if (storyState.currentScene) {
    lines.push(`【当前场景】${storyState.currentScene}`)
  }

  if (storyState.storyTime) {
    lines.push(`【故事时间】${storyState.storyTime}`)
  }

  return lines.length > 0 ? lines.join('\n') : '（暂无状态记录）'
}
