export interface GenericVerifiedConstraint {
  kind: 'generic'
  /**
   * Stable structured identifier for regenerable constraints (e.g.
   * `foreshadow-boundary:<foreshadowId>`). Finalization rebuilds constraints by
   * ID instead of replacing the whole list, so cross-chapter constraints can
   * survive until they expire. Constraints without an id are kept as-is.
   */
  id?: string
  text: string
}

export interface ActPressureVerifiedConstraint {
  kind: 'act_pressure'
  actIndex: number
  text: string
}

export type VerifiedConstraint = GenericVerifiedConstraint | ActPressureVerifiedConstraint

export type VerifiedConstraintLike = string | VerifiedConstraint
