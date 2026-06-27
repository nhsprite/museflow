import { logger } from '../../utils/logger.js'
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
import { countChineseWords } from '../../utils/text.js'
import type { Issue } from '../../types/agent.js'
import type { CanonicalFact } from '../../types/story-state.js'

/**
 * 保守过滤：如果某个 consistency issue 的描述直接否定了 canonicalFact 中记录的事实，
 * 则视为校验器自身违背 canonical_facts_authority 规则，予以丢弃。
 * 该函数只处理明显矛盾，避免误伤合理的质疑。
 */
export function filterIssuesAgainstCanonicalFacts(issues: Issue[], canonicalFacts: CanonicalFact[]): Issue[] {
  if (canonicalFacts.length === 0) return issues

  const negationMarkers = /不应|不应该|不可能|并非|不是|不在|没有|错误|矛盾|冲突/g

  return issues.filter(issue => {
    if (issue.type !== 'consistency') return true
    const text = `${issue.description ?? ''} ${issue.suggestion ?? ''}`
    if (!negationMarkers.test(text)) return true

    for (const fact of canonicalFacts) {
      const subject = fact.subject?.trim() ?? ''
      const value = fact.value?.trim() ?? ''
      if (subject.length < 2 || value.length < 5) continue

      // 如果 issue 连事实主体都没提到，不可能是在否定该事实。
      if (!text.includes(subject)) continue

      // 提取 value 中除 subject 之外的核心断言（如"在实验室A"）。
      // 如果 issue 文本包含该核心断言，同时又包含否定词，
      // 则认为 issue 在直接否定该 canonicalFact。
      const coreAssertion = value.replaceAll(subject, '').trim()
      if (coreAssertion.length >= 2 && text.includes(coreAssertion)) {
        logger.warn(
          `[MuseFlow] consistency issue 与 canonicalFact 直接矛盾，已过滤: ${issue.description?.slice(0, 80)}... (fact: ${fact.subject}/${fact.attribute})`
        )
        return false
      }

      // 兜底：如果 issue 文本完整包含权威事实 value，也视为直接矛盾。
      if (text.includes(value)) {
        logger.warn(
          `[MuseFlow] consistency issue 与 canonicalFact 直接矛盾，已过滤: ${issue.description?.slice(0, 80)}... (fact: ${fact.subject}/${fact.attribute})`
        )
        return false
      }
    }
    return true
  })
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
        logger.info(`[MuseFlow] 伏笔清理: 移除自埋自收伏笔 "${f.text.substring(0, 30)}..."`)
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
      logger.info(`[MuseFlow] 伏笔清理: 移除agent误判的短文本伏笔 "${f.text.substring(0, 30)}..."`)
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
  const rawIssues = agent.processOutput(output)
  const issues = filterIssuesAgainstCanonicalFacts(rawIssues, state.storyState?.canonicalFacts ?? [])

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

export async function validate_chapter_comprehensive(
  state: ReducedGraphState
): Promise<Partial<ReducedGraphState>> {
  // 将字数、质量、伏笔、幻觉、一致性、大纲合规 6 个 agent 的校验串行聚合为单个图节点，
  // 避免每个 agent 占用一个 LangGraph 步骤，从而防止重写循环时 recursionLimit 被快速耗尽。
  let workingState: ReducedGraphState = { ...state }

  function mergePendingIssues(updates: Partial<ReducedGraphState>): void {
    if (updates.pendingIssues) {
      workingState = {
        ...workingState,
        pendingIssues: [...workingState.pendingIssues, ...updates.pendingIssues],
      }
    }
  }

  const wordCountUpdates = await validate_chapter(workingState)
  mergePendingIssues(wordCountUpdates)

  const qualityUpdates = await quality_pass(workingState)
  mergePendingIssues(qualityUpdates)

  const foreshadowUpdates = await detect_foreshadowing(workingState)
  if (foreshadowUpdates.foreshadowStack) {
    workingState = {
      ...workingState,
      foreshadowStack: foreshadowUpdates.foreshadowStack,
    }
  }

  const hallucinationUpdates = await detect_hallucination(workingState)
  mergePendingIssues(hallucinationUpdates)

  const consistencyUpdates = await detect_consistency(workingState)
  mergePendingIssues(consistencyUpdates)

  const outlineComplianceUpdates = await verify_outline_compliance(workingState)
  mergePendingIssues(outlineComplianceUpdates)
  if (outlineComplianceUpdates.rewriteApproved !== undefined) {
    workingState = {
      ...workingState,
      rewriteApproved: outlineComplianceUpdates.rewriteApproved,
    }
  }

  const result: Partial<ReducedGraphState> = {}

  if (workingState.pendingIssues.length > 0) {
    result.pendingIssues = workingState.pendingIssues
  }

  if (workingState.foreshadowStack !== state.foreshadowStack) {
    result.foreshadowStack = workingState.foreshadowStack
  }

  if (workingState.rewriteApproved !== state.rewriteApproved) {
    result.rewriteApproved = workingState.rewriteApproved
  }

  return result
}

