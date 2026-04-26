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
  OutlineComplianceAgent,
  FixAgent,
} from '../agents/index.js'
import { generateId } from '../utils/id.js'
import type { AgentState } from '../agents/base.js'
import { writeChapterContent, readChapterContent, writeOutlineContent, writeStoryBible } from '../storage/filesystem/writer.js'
import { saveOutline } from '../storage/database/dao/chapter.js'
import { saveCharacters } from '../storage/database/dao/character.js'
import { saveWorld } from '../storage/database/dao/world.js'
import { appendTimelineSnapshot, getLatestSnapshot, saveForeshadowStack } from '../storage/database/dao/timeline.js'
import { updateStoryTitle, renameStoryOutputDir } from '../storage/database/dao/story.js'
import { getGenreSkill } from '../genres/registry.js'
import { getStoryOutputDirWithTitle } from '../utils/paths.js'
import { toDisplayChapterNumber } from '../utils/chapter-display.js'
import { getCheckpointer } from './checkpointer.js'

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

  const output = await agent.run(agentState)
  const characters = agent.processOutput(output, state.story.id)

  if (characters.length === 0) {
    throw new Error('[MuseFlow] 错误：角色生成失败，请检查 AI 输出或重试')
  }

  saveCharacters(state.story.id, characters)

  return { characters }
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

  const latestSnapshot = getLatestSnapshot(state.story.id)
  const timelineSnapshot = latestSnapshot?.stateSummary ?? null

  // Read current chapter content when rewriting, so the agent can see what needs to be fixed
  const existingContent = state.rewriteApproved
    ? await readChapterContent(state.story.outputDir, chapterIndex + 1)
    : null

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
    // Pass issues and existing content to agent when rewriting so it knows what to fix
    ...(state.rewriteApproved ? { issues: state.pendingIssues } : {}),
    ...(existingContent ? { chapterContent: existingContent } : {}),
  }

  const output = await agent.run(agentState)

  const content = output.content ?? ''
  if (!content || content.trim().length === 0) {
    throw new Error(
      `第 ${chapterIndex + 1} 章内容为空，AI 生成失败。请重试。`
    )
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

  if (affectedIndices.length === 0) {
    console.log('[MuseFlow] 未能定位到问题所在段落，将使用全文修复模式')
    return await runLegacyFix(agent, state, existingContent, chapterIndex, outlineItem)
  }

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
  outlineItem: { description?: string } | undefined
): Promise<Partial<ReducedGraphState>> {
  const agentState: AgentState = {
    idea: state.idea,
    genre: state.genre,
    totalChapters: state.totalChapters,
    chapterIndex,
    issues: state.pendingIssues,
    chapterContent: existingContent,
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
          keywords.push(sequence.slice(i, i + len))
        }
      }
    }
  }

  return [...new Set(keywords)].filter(k => k.length >= 2)
}

export function findAffectedParagraphs(paragraphs: string[], issues: Array<{ description: string; location?: string }>): number[] {
  const affected = new Set<number>()

  for (const issue of issues) {
    const keywords = extractIssueKeywords(issue)
    for (let i = 0; i < paragraphs.length; i++) {
      const paragraph = paragraphs[i]
      if (paragraph && keywords.some(kw => paragraph.includes(kw))) {
        affected.add(i)
      }
    }
  }

  return Array.from(affected).sort((a, b) => a - b)
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
  console.log(`[MuseFlow] 步骤 1/7: 检查字数...`)
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

  return {}
}

export async function quality_pass(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  const agent = getQualityAgent()
  const chapterIndex = state.currentChapterIndex
  const chapter = state.chapters[chapterIndex]

  console.log(`[MuseFlow] 步骤 2/7: 质量检查...`)
  if (!chapter) return {}

  const content = await readChapterContent(state.story.outputDir, chapterIndex + 1)
  const agentState: AgentState = {
    idea: state.idea,
    genre: state.genre,
    totalChapters: state.totalChapters,
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

  console.log(`[MuseFlow] 步骤 3/7: 检测伏笔...`)
  if (!chapter) return {}

  const content = await readChapterContent(state.story.outputDir, chapterIndex + 1)
  const agentState: AgentState = {
    idea: state.idea,
    genre: state.genre,
    totalChapters: state.totalChapters,
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

  console.log(`[MuseFlow] 步骤 4/7: 检测幻觉...`)
  if (!chapter) return {}

  const worldContent = state.world?.content
  const content = await readChapterContent(state.story.outputDir, chapterIndex + 1)
  const agentState: AgentState = {
    idea: state.idea,
    genre: state.genre,
    totalChapters: state.totalChapters,
    ...(worldContent ? { world: worldContent } : {}),
    characters: charactersToString(state.characters),
    ...(content ? { chapterContent: content } : {}),
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

  console.log(`[MuseFlow] 步骤 5/7: 检测一致性...`)
  if (!chapter) return {}

  const content = await readChapterContent(state.story.outputDir, chapterIndex + 1)
  const agentState: AgentState = {
    idea: state.idea,
    genre: state.genre,
    totalChapters: state.totalChapters,
    ...(content ? { chapterContent: content } : {}),
    chapterSummaries: state.chapterSummaries,
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

  console.log(`[MuseFlow] 步骤 6/7: 校验大纲合规性...`)
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

  if (chapter) {
    const summary = chapter.summary || ''
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

  const nextIndex = state.currentChapterIndex + 1
  const isLastChapter = nextIndex >= state.totalChapters

  if (!isLastChapter) {
    console.log(`\n[MuseFlow] 第 ${chapterIndex + 1}/${state.totalChapters} 章处理完成`)
  }

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
  }
}

export async function finalize_story(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  console.log('\n[MuseFlow] 全部章节撰写完成！')
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

  console.log(`[MuseFlow] 步骤 7/7: 发现 ${warnings.length} 个质量问题`)

  return {}
}
