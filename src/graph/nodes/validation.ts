import { logger } from '../../utils/logger.js'
import type { ReducedGraphState } from '../state.js'
import type { ForeshadowingAgentInput, ConsistencyAgentInput } from '../../agents/types.js'
import {
  getForeshadowingAgent,
  getConsistencyAgent,
} from '../agent-factory.js'
import { generateId } from '../../utils/id.js'
import { readChapterContent } from '../../storage/filesystem/writer.js'
import { getGenreSkill } from '../../genres/registry.js'
import { isSemanticallyRelated } from '../../utils/text-similarity.js'
import { buildConsistencyOutlineContext } from './planning.js'
import { countChineseWords } from '../../utils/text.js'
import { DEFAULT_CHAPTER_WORD_COUNT_MIN, DEFAULT_CHAPTER_WORD_COUNT_MAX } from '../../types/genre.js'
import { buildChapterAgentContext, mergeAgentState } from '../utils/chapter-context.js'
import { charactersToString } from '../utils/characters.js'
import type { RuntimeContext } from '../../core/context.js'
import type { Issue, IssueSource, RetryStrategy } from '../../types/agent.js'

export function tagIssueSource(
  issue: Issue,
  source: IssueSource,
  retryStrategy: RetryStrategy
): Issue {
  return {
    ...issue,
    source,
    retryStrategy,
  }
}

export function inferRetryStrategy(issue: Issue): RetryStrategy {
  if (issue.type === 'word_count') return 'draft'
  if (issue.type === 'outline_violation' || issue.type === 'outline_deviation') return 'draft'
  if (issue.dimension === 'quality') return 'fix'
  if (issue.dimension === 'foreshadowing') return 'draft'
  if (issue.dimension === 'outline') return 'draft'
  if (issue.dimension === 'character_knowledge' || issue.dimension === 'dialogue') return 'draft'
  if (issue.type === 'state_corruption') return 'manual'
  return 'draft'
}

export async function validate_chapter(
  _context: RuntimeContext,
  state: ReducedGraphState
): Promise<Partial<ReducedGraphState>> {
  const chapterIndex = state.currentChapterIndex
  const content = await readChapterContent(state.story.outputDir, chapterIndex + 1)

  if (content === null) {
    return {
      pendingIssues: [
        ...state.pendingIssues,
        tagIssueSource(
          {
            id: generateId(),
            type: 'word_count' as const,
            severity: 'error' as const,
            description: `第 ${chapterIndex + 1} 章正文文件未找到`,
          },
          'word_count',
          'draft'
        ),
      ],
    }
  }

  const wordCount = countChineseWords(content)
  const genre = getGenreSkill(state.genre)
  const min = genre?.chapterWordCountMin ?? DEFAULT_CHAPTER_WORD_COUNT_MIN
  const max = genre?.chapterWordCountMax ?? DEFAULT_CHAPTER_WORD_COUNT_MAX

  // 只返回本轮新发现的字数问题，旧的 pendingIssues 由 orchestration 层统一维护。
  const newIssues: Issue[] = []

  if (wordCount < min) {
    newIssues.push(
      tagIssueSource(
        {
          id: generateId(),
          type: 'word_count' as const,
          severity: 'error',
          description: `第 ${chapterIndex + 1} 章字数 ${wordCount} 低于最低要求 ${min} 字`,
        },
        'word_count',
        'draft'
      )
    )
  } else if (wordCount > max) {
    newIssues.push(
      tagIssueSource(
        {
          id: generateId(),
          type: 'word_count' as const,
          severity: 'warning',
          description: `第 ${chapterIndex + 1} 章字数 ${wordCount} 超过建议上限 ${max} 字`,
        },
        'word_count',
        'draft'
      )
    )
  }

  if (chapterIndex > 0) {
    const prevContent = await readChapterContent(state.story.outputDir, chapterIndex)
    if (prevContent !== null) {
      const prevWordCount = countChineseWords(prevContent)
      const shorter = Math.min(wordCount, prevWordCount)
      const longer = Math.max(wordCount, prevWordCount)
      if (longer > 0 && shorter / longer < 0.5) {
        newIssues.push(
          tagIssueSource(
            {
              id: generateId(),
              type: 'word_count' as const,
              severity: 'warning',
              description: `第 ${chapterIndex + 1} 章字数 ${wordCount} 与上一章 ${prevWordCount} 差异超过50%，请检查章节内容是否完整`,
            },
            'word_count',
            'draft'
          )
        )
      }
    }
  }

  return { pendingIssues: newIssues }
}

export async function detect_foreshadowing(
  context: RuntimeContext,
  state: ReducedGraphState
): Promise<Partial<ReducedGraphState>> {
  const agent = getForeshadowingAgent(context.provider)
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

  const agentState: ForeshadowingAgentInput = {
    idea: state.idea,
    genre: state.genre,
    totalChapters: state.totalChapters,
    ...(worldContent ? { world: worldContent } : {}),
    characters: charactersToString(state.characters),
    chapterContent: content ?? '',
    foreshadowStack: cleanedForeshadowStack,
  }

  const output = await agent.run(agentState)
  const foreshadowStack = await agent.processOutput(output, chapterIndex, cleanedForeshadowStack, content || undefined)

  return { foreshadowStack }
}

export async function detect_consistency(
  context: RuntimeContext,
  state: ReducedGraphState
): Promise<Partial<ReducedGraphState>> {
  const agent = getConsistencyAgent(context.provider)
  const chapterIndex = state.currentChapterIndex
  const chapter = state.chapters[chapterIndex]

  if (!chapter) return {}

  const content = await readChapterContent(state.story.outputDir, chapterIndex + 1)
  const baseContext = await buildChapterAgentContext(state, chapterIndex, context.provider)

  const supersededFacts = state.storyState?.supersededFacts ?? []
  const supersededFactsStr = supersededFacts.length > 0
    ? supersededFacts.map(f => `- [${f.subject}] ${f.oldFact}（原因：${f.reason}）`).join('\n')
    : '（无）'

  const agentState: ConsistencyAgentInput = mergeAgentState(baseContext, {
    outline: buildConsistencyOutlineContext(state, chapterIndex),
    chapterContent: content ?? '',
    chapterSummaries: state.chapterSummaries,
    ...(state.chapterPlan ? { chapterPlan: state.chapterPlan } : {}),
    supersededFacts: supersededFactsStr,
  }) as ConsistencyAgentInput

  const output = await agent.run(agentState)
  const issues = await agent.processOutput(output, baseContext.canonicalFacts)

  const taggedIssues = issues.map(issue =>
    tagIssueSource(issue, 'consistency', inferRetryStrategy(issue))
  )

  // 只返回本轮新发现的一致性问题，避免在 validate_chapter_comprehensive 中重复追加旧问题。
  return taggedIssues.length > 0 ? { pendingIssues: taggedIssues } : {}
}

export async function validate_chapter_comprehensive(
  context: RuntimeContext,
  state: ReducedGraphState
): Promise<Partial<ReducedGraphState>> {
  // 将字数、伏笔、一致性（含质量/幻觉/大纲合规）校验串行聚合为单个图节点，
  // 避免每个 agent 占用一个 LangGraph 步骤，从而防止重写循环时 recursionLimit 被快速耗尽。
  let workingState: ReducedGraphState = { ...state }

  function mergePendingIssues(updates: Partial<ReducedGraphState>): void {
    if (updates.pendingIssues) {
      const seen = new Set(workingState.pendingIssues.map(i => i.id))
      const merged = [...workingState.pendingIssues]
      for (const issue of updates.pendingIssues) {
        if (!seen.has(issue.id)) {
          seen.add(issue.id)
          merged.push(issue)
        }
      }
      workingState = {
        ...workingState,
        pendingIssues: merged,
      }
    }
  }

  const wordCountUpdates = await validate_chapter(context, workingState)
  mergePendingIssues(wordCountUpdates)

  const foreshadowUpdates = await detect_foreshadowing(context, workingState)
  if (foreshadowUpdates.foreshadowStack) {
    workingState = {
      ...workingState,
      foreshadowStack: foreshadowUpdates.foreshadowStack,
    }
  }

  const consistencyUpdates = await detect_consistency(context, workingState)
  mergePendingIssues(consistencyUpdates)

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
