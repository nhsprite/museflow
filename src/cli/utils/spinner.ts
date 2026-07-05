import ora, { type Ora } from 'ora'

let spinner: Ora | null = null

function startSpinner(msg: string): void {
  stopSpinnerQuiet()
  spinner = ora({ text: msg, color: 'cyan', spinner: 'dots' }).start()
}

function stopSpinner(msg?: string): void {
  if (spinner) {
    spinner.succeed(msg ?? spinner.text)
    spinner = null
  }
}

function stopSpinnerQuiet(): void {
  if (spinner) {
    spinner.stop()
    spinner = null
  }
}

export async function withSpinner<T>(
  msg: string,
  fn: () => Promise<T>,
  successMsg?: string,
  shouldSucceed?: (result: T) => boolean
): Promise<T> {
  startSpinner(msg)
  try {
    const result = await fn()
    const isSuccess = !shouldSucceed || shouldSucceed(result)
    if (isSuccess) {
      stopSpinner(successMsg)
    } else {
      stopSpinnerQuiet()
      ora().fail(msg)
    }
    return result
  } catch (err) {
    if (spinner) {
      spinner.fail(`${spinner.text}: ${err instanceof Error ? err.message : String(err)}`)
      spinner = null
    }
    throw err
  }
}
