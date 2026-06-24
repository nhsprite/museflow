import type { ReducedGraphState } from './state.js'
import type { ChapterMeta } from '../types/chapter.js'
import type { Character } from '../types/character.js'
import {
  WorldbuilderAgent,
  CharacterAgent,
  HighLevelOutlineAgent,
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
import { validateFixedChapterContent } from '../utils/chapter-content-validation.js'
import { getStoryOutputDirWithTitle } from '../utils/paths.js'
import { toDisplayChapterNumber } from '../utils/chapter-display.js'
import { getCheckpointer } from './checkpointer.js'
import { isSemanticallyRelated } from '../utils/text-similarity.js'
import { expandOutlineForChapter } from '../core/outline-expander.js'
import { buildOutlineBridgeHint, buildNextChapterBoundaryHint } from '../utils/outline-boundary.js'
import { buildCharacterWhitelist } from '../utils/character-whitelist.js'

let worldbuilderAgent: WorldbuilderAgent | null = null
let characterAgent: CharacterAgent | null = null
let highLevelOutlineAgent: HighLevelOutlineAgent | null = null
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

function getHighLevelOutlineAgent(): HighLevelOutlineAgent {
  if (!highLevelOutlineAgent) highLevelOutlineAgent = new HighLevelOutlineAgent()
  return highLevelOutlineAgent
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
    throw new Error('世界观生成失败，请检查 AI 输出或重试')
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
  const worldContent = state.world?.content
  const agent = getHighLevelOutlineAgent()
  const agentState: AgentState = {
    idea: state.idea,
    genre: state.genre,
    totalChapters: state.totalChapters,
    title: state.story.title,
    ...(state.story.worldDirection ? { worldDirection: state.story.worldDirection } : {}),
    ...(worldContent ? { world: worldContent } : {}),
    characters: charactersToString(state.characters),
  }

  const maxRetries = 2
  let lastOutput: import('../agents/base.js').AgentOutput | null = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      console.warn(`[MuseFlow] 章节大纲解析失败，第 ${attempt}/${maxRetries} 次重试...`)
    }

    const output = await agent.run(agentState)
    lastOutput = output
    const chapters = (output.data as { chapters: ReducedGraphState['outline'] } | undefined)?.chapters ?? []

    if (chapters.length > 0) {
      if (attempt > 0) {
        console.log(`[MuseFlow] 章节大纲重试成功，共生成 ${chapters.length} 章`)
      }
      saveOutline(state.story.id, chapters)
      await writeOutlineContent(state.story.outputDir, state.story.title, chapters)
      await writeStoryBible(
        state.story.outputDir,
        state.story,
        worldContent || '',
        state.characters,
        chapters,
      )
      return { outline: chapters }
    }

    if (!output.success && output.content) {
      console.warn(`[MuseFlow] 第 ${attempt + 1} 次章节大纲原始输出（前 500 字符）：`)
      console.warn(output.content.slice(0, 500))
    }
  }

  console.error('[MuseFlow] 错误：章节大纲生成失败，已达到最大重试次数')
  if (lastOutput?.content) {
    console.error('[MuseFlow] 最后一次原始输出（前 1000 字符）：')
    console.error(lastOutput.content.slice(0, 1000))
  }
  throw new Error('[MuseFlow] 错误：章节大纲生成失败，请检查 AI 输出或重试')
}

export async function validate_outline(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  const outline = state.outline
  const issues: Array<import('../types/agent.js').Issue> = []

  for (const item of outline) {
    if (!item) continue
    const eventCount = item.description.split(/[。；]/).filter(s => s.trim().length > 5).length
    if (eventCount > 5) {
      issues.push({
        id: generateId(),
        type: 'outline_density',
        severity: 'warning',
        description: `第${item.number}章大纲包含 ${eventCount} 个情节点，信息密度过高，建议拆分为2章或简化`,
        location: `第${item.number}章：${item.title}`,
      })
    }
  }

  const foreshadowPattern = /伏笔|铺垫|暗示|预示|留下悬念|日后|将来|未来/g
  const callbackPattern = /回收|兑现|揭晓|揭示|真相大白|终于明白/g
  for (let i = 0; i < outline.length; i++) {
    const item = outline[i]
    if (!item) continue
    const hasForeshadow = foreshadowPattern.test(item.description)
    const hasCallback = callbackPattern.test(item.description)
    if (hasForeshadow && hasCallback) {
      issues.push({
        id: generateId(),
        type: 'outline_foreshadow',
        severity: 'error',
        description: `第${item.number}章大纲同时包含"埋下伏笔"和"回收伏笔"的描述，这会导致伏笔在同一章被展示`,
        location: `第${item.number}章：${item.title}`,
      })
    }
  }

  for (let i = 1; i < outline.length; i++) {
    const prev = outline[i - 1]
    const curr = outline[i]
    if (!prev || !curr) continue
    
    const timePattern = /第([一二三四五六七八九十百\d]+)[章节]/g
    const prevTimes = [...prev.description.matchAll(timePattern)].map(m => m[1])
    const currTimes = [...curr.description.matchAll(timePattern)].map(m => m[1])
    
    if (prevTimes.length > 0 && currTimes.length > 0) {
    }
  }

  if (issues.length > 0) {
    console.warn(`\n[MuseFlow] 大纲校验发现 ${issues.length} 个问题：`)
    for (const issue of issues) {
      const icon = issue.severity === 'error' ? '❌' : '⚠️'
      console.warn(`  ${icon} [${issue.type}] ${issue.description}`)
    }
    console.warn('')
  }

  return { pendingIssues: [...state.pendingIssues, ...issues] }
}

async function runPlanChapter(
  state: ReducedGraphState,
  outlineOverride?: string
): Promise<Partial<ReducedGraphState>> {
  const agent = getChapterPlannerAgent()
  const chapterIndex = state.currentChapterIndex
  const worldContent = state.world?.content

  const previousChapters = buildLayeredSummaries(state.chapterSummaries, chapterIndex)
  const timelineSnapshot = buildCharacterFactTimeline(state, chapterIndex)

  const outlineItem = state.outline[chapterIndex]
  const reconciledState = state.storyState && outlineItem?.description
    ? reconcileStoryState(state.storyState, outlineItem.description, state.characters)
    : state.storyState
  const storyStateStr = reconciledState ? formatStoryState(reconciledState) : ''

    const agentState: AgentState = {
      idea: state.idea,
      genre: state.genre,
      totalChapters: state.totalChapters,
      ...(worldContent ? { world: worldContent } : {}),
      characters: charactersToString(state.characters),
      charactersList: state.characters,
      outline: outlineOverride ?? formatChapterOutlineForAgent(state, chapterIndex),
      previousChapters,
      chapterIndex,
      chapterSummaries: state.chapterSummaries,
      timelineSnapshot,
      foreshadowStack: state.foreshadowStack,
      ...(storyStateStr ? { storyState: storyStateStr } : {}),
      ...(state.pendingIssues && state.pendingIssues.length > 0 ? { issues: state.pendingIssues } : {}),
      ...(state.verifiedConstraints && state.verifiedConstraints.length > 0 ? { verifiedConstraints: state.verifiedConstraints } : {}),
    }

  const output = await agent.run(agentState)

  if (!output.success || !output.data) {
    throw new Error(
      `第 ${chapterIndex + 1} 章规划失败：${output.error || '无法生成章节规划。请检查模型输出或重试。'}`
    )
  }

  const chapterPlan = output.data as import('../agents/chapter-planner.js').ChapterPlan

  return { chapterPlan }
}

export async function plan_chapter(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  return runPlanChapter(state)
}

export async function plan_chapter_with_override(
  state: ReducedGraphState,
  outlineOverride: string
): Promise<Partial<ReducedGraphState>> {
  return runPlanChapter(state, outlineOverride)
}

function formatChapterOutlineForAgent(state: ReducedGraphState, chapterIndex: number, extraHints: string[] = []): string {
  const outlineItem = state.outline[chapterIndex]
  if (!outlineItem) {
    return state.outline.map((o, i) => `第${toDisplayChapterNumber(i)}章：${o.title}`).join('\n')
  }
  const bridgeHint = buildOutlineBridgeHint(state.outline, chapterIndex)
  const nextChapterBoundaryHint = buildNextChapterBoundaryHint(state.outline, chapterIndex)
  return [`第${toDisplayChapterNumber(chapterIndex)}章：${outlineItem.title}`, outlineItem.description, bridgeHint, nextChapterBoundaryHint, ...extraHints]
    .filter(part => part.trim().length > 0)
    .join('\n')
}

/**
 * 为一致性检查 agent 构造大纲上下文。
 * 一致性检查只能看到当前章节及之前章节的完整内容，以及下一章标题作为边界提示。
 * 绝不能暴露后续章节的具体剧情，否则 agent 会把当前章节的正常推进误判为"提前剧透"。
 */
function buildConsistencyOutlineContext(state: ReducedGraphState, chapterIndex: number): string {
  const currentDisplay = chapterIndex + 1
  const lines: string[] = []

  for (let i = 0; i < state.outline.length; i++) {
    const item = state.outline[i]
    if (!item) continue
    const display = toDisplayChapterNumber(i)
    if (i <= chapterIndex) {
      lines.push(`第${display}章：${item.title}`)
      if (item.description) {
        lines.push(item.description)
      }
    } else if (i === chapterIndex + 1) {
      lines.push(`第${display}章：${item.title}（下一章标题，仅作边界提示）`)
    } else {
      lines.push(`第${display}章：[后续章节内容已隐藏]`)
    }
  }

  return lines.join('\n')
}

export async function draft_chapter(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  const agent = getChapterAgent()
  const chapterIndex = state.currentChapterIndex
  const outlineItem = state.outline[chapterIndex]
  const worldContent = state.world?.content

  const { chapterPlan, boundaryHints } = await expandOutlineForChapter(state, chapterIndex)
  state = { ...state, chapterPlan }

  const previousChapters = buildLayeredSummaries(state.chapterSummaries, chapterIndex)
  const timelineSnapshot = buildCharacterFactTimeline(state, chapterIndex)
  const keyEventsTimeline = buildKeyEventsTimeline(state, chapterIndex)

  const existingContent = state.rewriteApproved
    ? await readChapterContent(state.story.outputDir, chapterIndex + 1)
    : null

  const reconciledState = state.storyState && outlineItem?.description
    ? reconcileStoryState(state.storyState, outlineItem.description, state.characters)
    : state.storyState
  const storyStateStr = reconciledState ? formatStoryState(reconciledState) : ''

  const chapterTimeAnchor = state.chapterPlan?.chapterTimeAnchor ?? state.chapterTimeAnchor

  const agentState: AgentState = {
    idea: state.idea,
    genre: state.genre,
    totalChapters: state.totalChapters,
    ...(worldContent ? { world: worldContent } : {}),
    characters: charactersToString(state.characters),
    charactersList: state.characters,
    outline: formatChapterOutlineForAgent(state, chapterIndex, boundaryHints),
    previousChapters,
    chapterIndex,
    chapterSummaries: state.chapterSummaries,
    timelineSnapshot,
    keyEventsTimeline,
    foreshadowStack: state.foreshadowStack,
    storyState: storyStateStr,
    chapterTimeAnchor,
    ...(state.rewriteApproved ? { issues: state.pendingIssues } : {}),
    ...(existingContent ? { chapterContent: existingContent } : {}),
    ...(state.chapterPlan ? { chapterPlan: state.chapterPlan } : {}),
  }

  const output = await agent.run(agentState)

  if (!output.success && output.error) {
    throw new Error(
      `第 ${chapterIndex + 1} 章 AI 生成失败：${output.error}`
    )
  }

  let content = output.content ?? ''
  if (!content || content.trim().length === 0) {
    throw new Error(
      `第 ${chapterIndex + 1} 章内容为空，AI 未返回有效内容。请检查模型配置或重试。`
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

  // Only patch consistency/hallucination warnings or quality warnings with explicit locations.
  // Abstract quality/style warnings are not suitable for paragraph/sentence-level patching.
  const pendingIssues = state.pendingIssues
  const hasPatchableIssues = pendingIssues.some(issue => {
    if (issue.severity !== 'warning') return true
    if (issue.type === 'consistency' || issue.type === 'hallucination') return true
    if (issue.type === 'quality' && issue.location) {
      return /第\s*\d+\s*[段节]|段落\s*\d+|第\s*\d+\s*句/.test(issue.location)
    }
    return false
  })

  if (!hasPatchableIssues) {
    console.log('[MuseFlow] 当前警告不适合段落/句子级修复，跳过 fix agent')
    return { chapters: state.chapters }
  }

  const paragraphs = splitIntoParagraphs(existingContent)
  const affectedIndices = findAffectedParagraphs(paragraphs, pendingIssues)

  const previousChapters = buildLayeredSummaries(state.chapterSummaries, chapterIndex)
  const timelineSnapshot = buildCharacterFactTimeline(state, chapterIndex)
  const nextBoundaryHint = buildNextChapterBoundaryHint(state.outline, chapterIndex)

  if (affectedIndices.length === 0) {
    console.log('[MuseFlow] 未能定位到问题所在段落，将使用全文修复模式')
    return await runLegacyFix(agent, state, existingContent, chapterIndex, outlineItem, previousChapters, timelineSnapshot, nextBoundaryHint)
  }

  const hasErrors = pendingIssues.some(i => i.severity === 'error')
  // 对仅包含 warning 的主观质量/一致性问题，使用更宽松的阈值，避免为分散的
  // 风格建议触发昂贵的完整重写；对 error 级别问题保持严格阈值。
  const AFFECTED_PARAGRAPH_RATIO_THRESHOLD = hasErrors ? 0.4 : 0.65
  const AFFECTED_PARAGRAPH_ABSOLUTE_THRESHOLD = hasErrors ? 20 : 35
  const isConsistencyOrHallucination = pendingIssues.every(
    i => i.type === 'consistency' || i.type === 'hallucination'
  )
  const affectedRatio = paragraphs.length > 0 ? affectedIndices.length / paragraphs.length : 0
  if (
    !isConsistencyOrHallucination &&
    (affectedIndices.length > AFFECTED_PARAGRAPH_ABSOLUTE_THRESHOLD || affectedRatio > AFFECTED_PARAGRAPH_RATIO_THRESHOLD)
  ) {
    console.log(`[MuseFlow] 问题涉及 ${affectedIndices.length}/${paragraphs.length} 个段落（占比 ${Math.round(affectedRatio * 100)}%），超过修复阈值，转为完整重写`)
    return await runLegacyFix(agent, state, existingContent, chapterIndex, outlineItem, previousChapters, timelineSnapshot, nextBoundaryHint)
  }

  const sentenceFixes = buildSentenceFixes(paragraphs, affectedIndices, pendingIssues)

  if (sentenceFixes.length > 0 && sentenceFixes.length <= 5) {
    console.log(`[MuseFlow] 定位到 ${sentenceFixes.length} 个需修改的句子，使用句子级精准修复`)
    return await runSentenceFix(agent, state, existingContent, paragraphs, sentenceFixes, chapterIndex, outlineItem, previousChapters, timelineSnapshot, nextBoundaryHint)
  }

  console.log(`[MuseFlow] 定位到 ${affectedIndices.length} 个需修改的段落，使用段落级修复`)
  return await runParagraphFix(agent, state, existingContent, paragraphs, affectedIndices, chapterIndex, outlineItem, previousChapters, timelineSnapshot, nextBoundaryHint)
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
  timelineSnapshot: string,
  nextBoundaryHint: string
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

  const reconciledState = state.storyState && outlineItem?.description
    ? reconcileStoryState(state.storyState, outlineItem.description, state.characters)
    : state.storyState
  const storyStateStr = reconciledState ? formatStoryState(reconciledState) : ''

  const agentState: AgentState = {
    idea: state.idea,
    genre: state.genre,
    totalChapters: state.totalChapters,
    chapterIndex,
    issues: state.pendingIssues,
    chapterContent: existingContent,
    previousChapters,
    timelineSnapshot,
    ...(storyStateStr ? { storyState: storyStateStr } : {}),
    ...(nextBoundaryHint ? { nextChapterBoundary: nextBoundaryHint } : {}),
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
    if (!output.success && output.error) {
      throw new Error(`第 ${chapterIndex + 1} 章修复失败：${output.error}`)
    }
    content = output.content ?? ''
    if (!content || content.trim().length === 0) {
      throw new Error(`第 ${chapterIndex + 1} 章修复后内容为空，AI 未返回有效内容。请检查模型配置或重试。`)
    }
    const affectedIndices = Array.from(new Set(sentenceFixes.map(s => s.paragraphIndex)))
    content = applyParagraphDiffProtection(existingContent, content, affectedIndices)
  }

  content = deduplicateSentences(content)
  content = deduplicateParagraphBlocks(content)
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
  timelineSnapshot: string,
  nextBoundaryHint: string
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

  const reconciledState = state.storyState && outlineItem?.description
    ? reconcileStoryState(state.storyState, outlineItem.description, state.characters)
    : state.storyState
  const storyStateStr = reconciledState ? formatStoryState(reconciledState) : ''

  const agentState: AgentState = {
    idea: state.idea,
    genre: state.genre,
    totalChapters: state.totalChapters,
    chapterIndex,
    issues: state.pendingIssues,
    chapterContent: existingContent,
    previousChapters,
    timelineSnapshot,
    ...(storyStateStr ? { storyState: storyStateStr } : {}),
    ...(nextBoundaryHint ? { nextChapterBoundary: nextBoundaryHint } : {}),
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
    if (!output.success && output.error) {
      throw new Error(`第 ${chapterIndex + 1} 章修复失败：${output.error}`)
    }
    content = output.content ?? ''
    if (!content || content.trim().length === 0) {
      throw new Error(`第 ${chapterIndex + 1} 章修复后内容为空，AI 未返回有效内容。请检查模型配置或重试。`)
    }
    content = applyParagraphDiffProtection(existingContent, content, affectedIndices)
  }

  content = deduplicateSentences(content)
  content = deduplicateParagraphBlocks(content)
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

export async function runLegacyFix(
  agent: FixAgent,
  state: ReducedGraphState,
  existingContent: string,
  chapterIndex: number,
  outlineItem: { description?: string } | undefined,
  previousChapters: string,
  timelineSnapshot: string,
  nextBoundaryHint: string
): Promise<Partial<ReducedGraphState>> {
  const worldContent = state.world?.content
  const reconciledState = state.storyState && outlineItem?.description
    ? reconcileStoryState(state.storyState, outlineItem.description, state.characters)
    : state.storyState
  const storyStateStr = reconciledState ? formatStoryState(reconciledState) : ''

  const agentState: AgentState = {
    idea: state.idea,
    genre: state.genre,
    totalChapters: state.totalChapters,
    chapterIndex,
    issues: state.pendingIssues,
    chapterContent: existingContent,
    previousChapters,
    timelineSnapshot,
    ...(storyStateStr ? { storyState: storyStateStr } : {}),
    ...(worldContent ? { world: worldContent } : {}),
    ...(nextBoundaryHint ? { nextChapterBoundary: nextBoundaryHint } : {}),
    characters: charactersToString(state.characters),
    outline: state.outline.map((o, i) => `第${i + 1}章：${o.title}\n${o.description}`).join('\n\n'),
  }

  const output = await agent.run(agentState)

  if (!output.success && output.error) {
    throw new Error(`第 ${chapterIndex + 1} 章重写失败：${output.error}`)
  }

  let content = output.content ?? ''
  if (!content || content.trim().length === 0) {
    throw new Error(`第 ${chapterIndex + 1} 章重写后内容为空，AI 未返回有效内容。请检查模型配置或重试。`)
  }

  const genre = getGenreSkill(state.genre)
  const min = genre?.chapterWordCountMin ?? 1500
  const max = genre?.chapterWordCountMax ?? 8000

  const validation = validateFixedChapterContent(content, {
    chapterIndex,
    minWordCount: min,
    maxWordCount: max,
  })

  if (!validation.valid) {
    throw new Error(`第 ${chapterIndex + 1} 章重写后内容校验失败：${validation.error}`)
  }

  content = validation.content ?? content
  content = deduplicateSentences(content)
  content = deduplicateParagraphBlocks(content)
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
  return unique.slice(0, 35)
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

export function deduplicateParagraphBlocks(text: string): string {
  const paragraphs = splitIntoParagraphs(text)
  if (paragraphs.length < 2) return text

  const BLOCK_MIN_CHARS = 30
  const seenBlocks = new Set<string>()
  const result: string[] = []
  let removedCount = 0

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim()
    if (trimmed.length < BLOCK_MIN_CHARS) {
      result.push(paragraph)
      continue
    }

    const normalized = trimmed.replace(/\s+/g, '')
    if (seenBlocks.has(normalized)) {
      removedCount++
      continue
    }
    seenBlocks.add(normalized)
    result.push(paragraph)
  }

  if (removedCount > 0) {
    console.log(`[MuseFlow] 自动清理 ${removedCount} 个重复段落`)
  }
  return result.join('\n\n')
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

  if (chapterIndex > 0) {
    const prevContent = await readChapterContent(state.story.outputDir, chapterIndex)
    if (prevContent !== null) {
      const prevWordCount = countChineseWords(prevContent)
      const shorter = Math.min(wordCount, prevWordCount)
      const longer = Math.max(wordCount, prevWordCount)
      if (longer > 0 && shorter / longer < 0.5) {
        newIssues.push({
          id: generateId(),
          type: 'word_count' as const,
          severity: 'warning',
          description: `第 ${chapterIndex + 1} 章字数 ${wordCount} 与上一章 ${prevWordCount} 差异超过50%，请检查章节内容是否完整`,
        })
      }
    }
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

  // 清理"自埋自收"伏笔：过滤掉在当前章节或之后章节创建的伏笔（这些很可能是错误标记的）
  const currentChapter = chapterIndex + 1
  const cleanedForeshadowStack = state.foreshadowStack.filter(f => {
    const createdAt = f.createdAtChapter ?? 0
    // 移除在当前章节或之后章节创建的伏笔
    if (createdAt >= currentChapter) {
      if (content && createdAt === currentChapter) {
        const isSelfReferential = isSemanticallyRelated(f.text, content, 0.5)
        if (isSelfReferential) {
          console.log(`[MuseFlow] 伏笔清理: 移除自埋自收伏笔 "${f.text.substring(0, 30)}..."`)
        } else {
          console.log(`[MuseFlow] 伏笔清理: 移除当前章节创建的伏笔 "${f.text.substring(0, 30)}..."`)
        }
      } else {
        console.log(`[MuseFlow] 伏笔清理: 移除未来章节(${createdAt})创建的伏笔 "${f.text.substring(0, 30)}..."`)
      }
      return false
    }
    return true
  })

  const agentState: AgentState = {
    idea: state.idea,
    genre: state.genre,
    totalChapters: state.totalChapters,
    ...(worldContent ? { world: worldContent } : {}),
    characters: charactersToString(state.characters),
    outline: state.outline.map((o, i) => `第${i + 1}章：${o.title}\n${o.description}`).join('\n\n'),
    ...(content ? { chapterContent: content } : {}),
    foreshadowStack: cleanedForeshadowStack,
  }

  const output = await agent.run(agentState)
  let foreshadowStack = agent.processOutput(output, chapterIndex, cleanedForeshadowStack, content || undefined)

  const finalStack = foreshadowStack.filter(f => {
    if (f.createdAtChapter === currentChapter && f.text.length < 40 && !f.fulfilledChapter) {
      console.log(`[MuseFlow] 伏笔清理: 移除agent误判的短文本伏笔 "${f.text.substring(0, 30)}..."`)
      return false
    }
    return true
  })

  return { foreshadowStack: finalStack }
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

  const storyStateStr = state.storyState ? formatStoryState(state.storyState) : ''

  const supersededFacts = state.storyState?.supersededFacts ?? []
  const supersededFactsStr = supersededFacts.length > 0
    ? supersededFacts.map(f => `- [${f.subject}] ${f.oldFact}（原因：${f.reason}）`).join('\n')
    : '（无）'

  const chapterTimeAnchor = state.chapterPlan?.chapterTimeAnchor ?? state.chapterTimeAnchor

    const agentState: AgentState = {
      idea: state.idea,
      genre: state.genre,
      totalChapters: state.totalChapters,
      ...(state.world?.content ? { world: state.world.content } : {}),
      characters: charactersToString(state.characters),
      charactersList: state.characters,
      outline: buildConsistencyOutlineContext(state, chapterIndex),
      ...(content ? { chapterContent: content } : {}),
      chapterSummaries: state.chapterSummaries,
      chapterIndex,
      timelineSnapshot,
      foreshadowStack: state.foreshadowStack,
      storyState: storyStateStr,
      chapterPlan: state.chapterPlan ?? undefined,
      chapterTimeAnchor,
      supersededFacts: supersededFactsStr,
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
    title: state.story.title,
    characters: charactersToString(state.characters),
    outline: formatChapterOutlineForAgent(state, chapterIndex),
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
        charactersList: state.characters,
        ...(state.outline[chapterIndex]?.title ? { chapterTitle: state.outline[chapterIndex].title } : {}),
        chapterIndex,
      }

      const MAX_SUMMARY_RETRIES = 2
      let summarySuccess = false
      for (let attempt = 0; attempt <= MAX_SUMMARY_RETRIES; attempt++) {
        if (attempt > 0) {
          console.log(`[MuseFlow] 第 ${chapterIndex + 1} 章摘要生成失败，第 ${attempt}/${MAX_SUMMARY_RETRIES} 次重试...`)
        }
        try {
          const summaryOutput = await summaryAgent.run(summaryState)
          if (!summaryOutput.success) {
            console.warn(`[MuseFlow] 第 ${chapterIndex + 1} 章摘要 agent 返回失败: ${summaryOutput.error || '未知错误'}`)
            continue
          }
          const processed = processSummaryOutput(summaryOutput, chapterIndex, state.characters)
          if (!processed || !processed.summary) {
            console.warn(`[MuseFlow] 第 ${chapterIndex + 1} 章摘要处理结果为空`)
            continue
          }
          summary = processed.summary
          chapter.summary = summary
          summarySuccess = true

          if (processed.storyState) {
            const existing = getStoryState(state.story.id)
            updatedStoryState = mergeStoryState(existing, processed.storyState)
            saveStoryState(state.story.id, updatedStoryState)
            console.log(`[MuseFlow] 第 ${chapterIndex + 1} 章状态已更新：${updatedStoryState.currentScene || '无场景'} | ${updatedStoryState.storyTime || '无时间标记'}`)
          }
          break
        } catch (err) {
          console.warn(`[MuseFlow] 生成第 ${chapterIndex + 1} 章摘要失败 (attempt ${attempt + 1}/${MAX_SUMMARY_RETRIES + 1}):`, err)
        }
      }

      if (!summarySuccess) {
        console.warn(`[MuseFlow] 第 ${chapterIndex + 1} 章摘要生成最终失败，将在无摘要状态下标记本章完成。后续一致性检查可能受影响。`)
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
    return { autoFixAttempts: 0 }
  }

  if (warnings.length === 0) {
    return { autoFixAttempts: 0 }
  }

  const attempts = (state.autoFixAttempts || 0)

  if (attempts >= 3) {
    console.warn(`\x1b[93m[MuseFlow] 自动修复已达最大尝试次数 (${attempts})，停止修复，保留 ${warnings.length} 个警告待处理\x1b[0m`)
    return { autoFixAttempts: attempts, pendingIssues: state.pendingIssues }
  }

  // Only patch consistency/hallucination warnings or quality warnings with explicit locations.
  const patchableWarnings = warnings.filter(issue => {
    if (issue.type === 'consistency' || issue.type === 'hallucination') return true
    if (issue.type === 'quality' && issue.location) {
      return /第\s*\d+\s*[段节]|段落\s*\d+|第\s*\d+\s*句/.test(issue.location)
    }
    return false
  })

  if (patchableWarnings.length === 0) {
    console.log('[MuseFlow] 当前警告不适合自动修复，保留至下一轮重写')
    return { autoFixAttempts: attempts, pendingIssues: state.pendingIssues }
  }

  console.warn(`\x1b[93m🔧 [MuseFlow] Auto-fixing ${patchableWarnings.length} warning(s) (attempt ${attempts + 1}/3):\x1b[0m`)
  for (const warning of patchableWarnings) {
    console.warn(`   \x1b[33m⚠️  [${warning.type}]\x1b[0m ${warning.description}`)
  }

  const fixState: ReducedGraphState = { ...state, pendingIssues: patchableWarnings }

  try {
    const fixResult = await fix_chapter(fixState)
    console.log(`\x1b[92m✔ [MuseFlow] Auto-fixed ${patchableWarnings.length} warning(s) (attempt ${attempts + 1}/3)\x1b[0m`)

    return {
      ...fixResult,
      pendingIssues: [],
      autoFixAttempts: attempts + 1,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`\x1b[93m[MuseFlow] 自动修复失败：${message}\x1b[0m`)
    return {
      autoFixAttempts: attempts + 1,
      pendingIssues: state.pendingIssues,
    }
  }
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

  const mergedItemStates = { ...base.keyItemsState }
  for (const [item, state] of Object.entries(delta.keyItemsState ?? {})) {
    if (state && state !== '同前') {
      mergedItemStates[item] = state
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

  const mergedSuperseded = [...(base.supersededFacts ?? [])]
  for (const fact of delta.supersededFacts ?? []) {
    const isDuplicate = mergedSuperseded.some(
      existing => existing.subject === fact.subject && existing.oldFact === fact.oldFact
    )
    if (!isDuplicate) {
      mergedSuperseded.push(fact)
    }
  }

  const mergedPendingTasks = mergePendingTasks(base.pendingTasks, delta.pendingTasks)

  const result: StoryState = {
    characterLocations: mergedLocations,
    characterStatus: mergedStatus,
    keyItemsLocation: mergedItems,
    keyItemsState: mergedItemStates,
    activePlots: mergedPlots,
    revealedSecrets: mergedSecrets,
    pendingTasks: mergedPendingTasks,
    currentScene: delta.currentScene || base.currentScene,
    storyTime: delta.storyTime || base.storyTime,
  }

  if (mergedSuperseded.length > 0) {
    result.supersededFacts = mergedSuperseded
  }

  return result
}

function mergePendingTasks(
  existing: import('../types/story-state.js').PendingTask[],
  delta: import('../types/story-state.js').PendingTask[]
): import('../types/story-state.js').PendingTask[] {
  const safeDelta = delta ?? []
  const safeExisting = existing ?? []
  if (safeDelta.length === 0) return safeExisting
  const result = [...safeExisting]
  for (const task of safeDelta) {
    const index = result.findIndex(t => t.id === task.id || (t.assignee === task.assignee && t.description === task.description))
    if (index >= 0) {
      result[index] = { ...result[index], ...task }
    } else {
      result.push(task)
    }
  }
  return result
}

function buildCharacterAliasMap(characters: Array<{ name: string }>): Map<string, string> {
  const aliasToFull = new Map<string, string>()
  const fullNames = characters.map(c => c.name).filter(Boolean).sort((a, b) => b.length - a.length)

  for (const fullName of fullNames) {
    aliasToFull.set(fullName, fullName)

    if (fullName.length >= 3) {
      const lastTwo = fullName.slice(-2)
      if (!aliasToFull.has(lastTwo)) {
        const isAmbiguous = fullNames.some(other => other !== fullName && other.includes(lastTwo))
        if (!isAmbiguous) {
          aliasToFull.set(lastTwo, fullName)
        }
      }
    }

    if (fullName.length >= 4) {
      const lastThree = fullName.slice(-3)
      if (!aliasToFull.has(lastThree)) {
        const isAmbiguous = fullNames.some(other => other !== fullName && other.includes(lastThree))
        if (!isAmbiguous) {
          aliasToFull.set(lastThree, fullName)
        }
      }
    }
  }

  return aliasToFull
}

function reconcileStoryState(
  storyState: StoryState,
  outline: string,
  characters: Array<{ name: string }> = []
): StoryState {
  const reconciled: StoryState = {
    characterLocations: {},
    characterStatus: {},
    keyItemsLocation: { ...storyState.keyItemsLocation },
    keyItemsState: { ...storyState.keyItemsState },
    activePlots: [...storyState.activePlots],
    revealedSecrets: [],
    pendingTasks: [...(storyState.pendingTasks ?? [])],
    currentScene: storyState.currentScene,
    storyTime: storyState.storyTime,
    ...(storyState.supersededFacts ? { supersededFacts: storyState.supersededFacts } : {}),
  }

  const aliasMap = buildCharacterAliasMap(characters)

  const statusMap = new Map<string, string>()
  for (const [char, status] of Object.entries(storyState.characterStatus)) {
    const normalized = aliasMap.get(char) || char
    statusMap.set(normalized, status)
  }
  reconciled.characterStatus = Object.fromEntries(statusMap)

  const outlineWords = new Set(
    outline.split(/\s+|，|。|！|？|、|；|\n/).filter(w => w.length >= 2)
  )

  const locMap = new Map<string, string>()
  for (const [char, loc] of Object.entries(storyState.characterLocations)) {
    const normalized = aliasMap.get(char) || char
    locMap.set(normalized, loc)
  }
  reconciled.characterLocations = Object.fromEntries(locMap)

  for (const secret of storyState.revealedSecrets) {
    const secretWords = secret.split(/\s+|，|。|！|？|、|；|\n/).filter(w => w.length >= 2)
    const overlap = secretWords.filter(w => outlineWords.has(w))
    const overlapRatio = secretWords.length > 0 ? overlap.length / secretWords.length : 0

    if (overlapRatio >= 0.3) {
      console.log(`[MuseFlow] Reconciling: skipping outdated secret with ${Math.round(overlapRatio * 100)}% outline overlap: "${secret.substring(0, 50)}..."`)
      continue
    }

    reconciled.revealedSecrets.push(secret)
  }

  const whitelist = buildCharacterWhitelist(characters as Character[])

  const filterByWhitelist = (record: Record<string, string>): Record<string, string> => {
    const result: Record<string, string> = {}
    for (const [k, v] of Object.entries(record)) {
      if (whitelist.isOfficial(k)) {
        result[k] = v
      } else {
        console.warn(`[MuseFlow] reconcileStoryState: removing invented character "${k}"`)
      }
    }
    return result
  }

  reconciled.characterLocations = filterByWhitelist(reconciled.characterLocations)
  reconciled.characterStatus = filterByWhitelist(reconciled.characterStatus)

  const inventedNames = Object.keys(storyState.characterLocations ?? {})
    .concat(Object.keys(storyState.characterStatus ?? {}))
    .filter(name => !whitelist.isOfficial(name))

  const isClean = (text: string): boolean => !inventedNames.some(name => text.includes(name))
  reconciled.activePlots = reconciled.activePlots.filter(isClean)
  reconciled.revealedSecrets = reconciled.revealedSecrets.filter(isClean)

  return reconciled
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

  const itemStates = Object.entries(storyState.keyItemsState ?? {})
  if (itemStates.length > 0) {
    lines.push('【关键物品状态】')
    for (const [item, state] of itemStates) {
      lines.push(`  ${item}：${state}`)
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

  if ((storyState.pendingTasks?.length ?? 0) > 0) {
    lines.push('【待办差事】')
    for (const task of storyState.pendingTasks) {
      const due = task.dueTime ?? (task.dueChapter ? `第${task.dueChapter}章前` : '未指定')
      const statusLabel = task.status === 'done' ? '已完成' : task.status === 'postponed' ? '已推迟' : task.status === 'superseded' ? '已覆盖' : '待执行'
      lines.push(`  - [${statusLabel}] ${task.assignee}：${task.description}（截止：${due}）`)
    }
  }

  if (storyState.supersededFacts && storyState.supersededFacts.length > 0) {
    lines.push('【已被覆盖的旧事实】')
    for (const fact of storyState.supersededFacts) {
      lines.push(`  - [${fact.subject}] ${fact.oldFact}（原因：${fact.reason}）`)
    }
  }

  if (storyState.currentScene) {
    lines.push(`【当前场景】${storyState.currentScene}`)
  }

  if (storyState.storyTime) {
    lines.push(`【上一章结束时间】${storyState.storyTime}`)
  }

  return lines.length > 0 ? lines.join('\n') : '（暂无状态记录）'
}
