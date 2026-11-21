import { callAudit } from './model-call.js'
import { adjudicateContradictions } from './contradictions.js'
import { createHash } from 'node:crypto'
import type { ModelProvider } from '../../../model/provider.js'
import type { ReducedGraphState } from '../../state.js'
import type { Issue } from '../../../types/agent.js'
import type { NarrativeAuditRecord, NarrativeAuditReport } from '../../../types/narrative-audit.js'
import { readChapterContent } from '../../../storage/filesystem/writer.js'
import { splitContentParagraphs } from '../../../utils/text.js'
import { isEmptyStoryTime } from '../../../utils/story-time.js'
import { LIFECYCLE_ATTRIBUTES } from '../../../types/story-memory.js'
import { isRecordableFact, repairSuggestion, validateFactCoverage } from './coverage.js'
import { getChapterPlanningConfig } from '../../../utils/chapter-planning.js'
import {
  ChapterValidationError,
  runRequiredChapterCheck,
} from '../../../utils/chapter-validation-error.js'
import {
  PROSE_FACT_EXTRACTION_PROMPT,
  NARRATIVE_REVIEW_PROMPT,
} from '../../../agents/prompts/narrative-audit-prompt.js'
import {
  factExtractionSchema,
  narrativeReviewSchema,
  FACT_EXTRACTION_SCHEMA,
  NARRATIVE_REVIEW_SCHEMA,
} from './schema.js'

export const narrativeContentHash = (content: string): string =>
  createHash('sha256').update(content).digest('hex')

export function buildNarrativeAuditRecords(state: ReducedGraphState): NarrativeAuditRecord[] {
  return [
    ...(state.draftChapterEvents ?? []).map((value) => ({
      kind: 'event' as const,
      origin: 'current' as const,
      value,
    })),
    ...(state.chapterFinalStateDeclarations ?? []).map((value) => ({
      kind: 'declaration' as const,
      origin: 'current' as const,
      value,
    })),
    ...(state.storyState?.canonicalFacts ?? [])
      .filter(
        (fact) =>
          fact.retiredIn === undefined &&
          fact.source !== 'outline_inference' &&
          (fact.establishedIn < state.currentChapterIndex || fact.source === 'author_override')
      )
      .map((value) => ({ kind: 'canonical_fact' as const, origin: 'established' as const, value })),
    ...Object.values(state.storyMemory?.entities.characters ?? {}).map((value) => ({
      kind: 'entity' as const,
      origin: 'established' as const,
      value,
    })),
    ...Object.values(state.storyMemory?.entities.items ?? {}).map((value) => ({
      kind: 'entity' as const,
      origin: 'established' as const,
      value,
    })),
    ...(!isEmptyStoryTime(state.storyState?.storyTime)
      ? [
          {
            kind: 'story_time' as const,
            origin: 'established' as const,
            value: state.storyState?.storyTime,
          },
        ]
      : []),
  ]
}

interface AuditChapter {
  chapterIndex: number
  contentHash: string
  paragraphs: string[]
}

function requireParagraph(chapter: AuditChapter | undefined, paragraphIndex: number): void {
  if (
    !chapter ||
    !Number.isInteger(paragraphIndex) ||
    paragraphIndex < 0 ||
    paragraphIndex >= chapter.paragraphs.length
  ) {
    throw new Error('审计引用了不存在的正文段落')
  }
}

/** 独立提取并比对记录；矛盾候选追加盲复核，不直接变更权威状态。 */
export async function auditChapterNarrative(
  provider: ModelProvider,
  state: ReducedGraphState,
  content: string
): Promise<NarrativeAuditReport | undefined> {
  const config = getChapterPlanningConfig(state.genre)
  if (config.narrativeAuditMode === 'off') return undefined
  const chapterIndex = state.currentChapterIndex
  const chapters: AuditChapter[] = []
  const first = Math.max(0, chapterIndex - config.narrativeProgressWindow + 1)
  for (let index = first; index <= chapterIndex; index++) {
    const prose =
      index === chapterIndex ? content : await readChapterContent(state.story.outputDir, index + 1)
    if (!prose?.trim())
      throw new ChapterValidationError(
        'narrative.audit',
        chapterIndex,
        `审计窗口缺少第 ${index + 1} 章正文`
      )
    const paragraphs = splitContentParagraphs(prose)
    if (paragraphs.length === 0)
      throw new ChapterValidationError('narrative.audit', chapterIndex, '审计窗口缺少正文段落')
    chapters.push({ chapterIndex: index, contentHash: narrativeContentHash(prose), paragraphs })
  }
  const current = chapters[chapters.length - 1]!
  const records = buildNarrativeAuditRecords(state)
  const recordsHash = narrativeContentHash(JSON.stringify(records))
  const window = chapters.map(({ chapterIndex, contentHash }) => ({ chapterIndex, contentHash }))
  const entities = [
    ...Object.values(state.storyMemory?.entities.characters ?? {}).map((entity) => ({
      ...entity,
      kind: 'character' as const,
    })),
    ...Object.values(state.storyMemory?.entities.items ?? {}).map((entity) => ({
      ...entity,
      kind: 'item' as const,
    })),
    ...(state.characters ?? []).map((entity) => ({ ...entity, kind: 'character' as const })),
    ...(state.draftChapterEvents ?? []).flatMap((event) =>
      event.type === 'entity-register'
        ? [{ id: event.entityId, name: event.displayName, kind: event.entityKind }]
        : []
    ),
  ].map(({ id, name, kind }) => ({ id, name, kind }))
  const knownIds = new Set(entities.map((entity) => entity.id))
  const entityKinds = new Map(entities.map((entity) => [entity.id, entity.kind]))
  // 不复用跨调用缓存：每轮重新审计，避免模型/配置变化或重写后沿用旧语义判断。
  const indexedChapters = chapters.map((chapter) => ({
    chapterIndex: chapter.chapterIndex,
    paragraphs: chapter.paragraphs.map((text, paragraphIndex) => ({ paragraphIndex, text })),
  }))
  let extractionFailure: string | undefined
  let reviewFailure: string | undefined
  const facts = await runRequiredChapterCheck('narrative.audit', chapterIndex, async () => {
    try {
      const extracted = factExtractionSchema.parse(
        await callAudit(
          provider,
          chapterIndex,
          'narrative.extract',
          [
            { role: 'system', content: PROSE_FACT_EXTRACTION_PROMPT },
            {
              role: 'user',
              content: JSON.stringify({
                chapterIndex,
                entities,
                lifecycleAttributes: LIFECYCLE_ATTRIBUTES,
                paragraphs: indexedChapters.at(-1)!.paragraphs,
              }),
            },
          ],
          FACT_EXTRACTION_SCHEMA,
          extractionFailure
        )
      )
      for (const fact of extracted.facts) {
        if (fact.entityId !== null && !knownIds.has(fact.entityId))
          throw new Error('事实提取引用了未知实体 ID')
        if (fact.entityId !== null && (fact.kind === 'lifecycle' || fact.kind === 'custody')) {
          const expectedKind = fact.kind === 'lifecycle' ? 'character' : 'item'
          if (entityKinds.get(fact.entityId) !== expectedKind)
            throw new Error(
              `${fact.kind} 的 entityId 必须指向 ${expectedKind}，不能将持有人或叙述者当成物品主体；无已知物品 ID 时填 null`
            )
        }
        for (const paragraph of fact.evidenceParagraphs) requireParagraph(current, paragraph)
      }
      return extracted.facts
    } catch (error) {
      extractionFailure = error instanceof Error ? error.message : String(error)
      throw error
    }
  })
  const review = await runRequiredChapterCheck('narrative.audit', chapterIndex, async () => {
    try {
      const result = narrativeReviewSchema.parse(
        await callAudit(
          provider,
          chapterIndex,
          'narrative.review',
          [
            { role: 'system', content: NARRATIVE_REVIEW_PROMPT },
            {
              role: 'user',
              content: JSON.stringify({
                chapterIndex,
                genre: state.genre,
                draftObservations: facts.map((fact, factIndex) => ({
                  factIndex,
                  ...fact,
                  recordable: isRecordableFact(fact),
                })),
                records: records.map((record, recordIndex) => ({ recordIndex, ...record })),
                chapters: indexedChapters,
              }),
            },
          ],
          NARRATIVE_REVIEW_SCHEMA,
          reviewFailure
        )
      )
      const byChapter = new Map(chapters.map((chapter) => [chapter.chapterIndex, chapter]))
      const reviewed = new Set<number>()
      for (const progress of result.progress) {
        if (reviewed.has(progress.chapterIndex) || !byChapter.has(progress.chapterIndex))
          throw new Error('推进评估章节重复或越界')
        reviewed.add(progress.chapterIndex)
        for (const paragraph of progress.evidenceParagraphs)
          requireParagraph(byChapter.get(progress.chapterIndex), paragraph)
        if ((progress.verdict === 'advancing') !== progress.dimensions.length > 0)
          throw new Error('推进结论与维度不一致')
        if (progress.verdict !== 'advancing' && progress.recording !== 'uncertain')
          throw new Error('非 advancing 章节的 recording 必须为 uncertain')
      }
      if (reviewed.size !== chapters.length) throw new Error('推进评估未覆盖完整窗口')
      for (const finding of result.findings) {
        for (const index of finding.factIndexes)
          if (!facts[index]) throw new Error('审计引用了不存在的提取事实')
        for (const index of finding.recordIndexes)
          if (!records[index]) throw new Error('审计引用了不存在的记录')
        for (const evidence of finding.evidence)
          requireParagraph(byChapter.get(evidence.chapterIndex), evidence.paragraphIndex)
        if (!finding.evidence.some((evidence) => evidence.chapterIndex === chapterIndex))
          throw new Error('审计问题缺少当前正文证据')
        if (
          finding.kind === 'unsupported_record' &&
          !finding.recordIndexes.some((index) => records[index]?.origin === 'current')
        )
          throw new Error('未证实问题未引用本章记录')
        if (
          finding.kind === 'contradiction' &&
          !finding.recordIndexes.some((index) => records[index]?.origin === 'established') &&
          !finding.evidence.some((evidence) => evidence.chapterIndex < chapterIndex)
        )
          throw new Error('矛盾问题缺少既有事实依据')
      }
      for (const finding of result.findings) {
        const expectedTarget =
          finding.kind === 'unsupported_record' ? 'current_records' : 'current_prose'
        if (
          finding.repairTarget !== expectedTarget &&
          !(finding.kind === 'contradiction' && finding.repairTarget === 'manual_review')
        ) {
          throw new Error(
            `${finding.kind} 的 repairTarget 必须为 ${expectedTarget}；不得改动已定稿前文`
          )
        }
      }
      const omissions = validateFactCoverage(facts, result.coverage, records, chapterIndex)
      return {
        ...result,
        findings: [
          ...result.findings.map((finding) => ({
            ...finding,
            suggestion: repairSuggestion(finding.repairTarget),
          })),
          ...omissions,
        ],
      }
    } catch (error) {
      reviewFailure = error instanceof Error ? error.message : String(error)
      throw error
    }
  })
  const findings = await adjudicateContradictions(
    provider,
    chapterIndex,
    indexedChapters,
    records,
    review.findings
  )
  // 历史正文也参与判断；检查期间的变动不能得到有效审计凭证。
  for (const chapter of chapters.slice(0, -1)) {
    const latest = await readChapterContent(state.story.outputDir, chapter.chapterIndex + 1)
    if (latest === null || narrativeContentHash(latest) !== chapter.contentHash)
      throw new ChapterValidationError('narrative.audit', chapterIndex, '审计期间前文发生变化')
  }
  return {
    protocolVersion: 4,
    mode: config.narrativeAuditMode,
    chapterIndex,
    contentHash: current.contentHash,
    recordsHash,
    records,
    window,
    facts,
    coverage: review.coverage,
    findings,
    progress: review.progress.sort((a, b) => a.chapterIndex - b.chapterIndex),
  }
}

export function narrativeAuditIssues(report: NarrativeAuditReport): Issue[] {
  const issues: Issue[] = report.findings
    .filter((finding) => finding.contradictionReview?.verdict !== 'rejected')
    .map((finding, index) => {
      const evidence = finding.evidence.find((item) => item.chapterIndex === report.chapterIndex)!
      const fact = report.facts[finding.factIndexes[0] ?? -1]
      const blocking =
        finding.kind === 'contradiction'
          ? finding.contradictionReview?.verdict === 'confirmed'
          : finding.confidence === 'high'
      return {
        id: `narrative-${report.chapterIndex}-${index}`,
        ruleId: `narrative.${finding.kind}`,
        type: 'consistency',
        severity: report.mode === 'enforce' && blocking ? 'error' : 'warning',
        source: 'narrative_audit',
        retryStrategy: finding.repairTarget === 'manual_review' ? 'manual' : 'draft',
        dimension: 'narrative_facts',
        subject:
          fact?.entityId ??
          fact?.entityName ??
          `chapter-${report.chapterIndex + 1}:p${evidence.paragraphIndex}`,
        ...(fact ? { conflictAttribute: fact.attribute } : {}),
        locationRef: { paragraphIndex: evidence.paragraphIndex },
        description: finding.explanation,
        suggestion: finding.suggestion,
      }
    })
  const current = report.progress.find((item) => item.chapterIndex === report.chapterIndex)
  if (current?.verdict === 'stalled')
    issues.push({
      id: `narrative-stalled-${report.chapterIndex}`,
      ruleId: 'narrative.stalled',
      type: 'outline_density',
      severity: 'warning',
      source: 'narrative_audit',
      retryStrategy: 'draft',
      description: current.explanation,
      locationRef: { paragraphIndex: current.evidenceParagraphs[0]! },
    })
  return issues
}

/** 仅消费本轮正文绑定的评估；过渡/不确定/实际推进都会中断停滞连击。 */
export function narrativeStalledChapters(report: NarrativeAuditReport): number {
  let count = 0
  for (let index = report.progress.length - 1; index >= 1; index--) {
    const chapter = report.progress[index]!
    if (chapter.chapterIndex !== report.chapterIndex - count || chapter.verdict !== 'stalled') break
    count++
  }
  return count
}

/** 旧 checkpoint、正文/记录/窗口变化或配置切换后必须重新审计。 */
export async function isNarrativeAuditCurrent(
  state: ReducedGraphState,
  content: string
): Promise<boolean> {
  const config = getChapterPlanningConfig(state.genre)
  if (config.narrativeAuditMode === 'off')
    return (
      !state.session?.narrativeAudit &&
      !state.pendingIssues?.some((issue) => issue.source === 'narrative_audit')
    )
  const report = state.session?.narrativeAudit
  if (
    !report ||
    report.protocolVersion !== 4 ||
    report.mode !== config.narrativeAuditMode ||
    report.findings.some(
      (finding) => finding.kind === 'contradiction' && !finding.contradictionReview
    ) ||
    report.chapterIndex !== state.currentChapterIndex ||
    report.contentHash !== narrativeContentHash(content) ||
    report.recordsHash !== narrativeContentHash(JSON.stringify(buildNarrativeAuditRecords(state)))
  )
    return false
  const first = Math.max(0, state.currentChapterIndex - config.narrativeProgressWindow + 1)
  if (report.window.length !== state.currentChapterIndex - first + 1) return false
  for (let offset = 0; offset < report.window.length; offset++) {
    const chapter = report.window[offset]!
    if (chapter.chapterIndex !== first + offset) return false
    if (chapter.chapterIndex === state.currentChapterIndex) continue
    const prose = await readChapterContent(state.story.outputDir, chapter.chapterIndex + 1)
    if (prose === null || narrativeContentHash(prose) !== chapter.contentHash) return false
  }
  return true
}
