import ora, { type Ora } from 'ora'

let spinner: Ora | null = null
let stepSpinner: Ora | null = null
let stepIndex = 0
let stepTotal = 0

export function startSpinner(msg: string): void {
  stopSpinnerQuiet()
  spinner = ora({ text: msg, color: 'cyan', spinner: 'dots' }).start()
}

export function stopSpinner(msg?: string): void {
  if (spinner) {
    spinner.succeed(msg ?? spinner.text)
    spinner = null
  }
}

export function stopSpinnerQuiet(): void {
  if (spinner) {
    spinner.stop()
    spinner = null
  }
}

export async function withSpinner<T>(
  msg: string,
  fn: () => Promise<T>,
  successMsg?: string
): Promise<T> {
  startSpinner(msg)
  try {
    const result = await fn()
    stopSpinner(successMsg)
    return result
  } catch (err) {
    if (spinner) {
      spinner.fail(`${spinner.text}: ${err instanceof Error ? err.message : String(err)}`)
      spinner = null
    }
    throw err
  }
}

/** Start a multi-step progress spinner. */
export function startStepProgress(steps: string[]): void {
  stopStepProgressQuiet()
  stepIndex = 0
  stepTotal = steps.length
  stepSpinner = ora({ text: formatStep(1, steps[0] ?? ''), color: 'cyan', spinner: 'dots' }).start()
}

/** Advance to the next step with a new label. */
export function nextStep(label: string): void {
  if (stepSpinner) {
    stepIndex++
    stepSpinner.text = formatStep(stepIndex, label)
  }
}

/** Stop the step spinner with an optional success message. */
export function stopStepProgress(successMsg?: string): void {
  if (stepSpinner) {
    if (successMsg) {
      stepSpinner.succeed(successMsg)
    } else {
      stepSpinner.stop()
    }
    stepSpinner = null
  }
}

/** Stop the step spinner without any status icon. */
export function stopStepProgressQuiet(): void {
  if (stepSpinner) {
    stepSpinner.stop()
    stepSpinner = null
  }
}

function formatStep(current: number, label: string): string {
  return `[${current}/${stepTotal}] ${label}`
}
