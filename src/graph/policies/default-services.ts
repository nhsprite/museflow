import { readChapterContent } from '../../storage/filesystem/writer.js'
import {
  isStructuralIssue,
  isLocalIssue,
  isTaskConsistencyIssue,
  isStateCorruptionIssue,
} from '../../core/chapter-generation/issue-classifier.js'
import {
  deduplicateIssuesSemantically,
  issueFingerprint,
} from '../../utils/issue-deduplication.js'
import { logger } from '../../utils/logger.js'
import { shouldForceTemporaryReplan } from '../../utils/outline-boundary.js'
import type { ChapterOutline } from '../state.js'
import type { RewritePolicyServices } from './rewrite-routing.js'

const INTERPRETIVE_ISSUE_PATTERN = /提前.*(?:剧透|揭示)|看破.*说破|感应.*反应|选择性感应|表达方式|性格驱动/

function isInterpretiveIssue(issue: { description: string; location?: string }): boolean {
  return (
    INTERPRETIVE_ISSUE_PATTERN.test(issue.description) ||
    INTERPRETIVE_ISSUE_PATTERN.test(issue.location || '')
  )
}

export function createRewritePolicyServices(
  outputDir: string,
  chapterNumber: number,
  outline: ChapterOutline[],
  chapterIndex: number
): RewritePolicyServices {
  return {
    isStructuralIssue,
    isLocalIssue,
    isTaskConsistencyIssue,
    isStateCorruptionIssue,
    deduplicateIssues: deduplicateIssuesSemantically,
    issueFingerprint,
    isInterpretiveIssue,
    shouldForceTemporaryReplan: () => shouldForceTemporaryReplan(outline, chapterIndex),
    readChapterContent: () => readChapterContent(outputDir, chapterNumber),
    log(level, message, ...meta) {
      logger[level](message, ...meta)
    },
  }
}
