import ora, { type Ora } from 'ora'

let spinner: Ora | null = null

export function startSpinner(msg: string): void {
  stopSpinnerQuiet()
  spinner = ora({ text: msg, color: 'cyan', spinner: 'dots' }).start()
}

export function stopSpinner(): void {
  if (spinner) {
    spinner.succeed(spinner.text)
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
  fn: () => Promise<T>
): Promise<T> {
  startSpinner(msg)
  try {
    const result = await fn()
    stopSpinner()
    return result
  } catch (err) {
    if (spinner) {
      spinner.fail(`${spinner.text}: ${err instanceof Error ? err.message : String(err)}`)
      spinner = null
    }
    throw err
  }
}
