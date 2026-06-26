import type { Conflict, ConflictType, ConflictSeverity } from '../../types/story-state.js'

const BLOCKING_DESCRIPTION_PATTERNS = [
  /(?:死|亡|被杀|遇害|身亡|去世|离世|毙命).*(?:出现|登场|现身|说话|行动)/u,
  /(?:出现|登场|现身|说话|行动).*(?:死|亡|被杀|遇害|身亡|去世|离世|毙命)/u,
  /已揭示.*未揭示|已暴露.*隐藏|已公开.*保密/u,
]

function detectContradiction(conflict: Conflict): boolean {
  if (BLOCKING_DESCRIPTION_PATTERNS.some(pattern => pattern.test(conflict.description))) {
    return true
  }
  if (conflict.type === 'contradiction') {
    return true
  }
  return false
}

export function classifyConflict(conflict: Conflict): Conflict {
  if (detectContradiction(conflict)) {
    return {
      ...conflict,
      type: 'contradiction',
      severity: 'blocking',
    }
  }

  let severity: ConflictSeverity = conflict.severity
  let type: ConflictType = conflict.type

  if (conflict.attribute === '所在位置') {
    type = 'retcon'
    severity = 'auto'
  } else if (conflict.attribute === '状态') {
    type = 'retcon'
    severity = conflict.severity === 'blocking' ? 'blocking' : 'warning'
  } else if (conflict.type === 'time_jump') {
    severity = 'auto'
  }

  return {
    ...conflict,
    type,
    severity,
  }
}

export function classifyConflicts(conflicts: Conflict[]): Conflict[] {
  return conflicts.map(classifyConflict)
}
