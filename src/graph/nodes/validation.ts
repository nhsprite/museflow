import { logger } from '../../utils/logger.js'
import type { ReducedGraphState } from '../state.js'
import type { ForeshadowingAgentInput, ConsistencyAgentInput } from '../../agents/types.js'
import { getForeshadowingAgent, getConsistencyAgent } from '../agent-factory.js'
import { generateId } from '../../utils/id.js'
import { createIssue } from '../../utils/agent-output.js'
import { readChapterContent, readChapterContentForRun } from '../../storage/filesystem/writer.js'
import { buildConsistencyOutlineContext } from './planning.js'
import { countChineseWords } from '../../utils/text.js'
import {
  getChapterWordCountPolicy,
  validateWordCount,
} from '../../utils/chapter-content-validation.js'
import { buildChapterAgentContext, mergeAgentState } from '../utils/chapter-context.js'
import { selectChapterSummaries } from '../../utils/chapter-summaries.js'
import { charactersToString } from '../utils/characters.js'
import type { RuntimeContext } from '../../core/context.js'
import {
  chatStructuredFallback,
  type JsonSchema,
  type Message,
  type ModelProvider,
} from '../../model/provider.js'
import type { Issue, IssueSource, RetryStrategy } from '../../types/agent.js'
import { inferRetryStrategy } from '../../utils/retry-strategy.js'
import {
  extractChapterEndingSnippet,
  extractChapterOpeningSnippet,
  buildDuplicateEndingParagraphMessage,
} from '../utils/chapter-window.js'
import { diffMemorySnapshots } from '../../story-memory/diff.js'
import { applyEvents } from '../../story-memory/projector.js'
import type { StoryMemory } from '../../types/story-memory.js'
import { getActiveForeshadows } from '../../story-memory/queries.js'
import { generateIssueFingerprint } from '../../utils/context-judge.js'

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

export function buildContinuityContext(state: ReducedGraphState): string {
  const sections: string[] = []
  const characters = charactersToString(state.characters).trim()
  if (characters.length > 0) {
    sections.push(`<characters>
【人物设定】
${characters}
</characters>`)
  }

  // 优先使用 StoryMemory 中的结构化状态作为连续性判断的事实依据，
  // 减少 LLM 对 prose 的主观解读空间。
  const memory = state.storyMemory
  if (memory) {
    const characterLocations: string[] = []
    for (const character of Object.values(memory.entities.characters)) {
      if (character.locationId) {
        characterLocations.push(`- ${character.id}: ${character.locationId}`)
      }
    }
    if (characterLocations.length > 0) {
      sections.push(`<character_locations>
【上一章结束时角色位置】
${characterLocations.join('\n')}
</character_locations>`)
    }

    const itemLocations: string[] = []
    for (const item of Object.values(memory.entities.items)) {
      const holder = item.holderId ? `持有者 ${item.holderId}` : `位置 ${item.locationId ?? '未知'}`
      itemLocations.push(`- ${item.id}: ${holder}`)
    }
    if (itemLocations.length > 0) {
      sections.push(`<item_locations>
【上一章结束时关键物品位置/持有者】
${itemLocations.join('\n')}
</item_locations>`)
    }

    const openTasks = Object.values(memory.tasks).filter((task) => task.resolvedIn === null)
    if (openTasks.length > 0) {
      sections.push(`<open_tasks>
【未完成任务】
${openTasks.map((task) => `- ${task.id}: ${task.description}`).join('\n')}
</open_tasks>`)
    }

    const activeForeshadows = getActiveForeshadows(memory).flatMap((id) => {
      const foreshadow = memory.foreshadows[id]
      return foreshadow ? [foreshadow] : []
    })
    if (activeForeshadows.length > 0) {
      sections.push(`<active_foreshadows>
【未回收伏笔】
${activeForeshadows
  .map((fs) => `- ${fs.id}（预期第 ${fs.expectedFulfillChapter ?? '全书结尾'} 章回收）: ${fs.text}`)
  .join('\n')}
</active_foreshadows>`)
    }
  }

  const canonicalFacts = (state.storyState?.canonicalFacts ?? [])
    .filter((fact) => fact.retiredIn === undefined)
    .slice(-20)
  if (canonicalFacts.length > 0) {
    sections.push(`<canonical_facts>
【权威事实摘要】
${canonicalFacts.map((fact) => `- [${fact.subject}] ${fact.attribute}: ${fact.value}`).join('\n')}
</canonical_facts>`)
  }

  return sections.join('\n\n')
}

/**
 * 判断是否可以跳过 LLM 开头承接检查。
 *
 * 当 StoryMemory 存在且存在结构化转场依据时，开头与上一章结尾的时间/位置跳转
 * 已被权威数据仲裁，prose 级的 LLM 开头承接检查误判率高于检出率：
 * - chapterPlan.chapterTimeAnchor 已经过 outline-expander 校验（不一致的锚点会被
 *   重规划或移除），且 consistency agent 将其作为时间推进的最高权威；
 * - 或本章草稿的结构化事件已记录实体移动（角色位置/物品持有者/物品位置变化），
 *   开头的位置/持有者跳转属于被事件解释的转场。
 * 跨章节一致性仍由 consistency agent（权威事实 + 时间锚点）兜底；
 * 无 StoryMemory 时保留原检查。
 */
function shouldSkipOpeningContinuityJudge(state: ReducedGraphState): boolean {
  const memory = state.storyMemory
  if (!memory) return false

  const anchor = state.chapterPlan?.chapterTimeAnchor
  if (typeof anchor === 'string' && anchor.trim().length > 0) return true

  const events = state.draftChapterEvents
  if (events && events.length > 0) {
    const projected = applyEvents(memory, events)
    const diff = diffMemorySnapshots(memory, projected)
    return (
      diff.characterLocations.length > 0 ||
      diff.itemHolders.length > 0 ||
      diff.itemLocations.length > 0
    )
  }

  return false
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
      : await chatStructuredFallback<ContinuityCheckResult>(
          provider,
          messages,
          CONTINUITY_CHECK_SCHEMA,
          0.1
        )

    if (result.isContinuous !== false) return []

    const reason =
      typeof result.reason === 'string' && result.reason.trim().length > 0
        ? result.reason.trim()
        : '当前章开头未自然承接上一章结尾，存在跨章节连续性断裂。'

    const issue: Issue = {
      id: generateId(),
      ruleId: 'continuity.opening',
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

/**
 * 通过对比相邻章节的 StoryMemory 快照，生成连续性变化的描述。
 *
 * 当前仅跟踪以下维度：角色位置、物品持有者、物品位置、新引入/兑现的伏笔、
 * 新建/解决的任务。未来可扩展状态（status/state）和节拍（beat）等维度。
 */
function checkContinuityWithMemory(
  previousMemory: StoryMemory,
  currentMemory: StoryMemory
): string[] {
  const diff = diffMemorySnapshots(previousMemory, currentMemory)
  const issues: string[] = []
  for (const change of diff.characterLocations) {
    issues.push(`角色 ${change.id} 位置从 ${change.before} 变为 ${change.after}`)
  }
  for (const change of diff.itemHolders) {
    issues.push(`物品 ${change.id} 持有者从 ${change.before} 变为 ${change.after}`)
  }
  for (const change of diff.itemLocations) {
    issues.push(`物品 ${change.id} 位置从 ${change.before} 变为 ${change.after}`)
  }
  for (const id of diff.newForeshadows) {
    issues.push(`新引入伏笔 ${id}`)
  }
  for (const id of diff.fulfilledForeshadows) {
    issues.push(`兑现伏笔 ${id}`)
  }
  for (const id of diff.newTasks) {
    issues.push(`新创建任务 ${id}`)
  }
  for (const id of diff.resolvedTasks) {
    issues.push(`解决任务 ${id}`)
  }
  return issues
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

/**
 * 每轮综合校验都会重新运行的检测器来源。
 * 这些来源的 issue 每轮由检测器基于最新草稿重新生成（id 也是新生成的），
 * 旧结果必须由本轮结果整体替换，否则已修复的问题会永久残留。
 */
const RERUN_ISSUE_SOURCES: ReadonlySet<IssueSource> = new Set(['word_count', 'consistency'])

/** 相邻章节字数健全检查的方差阈值：较短章字数不足较长章的该比例时给出警告。 */
const CHAPTER_WORDCOUNT_VARIANCE_THRESHOLD = 0.5

/**
 * 移除属于本轮重跑检测器的旧 issue，保留其他来源的 issue
 * （如结构化校验、大纲义务等由各自管线环节跨轮维护）。
 * 无 source 的 issue 无法判定来源，保守保留。
 * 参照 routing/structured-issues.ts 的 replaceStructuredIssues 整体替换模式。
 */
export function pruneRerunDetectorIssues(issues: Issue[]): Issue[] {
  return issues.filter(
    (issue) => issue.source === undefined || !RERUN_ISSUE_SOURCES.has(issue.source)
  )
}

export async function validate_chapter(
  _context: RuntimeContext,
  state: ReducedGraphState
): Promise<Partial<ReducedGraphState>> {
  const chapterIndex = state.currentChapterIndex
  const content = await readChapterContentForRun(state.story.outputDir, chapterIndex + 1)

  if (content === null) {
    return {
      pendingIssues: [
        ...state.pendingIssues,
        tagIssueSource(
          {
            id: generateId(),
            ruleId: 'word-count.content-missing',
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
  const wordCountPolicy = getChapterWordCountPolicy(state.genre)

  // 只返回本轮新发现的字数问题，旧的 pendingIssues 由 orchestration 层统一维护。
  const newIssues: Issue[] = []

  const wordCountResult = validateWordCount(content, wordCountPolicy)
  if (!wordCountResult.valid) {
    newIssues.push(
      createIssue(
        {
          ruleId: 'word-count.bounds',
          type: 'word_count',
          severity: 'error',
          description: `第 ${chapterIndex + 1} 章${wordCountResult.error}`,
        },
        'word_count',
        'fix'
      )
    )
  }

  if (chapterIndex > 0) {
    const prevContent = await readChapterContent(state.story.outputDir, chapterIndex)
    if (prevContent !== null) {
      const prevWordCount = countChineseWords(prevContent)
      const shorter = Math.min(wordCount, prevWordCount)
      const longer = Math.max(wordCount, prevWordCount)
      if (longer > 0 && shorter / longer < CHAPTER_WORDCOUNT_VARIANCE_THRESHOLD) {
        newIssues.push(
          tagIssueSource(
            {
              id: generateId(),
              ruleId: 'word-count.chapter-variance',
              type: 'word_count' as const,
              severity: 'warning',
              description: `第 ${chapterIndex + 1} 章字数 ${wordCount} 与上一章 ${prevWordCount} 差异超过50%，请检查章节内容是否完整`,
            },
            'word_count',
            'draft'
          )
        )
      }

      const duplicateMessage = buildDuplicateEndingParagraphMessage(
        chapterIndex,
        prevContent,
        content
      )
      if (duplicateMessage) {
        newIssues.push(
          createIssue(
            {
              ruleId: 'continuity.duplicate-ending',
              type: 'consistency',
              severity: 'error',
              description: duplicateMessage,
              suggestion: '改写本章结尾，避免与上一章结尾形成完全相同的段落。',
            },
            'consistency',
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

  const content = await readChapterContentForRun(state.story.outputDir, chapterIndex + 1)
  const worldContent = state.world?.content

  const currentChapter = chapterIndex + 1
  const cleanedForeshadowStack = state.foreshadowStack.filter((f) => {
    const createdAt = f.createdAtChapter ?? 0
    if (createdAt > currentChapter) return false
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
  const foreshadowStack = await agent.processOutput(
    output,
    chapterIndex,
    cleanedForeshadowStack,
    content || undefined,
    state.genre
  )

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
    readChapterContentForRun(state.story.outputDir, chapterIndex + 1),
  ])
  if (!previousContent || !currentContent) return {}

  const previousEnding = extractChapterEndingSnippet(previousContent)
  const currentOpening = extractChapterOpeningSnippet(currentContent)

  if (shouldSkipOpeningContinuityJudge(state)) {
    logger.info(`[MuseFlow] 第 ${chapterIndex + 1} 章存在结构化转场依据，跳过 LLM 开头承接检查`)
    return {}
  }

  const issues = await judgeChapterOpeningContinuity(
    context.provider,
    previousEnding,
    currentOpening,
    chapterIndex + 1,
    buildContinuityContext(state)
  )

  const taggedIssues = issues.map((issue) =>
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

  const content = await readChapterContentForRun(state.story.outputDir, chapterIndex + 1)
  const baseContext = await buildChapterAgentContext(state, chapterIndex, context)

  const agentState: ConsistencyAgentInput = mergeAgentState(baseContext, {
    outline: buildConsistencyOutlineContext(state, chapterIndex),
    chapterContent: content ?? '',
    chapterSummaries: selectChapterSummaries(state.chapters, chapterIndex),
    ...(state.chapterPlan ? { chapterPlan: state.chapterPlan } : {}),
    ...(state.pendingIssues.length > 0 ? { issues: state.pendingIssues } : {}),
  }) as ConsistencyAgentInput

  const output = await agent.run(agentState)
  const issues = await agent.processOutput(output, baseContext.canonicalFacts)

  const taggedIssues = issues.map((issue) =>
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

  // 字数与一致性/连续性检测器每轮都会基于最新草稿重跑，并以新 id 生成 issue。
  // 合并本轮结果前必须先移除这些来源的旧 issue（参照 replaceStructuredIssues 的
  // 按结构化字段整体替换模式），否则已修复的问题会永久残留，remainingErrors 永不为 0。
  // 其他来源（结构化校验、大纲义务等）由各自的管线环节维护，不在此清理。
  workingState.pendingIssues = pruneRerunDetectorIssues(workingState.pendingIssues)

  function mergePendingIssues(updates: Partial<ReducedGraphState>): void {
    if (updates.pendingIssues) {
      const issueKey = (issue: Issue) => `${issue.severity}:${generateIssueFingerprint(issue)}`
      const seen = new Set(workingState.pendingIssues.map(issueKey))
      const merged = [...workingState.pendingIssues]
      for (const issue of updates.pendingIssues) {
        const key = issueKey(issue)
        if (!seen.has(key)) {
          seen.add(key)
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

  if (
    workingState.storyMemory &&
    workingState.draftChapterEvents &&
    workingState.draftChapterEvents.length > 0
  ) {
    const currentMemory = applyEvents(workingState.storyMemory, workingState.draftChapterEvents)
    const memoryContinuityDescriptions = checkContinuityWithMemory(
      workingState.storyMemory,
      currentMemory
    )
    if (memoryContinuityDescriptions.length > 0) {
      const memoryContinuityIssues = memoryContinuityDescriptions.map((description) =>
        tagIssueSource(
          {
            id: generateId(),
            ruleId: 'continuity.memory-projection',
            type: 'continuity',
            severity: 'warning',
            description,
          },
          'consistency',
          'draft'
        )
      )
      mergePendingIssues({ pendingIssues: memoryContinuityIssues })
    }
  }

  const consistencyBaseState = workingState
  // 语义伏笔检测结果仅在无 StoryMemory 时才会被应用；
  // StoryMemory 存在时跳过检测，避免每轮浪费一次结果必然被丢弃的 LLM 调用。
  const detectedForeshadowStack = workingState.storyMemory
    ? undefined
    : (await detect_foreshadowing(context, workingState)).foreshadowStack

  const consistencyUpdates = await detect_consistency(context, consistencyBaseState)
  mergePendingIssues(consistencyUpdates)

  const hasBlockingErrors = workingState.pendingIssues.some((issue) => issue.severity === 'error')
  const canApplySemanticForeshadowStack = !workingState.storyMemory
  if (detectedForeshadowStack && !hasBlockingErrors && canApplySemanticForeshadowStack) {
    workingState = {
      ...workingState,
      foreshadowStack: detectedForeshadowStack,
    }
  }

  const result: Partial<ReducedGraphState> = {}

  // 始终回写 pendingIssues（包括空列表）：重跑检测器的旧 issue 已被移除，
  // 只有写回空列表才能清除上一轮已修复的问题，避免残留 error 阻断定稿。
  result.pendingIssues = workingState.pendingIssues

  if (workingState.foreshadowStack !== state.foreshadowStack) {
    result.foreshadowStack = workingState.foreshadowStack
  }

  if (workingState.rewriteApproved !== state.rewriteApproved) {
    result.rewriteApproved = workingState.rewriteApproved
  }

  return result
}
