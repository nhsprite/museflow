export interface GenericVerifiedConstraint {
  kind: 'generic'
  text: string
}

export interface ActPressureVerifiedConstraint {
  kind: 'act_pressure'
  actIndex: number
  text: string
}

export type VerifiedConstraint = GenericVerifiedConstraint | ActPressureVerifiedConstraint

export type VerifiedConstraintLike = string | VerifiedConstraint
