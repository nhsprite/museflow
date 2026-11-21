import type { ReducedGraphState } from '../../state.js'
import type { Issue } from '../../../types/agent.js'
import {
  createEmptyChapterReport,
  summarizeIssues,
  type StateCorrection,
  type ChapterReport,
} from '../../../types/chapter-report.js'
import { countChineseWords } from '../../../utils/text.js'
import { getChapterPlanningConfig } from '../../../utils/chapter-planning.js'
import { classifyForeshadows } from '../../../story-memory/foreshadow-policy.js'
import { policyFromLegacyStackFields } from '../../../story-memory/resolution-policy.js'
import { getActForChapter } from './act-progress.js'

export function buildChapterReport(
  state: ReducedGraphState,
  chapter: ReducedGraphState['chapters'][number],
  chapterContent: string,
  updatedStoryState: ReducedGraphState['storyState'],
  pendingIssues: Issue[] = state.pendingIssues,
  foreshadowsNeedingAttention: string[] = []
): ChapterReport {
  const chapterIndex = state.currentChapterIndex
  const outlineItem = state.outline[chapterIndex]

  const report = createEmptyChapterReport(state.story.id, chapterIndex)
  report.chapterTitle = outlineItem?.title ?? chapter?.title ?? ''
  report.wordCount = countChineseWords(chapterContent)
  report.summary = chapter?.summary ?? null

  const session = state.session
  if (
    session?.narrativeAudit?.chapterIndex === chapterIndex &&
    session.narrativeAudit.mode === getChapterPlanningConfig(state.genre).narrativeAuditMode
  ) {
    report.narrativeAudit = session.narrativeAudit
  }
  report.draftStrategy = inferDraftStrategy(state)
  report.rewriteAttempts = session?.rewriteAttempts ?? 0
  report.errorRewriteAttempts = session?.errorRewriteAttempts ?? 0
  report.autoFixAttempts = session?.autoFixAttempts ?? 0

  report.issues = pendingIssues
  report.issuesSummary = summarizeIssues(pendingIssues)

  report.stateCorrections = buildStateCorrections(updatedStoryState)

  const plantedForeshadows = state.foreshadowStack.filter(
    (foreshadow) => foreshadow.createdAtChapter === chapterIndex + 1
  )
  report.foreshadowsPlantedDetails = plantedForeshadows.map((foreshadow) => {
    const memory = state.storyMemory?.foreshadows[foreshadow.id]
    return {
      id: foreshadow.id,
      text: foreshadow.text,
      expectedFulfillChapter:
        memory !== undefined
          ? memory.expectedFulfillChapter
          : foreshadow.expectedFulfillChapter >= Number.MAX_SAFE_INTEGER
            ? null
            : foreshadow.expectedFulfillChapter,
      resolutionPolicy:
        memory?.resolutionPolicy ??
        foreshadow.resolutionPolicy ??
        policyFromLegacyStackFields(foreshadow.required, foreshadow.expectedFulfillChapter),
    }
  })
  report.foreshadowsPlanted = plantedForeshadows.length
  report.foreshadowsFulfilled = state.foreshadowStack.filter(
    (f) => f.fulfilledChapter === chapterIndex + 1
  ).length
  report.foreshadowsOverdue = classifyForeshadows(
    state.foreshadowStack,
    chapterIndex + 1
  ).overdueRequired.length
  if (foreshadowsNeedingAttention.length > 0) {
    report.foreshadowsNeedingAttention = foreshadowsNeedingAttention
  }

  report.convergence = inferConvergence(state)

  const act = getActForChapter(state.storyArc, chapterIndex)
  if (act) {
    const progress = state.actProgress[act.index] ?? {
      consumed: [],
      pending: [...act.mandatoryBeats],
    }
    report.actProgress = {
      actIndex: act.index,
      chaptersRemaining: act.endChapter - (chapterIndex + 1),
      beatsTotal: act.mandatoryBeats.length,
      beatsConsumed: progress.consumed.length,
      beatsPending: progress.pending,
    }
  }

  return report
}

function inferDraftStrategy(state: ReducedGraphState): ChapterReport['draftStrategy'] {
  const session = state.session
  if (session?.routingDecision === 'fix_chapter') return 'fix'
  if (session?.routingDecision === 'finalize_chapter' && (session?.rewriteAttempts ?? 0) === 0) {
    return 'finalize-only'
  }
  if ((session?.autoFixAttempts ?? 0) > 0) return 'fix'
  return 'draft'
}

function inferConvergence(state: ReducedGraphState): ChapterReport['convergence'] {
  const session = state.session
  if (!state.rewriteRequested) return 'success'
  const maxAttempts = getChapterPlanningConfig(state.genre).maxErrorRewriteAttempts
  if ((session?.errorRewriteAttempts ?? 0) >= maxAttempts) return 'max-attempts-reached'
  return 'manual-rewrite-requested'
}

function buildStateCorrections(storyState: ReducedGraphState['storyState']): StateCorrection[] {
  if (!storyState) return []
  const corrections: StateCorrection[] = []
  for (const fact of storyState.canonicalFacts ?? []) {
    for (const old of fact.supersedes ?? []) {
      corrections.push({
        subject: fact.subject,
        attribute: fact.attribute,
        oldValue: old.oldValue,
        newValue: fact.value,
        reason: 'canonical_fact',
      })
    }
  }
  for (const fact of storyState.supersededFacts ?? []) {
    corrections.push({
      subject: fact.subject,
      attribute: 'fact',
      oldValue: fact.oldFact,
      newValue: '',
      reason: 'superseded_fact',
    })
  }
  return corrections
}
