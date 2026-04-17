type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const RESET = '\x1b[0m'
const BLUE = '\x1b[34m'
const YELLOW = '\x1b[33m'
const RED = '\x1b[31m'

function formatTimestamp(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ')
}

function colorize(level: LogLevel): string {
  switch (level) {
    case 'debug': return BLUE
    case 'info':  return RESET
    case 'warn':  return YELLOW
    case 'error': return RED
  }
}

function log(level: LogLevel, prefix: string, message: string, ...args: unknown[]): void {
  const ts = formatTimestamp()
  const col = colorize(level)
  const prefixStr = prefix ? `[${prefix}] ` : ''
  const msg = args.length > 0 ? `${message} ${JSON.stringify(args)}` : message
  console.error(`${ts} ${col}[${level.toUpperCase()}]${RESET} ${prefixStr}${msg}`)
}

export const logger = {
  debug: (msg: string, ...args: unknown[]) => log('debug', 'MuseFlow', msg, ...args),
  info:  (msg: string, ...args: unknown[]) => log('info',  'MuseFlow', msg, ...args),
  warn:  (msg: string, ...args: unknown[]) => log('warn',  'MuseFlow', msg, ...args),
  error: (msg: string, ...args: unknown[]) => log('error', 'MuseFlow', msg, ...args),
}
