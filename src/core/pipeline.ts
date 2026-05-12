import type { ReducedGraphState } from '../graph/state.js'

export interface PipelineNode {
  node: (state: ReducedGraphState) => Promise<Partial<ReducedGraphState>>
  label: string
  clearIssues?: boolean
}

export interface PipelineResult {
  state: ReducedGraphState
  hasErrors: boolean
  completedNodes: number
}

export async function runChapterPipeline(
  initialState: ReducedGraphState,
  nodes: PipelineNode[],
  options: {
    showProgress?: boolean
    breakOnErrors?: boolean
  } = {}
): Promise<PipelineResult> {
  const { showProgress = false, breakOnErrors = true } = options
  let state = initialState
  let hasErrors = false
  let completedNodes = 0

  let spinner: {
    startStepProgress: (steps: string[]) => void
    nextStep: (label: string) => void
    stopStepProgress: (msg?: string) => void
  } | null = null

  if (showProgress) {
    try {
      const spinnerModule = await import('../cli/utils/spinner.js')
      spinner = {
        startStepProgress: spinnerModule.startStepProgress,
        nextStep: spinnerModule.nextStep,
        stopStepProgress: spinnerModule.stopStepProgress,
      }
      spinner.startStepProgress(nodes.map(n => n.label))
    } catch {
    }
  }

  for (let i = 0; i < nodes.length; i++) {
    const { node, label, clearIssues } = nodes[i]!
    const partial = await node(state)
    state = { ...state, ...partial }

    if (clearIssues) {
      state = { ...state, pendingIssues: [] }
    }

    if (node.name === 'auto_fix_warnings') {
      const errors = state.pendingIssues.filter(i => i.severity === 'error')
      if (errors.length > 0) {
        if (spinner) {
          spinner.stopStepProgress(`检测到 ${errors.length} 个错误`)
        }
        for (const err of errors) {
          const icon = err.severity === 'error' ? '❌' : err.severity === 'warning' ? '⚠️' : 'ℹ️'
          console.error(`  ${icon} [${err.type}] ${err.description}`)
          if (err.location) {
            console.error(`     位置: ${err.location}`)
          }
        }
        hasErrors = true
        if (breakOnErrors) {
          completedNodes = i + 1
          break
        }
      }
    }

    if (spinner && i < nodes.length - 1) {
      spinner.nextStep(nodes[i + 1]!.label)
    }

    completedNodes = i + 1
  }

  if (spinner && !hasErrors) {
    spinner.stopStepProgress('质量检查通过')
  }

  return { state, hasErrors, completedNodes }
}
