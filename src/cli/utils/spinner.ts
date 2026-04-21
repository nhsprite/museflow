const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

let interval: ReturnType<typeof setInterval> | null = null
let currentFrame = 0
let message = ''

export function startSpinner(msg: string): void {
  stopSpinner()
  currentFrame = 0
  message = msg
  process.stdout.write(`${frames[0]}${msg}`)
  interval = setInterval(() => {
    process.stdout.write('\r' + '\x1b[2K')
    currentFrame = (currentFrame + 1) % frames.length
    process.stdout.write(`${frames[currentFrame]}${message}`)
  }, 80)
}

export function stopSpinner(): void {
  if (interval) {
    clearInterval(interval)
    interval = null
    process.stdout.write('\r' + '\x1b[2K')
    process.stdout.write('✓ ' + message + '\n')
  }
}

export function stopSpinnerQuiet(): void {
  if (interval) {
    clearInterval(interval)
    interval = null
    process.stdout.write('\r' + '\x1b[2K')
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
    stopSpinnerQuiet()
    throw err
  }
}
