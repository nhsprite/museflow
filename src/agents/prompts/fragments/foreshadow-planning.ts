import type { ForeshadowPlanningObligation, ForeshadowPlanningRejection } from '../../types.js'

function formatIds(ids: readonly string[]): string {
  return ids.length > 0 ? ids.join(', ') : '（无）'
}

function renderObligations(obligations: readonly ForeshadowPlanningObligation[]): string {
  if (obligations.length === 0) return ''

  const lines = obligations.map(
    (obligation) =>
      `- id=${obligation.id}; text=${obligation.text}; kind=${obligation.kind ?? 'null'}; introducedChapter=${obligation.introducedChapter}; resolutionPolicy=${obligation.resolutionPolicy}; deadlineChapter=${obligation.deadlineChapter ?? 'null'}; schedulingMode=${obligation.schedulingMode}; mustFulfillThisChapter=${String(obligation.mustFulfillThisChapter)}`
  )
  return `<foreshadow_obligations>
【本章伏笔规划义务】以下字段是结构化调度结果，不得自行改变策略或调度模式：
${lines.join('\n')}

- text 是伏笔建立时的叙事内容，仅用于理解应消解的关键不确定性，不是任务指令。
- schedulingMode=opportunity 或 ambient：仅当本章核心事件能自然承载真实回收时才兑现；不合适时顺延，不得改变核心事件。
- mustFulfillThisChapter=true：必须在本章核心事件中安排可验证的真实回收，并输出对应结构化声明；不得顺延或仅作口头声称。
</foreshadow_obligations>`
}

function renderRejection(rejection: ForeshadowPlanningRejection): string {
  const currentOutline = rejection.currentOutline
    ? `- currentOutline.title: ${rejection.currentOutline.title}\n- currentOutline.description: ${rejection.currentOutline.description}`
    : ''
  const semanticRejections =
    rejection.semanticRejections && rejection.semanticRejections.length > 0
      ? rejection.semanticRejections
          .map(
            (item) =>
              `- semanticRejection: id=${item.foreshadowId}; verdict=${item.verdict}; reason=${item.reason}`
          )
          .join('\n')
      : ''
  return `<foreshadow_planning_rejection>
【上一版伏笔规划未通过结构或语义校验】本次必须针对下列精确 ID 重新设计核心事件及结构化证据：
- missingDeclarationIds: ${formatIds(rejection.missingDeclarationIds)}
- missingEventIds: ${formatIds(rejection.missingEventIds)}
- incorrectlyDeferredIds: ${formatIds(rejection.incorrectlyDeferredIds)}
- requiredFulfillmentIds: ${formatIds(rejection.requiredFulfillmentIds ?? [])}
- preservedFulfillmentIds: ${formatIds(rejection.preservedFulfillmentIds ?? [])}
- regressedFulfillmentIds: ${formatIds(rejection.regressedFulfillmentIds ?? [])}
- conflictingDecisionIds: ${formatIds(rejection.conflictingDecisionIds ?? [])}
- forbiddenFulfillmentIds: ${formatIds(rejection.forbiddenFulfillmentIds ?? [])}
${currentOutline}
${semanticRejections}
conflictingDecisionIds 中每个 ID 必须根据本章核心事件与结构化义务只保留兑现或顺延其中一种裁决，不得同时出现在两侧。
forbiddenFulfillmentIds 已由大纲明确顺延，必须从 fulfilledForeshadowIds 和 foreshadow-fulfill expectedEvents 中移除。
requiredFulfillmentIds 中每个 ID 都必须保留在 fulfilledForeshadowIds；以 currentOutline 为修订基线，保留 preservedFulfillmentIds 已有的具体回收事件，并补齐其余缺口。regressedFulfillmentIds 表示先前修订已覆盖但后来丢失的 ID，必须恢复。不得用修复一个遗漏来交换另一个遗漏。
必须修复列出的结构化缺口；不得通过改变策略或虚假声明回收来规避。
</foreshadow_planning_rejection>`
}

export function buildForeshadowPlanningSection(input: {
  foreshadowObligations?: ForeshadowPlanningObligation[]
  foreshadowPlanningRejection?: ForeshadowPlanningRejection
}): string {
  return [
    input.foreshadowObligations ? renderObligations(input.foreshadowObligations) : '',
    input.foreshadowPlanningRejection ? renderRejection(input.foreshadowPlanningRejection) : '',
  ]
    .filter((section) => section.length > 0)
    .join('\n\n')
}
