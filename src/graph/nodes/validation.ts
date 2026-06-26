import type { ReducedGraphState } from '../state.js'
import type { AgentState } from '../../agents/base.js'
import {
  getQualityAgent,
  getForeshadowingAgent,
  getHallucinationAgent,
  getConsistencyAgent,
  getOutlineComplianceAgent,
} from '../agent-factory.js'
import { generateId } from '../../utils/id.js'
import { readChapterContent } from '../../storage/filesystem/writer.js'
import { getGenreSkill } from '../../genres/registry.js'
import { isSemanticallyRelated } from '../../utils/text-similarity.js'
import { buildCharacterFactTimeline, formatStoryState } from '../utils/story-state.js'
import { buildEffectiveCharactersList, charactersToString } from '../utils/characters.js'
import { formatChapterOutlineForAgent, buildConsistencyOutlineContext } from './planning.js'
import { countChineseWords } from '../utils/text-patching.js'

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

  const updatedChapter = {
    ...chapter,
    updatedAt: Date.now(),
  }

  const newChapters = [...state.chapters]
  newChapters[chapterIndex] = updatedChapter

  return issues.length > 0 ? { pendingIssues: [...state.pendingIssues, ...issues] } : {}
}

export async function detect_foreshadowing(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  const agent = getForeshadowingAgent()
  const chapterIndex = state.currentChapterIndex
  const chapter = state.chapters[chapterIndex]

  if (!chapter) return {}

  const content = await readChapterContent(state.story.outputDir, chapterIndex + 1)
  const worldContent = state.world?.content

  const currentChapter = chapterIndex + 1
  const cleanedForeshadowStack = state.foreshadowStack.filter(f => {
    const createdAt = f.createdAtChapter ?? 0
    if (createdAt > currentChapter) return false
    if (createdAt === currentChapter && content) {
      const isSelfReferential = isSemanticallyRelated(f.text, content, 0.5)
      if (isSelfReferential) {
        console.log(`[MuseFlow] 伏笔清理: 移除自埋自收伏笔 "${f.text.substring(0, 30)}..."`)
        return false
      }
    }
    return true
  })

  const agentState: AgentState = {
    idea: state.idea,
    genre: state.genre,
    totalChapters: state.totalChapters,
    ...(worldContent ? { world: worldContent } : {}),
    characters: charactersToString(state.characters),
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
    outline: state.outline.map((o, i) => `第${i + 1}章：${o.title}\n${o.description}`).join('\n\n'),
    ...(content ? { chapterContent: content } : {}),
    chapterSummaries: state.chapterSummaries,
    foreshadowStack: state.foreshadowStack,
  }

  const output = await agent.run(agentState)
  const issues = agent.processOutput(output)

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

  const { merged: effectiveCharacters, outline: outlineCharacters, established: establishedCharacters } = buildEffectiveCharactersList(state, chapterIndex)

  const agentState: AgentState = {
    idea: state.idea,
    genre: state.genre,
    totalChapters: state.totalChapters,
    ...(state.world?.content ? { world: state.world.content } : {}),
    characters: charactersToString(state.characters),
    charactersList: effectiveCharacters,
    outlineCharacters,
    establishedCharacters,
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
