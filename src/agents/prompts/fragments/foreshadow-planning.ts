import type { ForeshadowPlanningObligation, ForeshadowPlanningRejection } from '../../types.js'

function formatIds(ids: readonly string[]): string {
  return ids.length > 0 ? ids.join(', ') : '（无）'
}

function renderObligations(obligations: readonly ForeshadowPlanningObligation[]): string {
  if (obligations.length === 0) return ''

  const lines = obligations.map(
    (obligation) =>
      `- id=${obligation.id}; resolutionPolicy=${obligation.resolutionPolicy}; deadlineChapter=${obligation.deadlineChapter ?? 'null'}; schedulingMode=${obligation.schedulingMode}; mustFulfillThisChapter=${String(obligation.mustFulfillThisChapter)}`
  )
  return `<foreshadow_obligations>
【本章伏笔规划义务】以下字段是结构化调度结果，不得自行改变策略或调度模式：
${lines.join('\n')}

- schedulingMode=opportunity 或 ambient：仅当本章核心事件能自然承载真实回收时才兑现；不合适时顺延，不得改变核心事件。
- mustFulfillThisChapter=true：必须在本章核心事件中安排可验证的真实回收，并输出对应结构化声明；不得顺延或仅作口头声称。
</foreshadow_obligations>`
}

function renderRejection(rejection: ForeshadowPlanningRejection): string {
  return `<foreshadow_planning_rejection>
【上一版伏笔规划未通过结构校验】本次必须针对下列精确 ID 重新设计核心事件及结构化证据：
- missingDeclarationIds: ${formatIds(rejection.missingDeclarationIds)}
- missingEventIds: ${formatIds(rejection.missingEventIds)}
- incorrectlyDeferredIds: ${formatIds(rejection.incorrectlyDeferredIds)}
必须修复列出的结构化缺口；不得通过删除义务、改变策略或虚假声明回收来规避。
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
