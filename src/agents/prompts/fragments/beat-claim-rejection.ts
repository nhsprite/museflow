import type { BeatClaimPlanningRejection } from '../../types.js'

function renderRejection(rejection: BeatClaimPlanningRejection): string {
  const rejectedClaims = rejection.rejectedClaims
    .map(
      (claim) => `- rejectedClaim: id=${claim.beatId}; beat=${claim.beat}; reason=${claim.reason}`
    )
    .join('\n')
  const currentOutline = rejection.currentOutline
    ? `- currentOutline.title: ${rejection.currentOutline.title}\n- currentOutline.description: ${rejection.currentOutline.description}`
    : ''
  return `<beat_claim_rejection>
【上一版节拍认领未通过语义校验】下列节拍 ID 的认领在 description 中没有对应的具体事件支撑：
${rejectedClaims}
${currentOutline}
对每个被驳回的 ID 必须二选一：以 currentOutline 为修订基线，在 description 中明确写出实质推进该节拍的可观察事件（行动、揭示、决定或后果）；或从 claimedMandatoryBeatIds / claimedBeatIds 中移除该 ID。
不得仅保留认领标签而维持原有 description；也不得为通过校验而在 description 中口头声称"节拍已完成"而不写具体事件。
</beat_claim_rejection>`
}

export function buildBeatClaimRejectionSection(input: {
  beatClaimRejection?: BeatClaimPlanningRejection
}): string {
  return input.beatClaimRejection ? renderRejection(input.beatClaimRejection) : ''
}
