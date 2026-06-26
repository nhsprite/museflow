import { logger } from '../../utils/logger.js'
import type { ReducedGraphState } from '../state.js'
import type { ChapterMeta } from '../../types/chapter.js'
import type { AgentState } from '../../agents/base.js'
import { getChapterAgent } from '../agent-factory.js'
import { generateId } from '../../utils/id.js'
import { writeChapterContent, readChapterContent } from '../../storage/filesystem/writer.js'
import { expandOutlineForChapter } from '../../core/outline-expander.js'
import { buildLayeredSummaries } from '../../utils/summary-compressor.js'
import { buildCharacterFactTimeline, buildKeyEventsTimeline, formatStoryState } from '../utils/story-state.js'
import { buildEffectiveCharactersList, charactersToString } from '../utils/characters.js'
import { formatChapterOutlineForAgent } from './planning.js'
import { toDisplayChapterNumber } from '../../utils/chapter-display.js'
import { prepareStoryStateForChapter } from '../utils/chapter-state-prep.js'

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

  const { reconciledState, stateConflicts } = prepareStoryStateForChapter(state, chapterIndex)
  const storyStateStr = formatStoryState(reconciledState)

  const chapterTimeAnchor = state.chapterPlan?.chapterTimeAnchor ?? state.chapterTimeAnchor

  const { merged: effectiveCharacters, outline: outlineCharacters, established: establishedCharacters } = buildEffectiveCharactersList(state, chapterIndex)

  const agentState: AgentState = {
    idea: state.idea,
    genre: state.genre,
    totalChapters: state.totalChapters,
    ...(worldContent ? { world: worldContent } : {}),
    characters: charactersToString(state.characters),
    charactersList: effectiveCharacters,
    outlineCharacters,
    establishedCharacters,
    outline: formatChapterOutlineForAgent(state, chapterIndex, boundaryHints),
    previousChapters,
    chapterIndex,
    chapterSummaries: state.chapterSummaries,
    timelineSnapshot,
    keyEventsTimeline,
    foreshadowStack: state.foreshadowStack,
    storyState: storyStateStr,
    ...(stateConflicts ? { stateConflicts } : {}),
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
    logger.warn(`[MuseFlow] 第 ${chapterIndex + 1} 章未输出预写检查表，可能遗漏大纲要求`)
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
