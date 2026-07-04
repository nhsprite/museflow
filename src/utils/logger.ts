import { mkdirSync, appendFileSync } from 'node:fs'
import { expandPath } from './paths.js'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const RESET = '\x1b[0m'
const BLUE = '\x1b[34m'
const YELLOW = '\x1b[33m'
const RED = '\x1b[31m'

let debugEnabled = false

export function setDebugEnabled(enabled: boolean): void {
  debugEnabled = enabled
}

export function isDebugEnabled(): boolean {
  return debugEnabled || process.env.MUSEFLOW_DEBUG === '1'
}

function formatTimestamp(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ')
}

function colorize(level: LogLevel): string {
  switch (level) {
    case 'debug':
      return BLUE
    case 'info':
      return RESET
    case 'warn':
      return YELLOW
    case 'error':
      return RED
  }
}

function formatArg(arg: unknown): string {
  if (arg instanceof Error) {
    return arg.stack ?? arg.message ?? String(arg)
  }
  try {
    return JSON.stringify(arg)
  } catch {
    return String(arg)
  }
}

function log(level: LogLevel, prefix: string, message: string, ...args: unknown[]): void {
  if (level === 'debug' && !isDebugEnabled()) return
  const ts = formatTimestamp()
  const col = colorize(level)
  const prefixStr = prefix ? `[${prefix}] ` : ''
  // 避免消息本身已带 [MuseFlow] 前缀导致重复
  const cleanMessage = message.replace(/^\[MuseFlow\]\s*/, '')
  const msg = args.length > 0 ? `${cleanMessage} ${args.map(formatArg).join(' ')}` : cleanMessage
  console.error(`${ts} ${col}[${level.toUpperCase()}]${RESET} ${prefixStr}${msg}`)
}

export function logDebugToFile(data: unknown): void {
  if (!isDebugEnabled()) return
  const debugDir = expandPath('./.museflow/debug')
  mkdirSync(debugDir, { recursive: true })
  const filePath = `${debugDir}/sessions.jsonl`
  appendFileSync(filePath, JSON.stringify(data) + '\n')
}

export const logger = {
  debug: (msg: string, ...args: unknown[]) => log('debug', 'MuseFlow', msg, ...args),
  info: (msg: string, ...args: unknown[]) => log('info', 'MuseFlow', msg, ...args),
  warn: (msg: string, ...args: unknown[]) => log('warn', 'MuseFlow', msg, ...args),
  error: (msg: string, ...args: unknown[]) => log('error', 'MuseFlow', msg, ...args),
}
