import type { Issue } from '../../types/agent.js'
import type { ModelProvider } from '../../model/provider.js'
import { batchClassifyIssues, type IssueClassification } from '../../utils/context-judge.js'

async function classifySingleIssue(
  provider: ModelProvider | undefined,
  issue: Issue
): Promise<IssueClassification> {
  if (!provider) {
    return fallbackClassification(issue)
  }
  const results = await batchClassifyIssues(provider, [issue])
  return results[0] ?? fallbackClassification(issue)
}

function fallbackClassification(issue: Issue): IssueClassification {
  const isError = issue.severity === 'error'
  const isStructuralType =
    issue.type === 'outline_violation' ||
    issue.type === 'outline_deviation' ||
    issue.type === 'state_corruption'
  const isStructural = isStructuralType || isError
  return {
    isStructural,
    isCrossChapter: false,
    isTaskConsistency: false,
    isItemLocationConflict: false,
    isInventedCharacter: false,
    isOutlineStateConflict: issue.type === 'state_corruption',
    isLocal: isError && !isStructural,
    isStateCorruption: issue.type === 'state_corruption',
    isInterpretive: false,
  }
}

export async function isTaskConsistencyIssue(
  provider: ModelProvider | undefined,
  issue: Issue
): Promise<boolean> {
  const classification = await classifySingleIssue(provider, issue)
  return classification.isTaskConsistency
}

export async function isStructuralIssue(
  provider: ModelProvider | undefined,
  issue: Issue
): Promise<boolean> {
  const classification = await classifySingleIssue(provider, issue)
  return classification.isStructural
}

export async function isLocalIssue(
  provider: ModelProvider | undefined,
  issue: Issue
): Promise<boolean> {
  const classification = await classifySingleIssue(provider, issue)
  return classification.isLocal
}

export async function isStateCorruptionIssue(
  provider: ModelProvider | undefined,
  issue: Issue
): Promise<boolean> {
  const classification = await classifySingleIssue(provider, issue)
  return classification.isStateCorruption
}

export async function isInterpretiveIssue(
  provider: ModelProvider | undefined,
  issue: Issue
): Promise<boolean> {
  const classification = await classifySingleIssue(provider, issue)
  return classification.isInterpretive
}
