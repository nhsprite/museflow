import type { Issue } from '../../types/agent.js'
import type { ModelProvider } from '../../model/provider.js'
import { batchClassifyIssues, type IssueClassification } from '../../utils/context-judge.js'

const INTERPRETIVE_KEYWORDS = [
  '描写',
  '措辞',
  '风格',
  '节奏',
  '冗长',
  '拖沓',
  '重复',
  '啰嗦',
  '赘述',
  '语言',
  '表达',
  '氛围',
  '观感',
  '可读性',
  '流畅',
  '生硬',
]

const TASK_KEYWORDS = [
  '差事',
  '任务',
  '约定',
  '承诺',
  '截止',
  '期限',
  'due',
  '待办',
]

function looksInterpretive(issue: Issue): boolean {
  const text = `${issue.description} ${issue.location ?? ''} ${issue.suggestion ?? ''}`
  return INTERPRETIVE_KEYWORDS.some(kw => text.includes(kw))
}

function looksTaskRelated(issue: Issue): boolean {
  const text = `${issue.description} ${issue.location ?? ''}`
  return TASK_KEYWORDS.some(kw => text.includes(kw))
}

function looksInventedCharacter(issue: Issue): boolean {
  const text = `${issue.description} ${issue.location ?? ''}`
  return /虚构角色|非官方角色|不在官方角色|invented|不在角色列表/.test(text)
}

function looksItemLocationConflict(issue: Issue): boolean {
  const text = `${issue.description} ${issue.location ?? ''}`
  return /物品位置|位置冲突|位置漂移|keyItemsLocation|同时出现在|多个位置/.test(text)
}

function looksOutlineStateConflict(issue: Issue): boolean {
  const text = `${issue.description} ${issue.location ?? ''}`
  return /大纲状态|outline.*canonical|canonical.*outline|大纲.*权威事实|权威事实.*大纲/.test(text)
}

/**
 * 基于 issue 类型和文本特征做确定性分类。
 * 不再依赖 LLM，避免路由抖动和高昂的模型调用成本。
 */
export function classifyIssueByRule(issue: Issue): IssueClassification {
  const isError = issue.severity === 'error'

  const isItemLocationConflict = looksItemLocationConflict(issue)
  const isInventedCharacter = looksInventedCharacter(issue)
  const isOutlineStateConflict = looksOutlineStateConflict(issue)
  const isTaskConsistency = looksTaskRelated(issue)

  const isStateCorruption =
    issue.type === 'state_corruption' ||
    isItemLocationConflict ||
    isInventedCharacter ||
    isOutlineStateConflict

  const isStructuralType =
    issue.type === 'outline_violation' ||
    issue.type === 'outline_deviation' ||
    issue.type === 'draft_failure' ||
    issue.type === 'state_corruption' ||
    issue.type === 'word_count' ||
    issue.type === 'outline_density' ||
    issue.type === 'outline_foreshadow'

  const isCrossChapter =
    issue.type === 'consistency' ||
    issue.type === 'hallucination' ||
    isTaskConsistency

  const isInterpretive =
    issue.type === 'quality' && !isError && looksInterpretive(issue)

  const isStructural =
    isStructuralType ||
    isStateCorruption ||
    (isError && issue.type === 'consistency') ||
    (isError && issue.type === 'hallucination')

  const isLocal = isError && !isStructural

  return {
    isStructural,
    isCrossChapter,
    isTaskConsistency,
    isItemLocationConflict,
    isInventedCharacter,
    isOutlineStateConflict,
    isLocal,
    isStateCorruption,
    isInterpretive,
  }
}

async function classifySingleIssue(
  provider: ModelProvider | undefined,
  issue: Issue,
  preferLLM = false
): Promise<IssueClassification> {
  const ruleResult = classifyIssueByRule(issue)

  if (!preferLLM || !provider) {
    return ruleResult
  }

  try {
    const results = await batchClassifyIssues(provider, [issue])
    return results[0] ?? ruleResult
  } catch {
    return ruleResult
  }
}

export async function isTaskConsistencyIssue(
  provider: ModelProvider | undefined,
  issue: Issue,
  preferLLM = false
): Promise<boolean> {
  const classification = await classifySingleIssue(provider, issue, preferLLM)
  return classification.isTaskConsistency
}

export async function isStructuralIssue(
  provider: ModelProvider | undefined,
  issue: Issue,
  preferLLM = false
): Promise<boolean> {
  const classification = await classifySingleIssue(provider, issue, preferLLM)
  return classification.isStructural
}

export async function isLocalIssue(
  provider: ModelProvider | undefined,
  issue: Issue,
  preferLLM = false
): Promise<boolean> {
  const classification = await classifySingleIssue(provider, issue, preferLLM)
  return classification.isLocal
}

export async function isStateCorruptionIssue(
  provider: ModelProvider | undefined,
  issue: Issue,
  preferLLM = false
): Promise<boolean> {
  const classification = await classifySingleIssue(provider, issue, preferLLM)
  return classification.isStateCorruption
}

export async function isInterpretiveIssue(
  provider: ModelProvider | undefined,
  issue: Issue,
  preferLLM = false
): Promise<boolean> {
  const classification = await classifySingleIssue(provider, issue, preferLLM)
  return classification.isInterpretive
}
