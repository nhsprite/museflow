import type { BeatClaimPlanningRejection } from '../../types.js'

function renderRequiredClaims(
  requiredClaims: NonNullable<BeatClaimPlanningRejection['requiredClaims']>
): string {
  const pending = requiredClaims.pendingMandatoryBeats
    .map((claim) => `- pendingMandatoryBeat: id=${claim.beatId}; beat=${claim.beat}`)
    .join('\n')
  return `【幕边界高压 - 零认领打回】本幕只剩 ${requiredClaims.chaptersRemainingInAct} 章结束，未消费的 mandatory beats 已多于剩余章数，上一版大纲却未认领任何 mandatory beat：
${pending}
本轮必须在 claimedMandatoryBeatIds 中认领上述至少 1 个节拍（不得超出节拍预算），并在 description 中写出该节拍所述事件本身在本章实际发生（行动、揭示、决定或后果）；仅写开端、铺垫或阶段性进展视为未兑现认领，不得再输出保持原状、无事件推进的过渡章。`
}

function renderRejection(rejection: BeatClaimPlanningRejection): string {
  const sections: string[] = []
  if (rejection.requiredClaims) {
    sections.push(renderRequiredClaims(rejection.requiredClaims))
  }
  if (rejection.rejectedClaims.length > 0) {
    const rejectedClaims = rejection.rejectedClaims
      .map(
        (claim) => `- rejectedClaim: id=${claim.beatId}; beat=${claim.beat}; reason=${claim.reason}`
      )
      .join('\n')
    sections.push(`【上一版节拍认领未通过语义校验】下列节拍 ID 的认领在 description 中没有对应的具体事件支撑：
${rejectedClaims}
对每个被驳回的 ID 必须二选一：以 currentOutline 为修订基线，在 description 中明确写出该节拍所述事件本身在本章实际发生（行动、揭示、决定或后果）；或从 claimedMandatoryBeatIds / claimedBeatIds 中移除该 ID。
不得仅保留认领标签而维持原有 description；也不得为通过校验而在 description 中口头声称"节拍已完成"而不写具体事件；以角色确认进展的对话或神态描写替代节拍事件场景，同样不予通过。`)
  }
  const currentOutline = rejection.currentOutline
    ? `- currentOutline.title: ${rejection.currentOutline.title}\n- currentOutline.description: ${rejection.currentOutline.description}`
    : ''
  return `<beat_claim_rejection>
${sections.join('\n')}
${currentOutline}
</beat_claim_rejection>`
}

export function buildBeatClaimRejectionSection(input: {
  beatClaimRejection?: BeatClaimPlanningRejection
}): string {
  return input.beatClaimRejection ? renderRejection(input.beatClaimRejection) : ''
}
