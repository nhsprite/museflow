import { Annotation } from '@langchain/langgraph'
import type { Story } from '../types/story.js'
import type { Character } from '../types/character.js'
import type { Issue } from '../types/agent.js'
import type { ChapterMeta } from '../types/chapter.js'
import type { ChapterPlan } from '../agents/chapter-planner.js'
import type { StoryState } from '../types/story-state.js'

export interface WorldContent {
  id: string
  storyId: string
  content: string
}

export interface ChapterOutline {
  number: number
  title: string
  description: string
  introducedCharacters?: string[]
}

export type ForeshadowStatus = 'planted' | 'hinted' | 'shown' | 'recalled'

export interface ForeshadowItem {
  id: string
  text: string
  expectedFulfillChapter: number
  createdAt: number
  createdAtChapter: number
  fulfilledChapter?: number
  status: ForeshadowStatus
  isExplicit: boolean
  source?: 'content' | 'outline' | 'manual'
}

export type ForeshadowAlertLevel = 'overdue' | 'urgent' | 'normal'

export interface ForeshadowAlert {
  item: ForeshadowItem
  level: ForeshadowAlertLevel
  currentChapter: number
}

export function getForeshadowAlerts(
  stack: ForeshadowItem[],
  currentChapter: number
): ForeshadowAlert[] {
  return stack
    .filter(item => !item.fulfilledChapter)
    .map(item => {
      let level: ForeshadowAlertLevel = 'normal'
      if (currentChapter > item.expectedFulfillChapter + 1) {
        level = 'overdue'
      } else if (currentChapter >= item.expectedFulfillChapter - 1) {
        level = 'urgent'
      }
      return { item, level, currentChapter }
    })
    .sort((a, b) => {
      const levelOrder = { overdue: 0, urgent: 1, normal: 2 }
      return levelOrder[a.level] - levelOrder[b.level]
    })
}

export function formatForeshadowAlerts(alerts: ForeshadowAlert[]): string {
  if (alerts.length === 0) return '暂无未回收伏笔'

  const overdue = alerts.filter(a => a.level === 'overdue')
  const urgent = alerts.filter(a => a.level === 'urgent')
  const normal = alerts.filter(a => a.level === 'normal')

  const lines: string[] = []

  if (overdue.length > 0) {
    lines.push(`⚠️ 已逾期 (${overdue.length}个):`)
    overdue.forEach((a, i) => {
      const overdueBy = a.currentChapter - a.item.expectedFulfillChapter
      const createdCh = a.item.createdAtChapter || '?'
      lines.push(`  ${i + 1}. "${a.item.text.substring(0, 60)}..." (第${createdCh}章埋下 → 预期第${a.item.expectedFulfillChapter}章, 逾期${overdueBy}章)`)
    })
  }

  if (urgent.length > 0) {
    lines.push(`🔔 即将到期 (${urgent.length}个):`)
    urgent.forEach((a, i) => {
      const createdCh = a.item.createdAtChapter || '?'
      lines.push(`  ${i + 1}. "${a.item.text.substring(0, 60)}..." (第${createdCh}章埋下 → 预期第${a.item.expectedFulfillChapter}章)`)
    })
  }

  if (normal.length > 0) {
    lines.push(`⏳ 正常 (${normal.length}个):`)
    normal.forEach((a, i) => {
      const createdCh = a.item.createdAtChapter || '?'
      lines.push(`  ${i + 1}. "${a.item.text.substring(0, 60)}..." (第${createdCh}章埋下 → 预期第${a.item.expectedFulfillChapter}章)`)
    })
  }

  return lines.join('\n')
}

export const GraphState = Annotation.Root({
  story: Annotation<Story>,
  idea: Annotation<string>,
  genre: Annotation<string>,
  totalChapters: Annotation<number>,
  world: Annotation<WorldContent | null>,
  characters: Annotation<Character[]>,
  outline: Annotation<ChapterOutline[]>,
  chapters: Annotation<(ChapterMeta | null)[]>,
  currentChapterIndex: Annotation<number>,
  foreshadowStack: Annotation<ForeshadowItem[]>,
  chapterSummaries: Annotation<string[]>,
  pendingIssues: Annotation<Issue[]>,
  rewriteApproved: Annotation<boolean>,
  rewriteRequested: Annotation<boolean>,
  isWriting: Annotation<boolean>,
  writeOneChapterOnly: Annotation<boolean>,
  lastPrintedChapter: Annotation<number>,
  lastTimelineSnapshot: Annotation<string | null>,
  chapterPlan: Annotation<ChapterPlan | null>,
  storyState: Annotation<StoryState>,
  chapterTimeAnchor: Annotation<string | undefined>,
  autoFixAttempts: Annotation<number>,
  verifiedConstraints: Annotation<string[]>,

  // chapter-writing loop state (managed by LangGraph)
  rewriteAttempts: Annotation<number>,
  errorRewriteAttempts: Annotation<number>,
  previousIssues: Annotation<Issue[]>,
  previousRawErrorCount: Annotation<number>,
  forceStructuralRewrite: Annotation<boolean>,
  routingDecision: Annotation<string | undefined>,
})

export type ReducedGraphState = typeof GraphState.State
