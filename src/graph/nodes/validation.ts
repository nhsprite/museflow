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
import { chatStructuredFallback, type JsonSchema, type Message, type ModelProvider } from '../../model/provider.js'
import type { Issue, IssueSource, RetryStrategy } from '../../types/agent.js'
import { extractChapterEndingSnippet, extractChapterOpeningSnippet } from '../utils/chapter-window.js'

const CONTINUITY_CHECK_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    isContinuous: { type: 'boolean' },
    severity: { type: 'string', enum: ['error', 'warning', 'info'] },
    reason: { type: 'string' },
    suggestion: { type: 'string' },
  },
  required: ['isContinuous'],
}

interface ContinuityCheckResult {
  isContinuous?: boolean
  severity?: string
  reason?: string
  suggestion?: string
}

function normalizeContinuitySeverity(severity: string | undefined): Issue['severity'] {
  if (severity === 'warning' || severity === 'info') return severity
  return 'error'
}

function buildContinuityContext(state: ReducedGraphState): string {
  const sections: string[] = []
  const characters = charactersToString(state.characters).trim()
  if (characters.length > 0) {
    sections.push(`<characters>
【人物设定】
${characters}
</characters>`)
  }

  const canonicalFacts = (state.storyState?.canonicalFacts ?? [])
    .filter(fact => fact.retiredIn === undefined)
    .slice(-20)
  if (canonicalFacts.length > 0) {
    sections.push(`<canonical_facts>
【权威事实摘要】
${canonicalFacts.map(fact => `- [${fact.subject}] ${fact.attribute}: ${fact.value}`).join('\n')}
</canonical_facts>`)
  }

  return sections.join('\n\n')
}

async function judgeChapterOpeningContinuity(
  provider: ModelProvider,
  previousEnding: string,
  currentOpening: string,
  chapterNumber: number,
  continuityContext = ''
): Promise<Issue[]> {
  if (!previousEnding || !currentOpening) return []

  const messages: Message[] = [
    {
      role: 'system',
      content: `你是小说连续性校验助手。只判断当前章开头是否自然承接上一章结尾。

判定标准：
1. 如果当前章开头与上一章结尾在人物位置、关键物品持有者、刚发生的动作结果、对话承诺上直接矛盾，返回 isContinuous=false。
2. 如果当前章开头通过时间跳转、回忆、转场、旁白解释或新的场景说明完成过渡，返回 isContinuous=true。
3. 只报告会导致读者困惑的明确断裂，不要把正常省略、合理转场或不同措辞判为错误。
4. 人物可能同时拥有本名、化名、度牒名、职衔或对外身份；如果人物设定或权威事实说明这些称呼指向同一人，不要把合法称呼切换判为人物断裂。
5. 只输出 JSON。`,
    },
    {
      role: 'user',
      content: `${continuityContext ? `【连续性背景】\n${continuityContext}\n\n` : ''}【上一章结尾片段】\n${previousEnding}\n\n【第 ${chapterNumber} 章开头片段】\n${currentOpening}`,
    },
  ]

  try {
    const result = provider.chatStructured
      ? await provider.chatStructured<ContinuityCheckResult>(messages, CONTINUITY_CHECK_SCHEMA, 0.1)
      : await chatStructuredFallback<ContinuityCheckResult>(provider, messages, CONTINUITY_CHECK_SCHEMA, 0.1)

    if (result.isContinuous !== false) return []

    const reason = typeof result.reason === 'string' && result.reason.trim().length > 0
      ? result.reason.trim()
      : '当前章开头未自然承接上一章结尾，存在跨章节连续性断裂。'

    const issue: Issue = {
      id: generateId(),
      type: 'continuity',
      severity: normalizeContinuitySeverity(result.severity),
      description: `第 ${chapterNumber} 章开头承接上一章结尾失败：${reason}`,
    }
    if (typeof result.suggestion === 'string' && result.suggestion.trim().length > 0) {
      issue.suggestion = result.suggestion.trim()
    }
    return [issue]
  } catch (err) {
    logger.warn(`[MuseFlow] 第 ${chapterNumber} 章开头承接校验失败，跳过该专项检查:`, err)
    return []
  }
}

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

export async function detect_continuity(
  context: RuntimeContext,
  state: ReducedGraphState
): Promise<Partial<ReducedGraphState>> {
  const chapterIndex = state.currentChapterIndex
  const chapter = state.chapters[chapterIndex]

  if (!chapter || chapterIndex <= 0) return {}

  const [previousContent, currentContent] = await Promise.all([
    readChapterContent(state.story.outputDir, chapterIndex),
    readChapterContent(state.story.outputDir, chapterIndex + 1),
  ])
  if (!previousContent || !currentContent) return {}

  const previousEnding = extractChapterEndingSnippet(previousContent)
  const currentOpening = extractChapterOpeningSnippet(currentContent)
  const issues = await judgeChapterOpeningContinuity(
    context.provider,
    previousEnding,
    currentOpening,
    chapterIndex + 1,
    buildContinuityContext(state)
  )

  const taggedIssues = issues.map(issue =>
    tagIssueSource(issue, 'consistency', inferRetryStrategy(issue))
  )
  return taggedIssues.length > 0 ? { pendingIssues: taggedIssues } : {}
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
  const baseContext = await buildChapterAgentContext(state, chapterIndex, context)

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
    ...(state.pendingIssues.length > 0 ? { issues: state.pendingIssues } : {}),
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

  const continuityUpdates = await detect_continuity(context, workingState)
  mergePendingIssues(continuityUpdates)

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
