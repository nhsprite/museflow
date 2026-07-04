interface ParsedJson<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

export function repairMalformedJson(raw: string): string {
  return raw
    .replace(/```json?/g, '')
    .replace(/```/g, '')
    .replace(/([{,]\s*)([a-zA-Z_]\w*)(\s*:)/g, '$1"$2"$3')
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/'([^']*)'/g, '"$1"')
}

export function extractJsonBlock(raw: string): string {
  const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (codeBlockMatch) {
    return codeBlockMatch[1]!.trim()
  }
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  return jsonMatch ? jsonMatch[0] : raw.trim()
}

function findJsonBoundaries(text: string): { start: number; end: number } | null {
  let firstBrace: number | null = null
  let firstBracket: number | null = null

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '{' && firstBrace === null) {
      firstBrace = i
    } else if (ch === '[' && firstBracket === null) {
      firstBracket = i
    }
    if (firstBrace !== null && firstBracket !== null) break
  }

  if (firstBrace === null && firstBracket === null) return null

  const start =
    firstBrace !== null && firstBracket !== null
      ? Math.min(firstBrace, firstBracket)
      : (firstBrace ?? firstBracket!)
  const openChar = text[start]
  const closeChar = openChar === '{' ? '}' : ']'

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (ch === '\\') {
      escaped = true
      continue
    }
    if (ch === '"' && !inString) {
      inString = true
    } else if (ch === '"' && inString) {
      inString = false
    } else if (!inString) {
      if (ch === openChar) depth++
      else if (ch === closeChar) {
        depth--
        if (depth === 0) {
          return { start, end: i + 1 }
        }
      }
    }
  }

  return null
}

function escapeInnerQuotes(json: string): string {
  let result = ''
  let inString = false
  let escaped = false

  const escapeControlChar = (char: string): string => {
    switch (char) {
      case '\b':
        return '\\b'
      case '\f':
        return '\\f'
      case '\n':
        return '\\n'
      case '\r':
        return '\\r'
      case '\t':
        return '\\t'
      case '\v':
        return '\\u000b'
      default:
        return '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0')
    }
  }

  const peekNextNonSpace = (from: number): string | undefined => {
    let j = from
    while (j < json.length && /\s/.test(json[j]!)) j++
    return json[j]
  }

  const isStringBoundary = (nextChar: string | undefined): boolean =>
    nextChar === undefined || [':', ',', '}', ']'].includes(nextChar)

  for (let i = 0; i < json.length; i++) {
    const char = json[i]!
    const code = char.charCodeAt(0)

    if (inString) {
      if (escaped) {
        escaped = false
        result += char
      } else if (char === '\\') {
        escaped = true
        result += char
      } else if (char === '"') {
        const nextChar = peekNextNonSpace(i + 1)
        if (isStringBoundary(nextChar)) {
          inString = false
          result += char
        } else {
          result += '\\"'
        }
      } else if (char === "'") {
        const nextChar = peekNextNonSpace(i + 1)
        if (isStringBoundary(nextChar)) {
          inString = false
          result += '"'
        } else {
          result += char
        }
      } else if (code <= 0x1f || code === 0x7f) {
        result += escapeControlChar(char)
      } else {
        result += char
      }
    } else {
      if (char === '"') {
        inString = true
        result += char
      } else {
        result += char
      }
    }
  }

  return result
}

function repairJson(text: string): string {
  let repaired = text
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/([{,])\s*([a-zA-Z_\u4e00-\u9fa5][a-zA-Z0-9_\u4e00-\u9fa5]*)\s*:/g, '$1"$2":')

  repaired = repaired.replace(/'([^'\n]*?)'/g, '"$1"')
  repaired = repaired.replace(/\/\/.*$/gm, '')
  repaired = repaired.replace(/\/\*[\s\S]*?\*\//g, '')
  repaired = repaired.replace(/}(\s*){/g, '},$1{')
  repaired = repaired.replace(/](\s*)\[/g, '],$1[')
  repaired = repaired.replace(/"(\s*){/g, '",$1{')
  repaired = repaired.replace(/}(\s*)"/g, '},$1"')
  repaired = repaired.replace(/: undefined/g, ': null')
  repaired = repaired.replace(/: undefined,/g, ': null,')
  repaired = escapeInnerQuotes(repaired)

  return repaired
}

export function parseJsonFromLLM<T = unknown>(content: string): ParsedJson<T> {
  const trimmed = content.trim()

  try {
    const data = JSON.parse(trimmed) as T
    return { success: true, data }
  } catch {
    // ignore raw parse failure
  }

  const codeBlock = extractJsonBlock(trimmed)
  if (codeBlock !== trimmed) {
    try {
      const data = JSON.parse(codeBlock) as T
      return { success: true, data }
    } catch {
      try {
        const data = JSON.parse(repairJson(codeBlock)) as T
        return { success: true, data }
      } catch {
        // ignore code block parse failure
      }
    }
  }

  const boundaries = findJsonBoundaries(trimmed)
  if (boundaries) {
    const slice = trimmed.slice(boundaries.start, boundaries.end)
    try {
      const data = JSON.parse(slice) as T
      return { success: true, data }
    } catch {
      try {
        const data = JSON.parse(repairJson(slice)) as T
        return { success: true, data }
      } catch {
        // fall through
      }
    }
  }

  try {
    const data = JSON.parse(repairJson(trimmed)) as T
    return { success: true, data }
  } catch {
    // fall through
  }

  try {
    const data = JSON.parse(repairMalformedJson(trimmed)) as T
    return { success: true, data }
  } catch {
    return { success: false, error: '无法解析 JSON 数据：未找到有效的 JSON 格式' }
  }
}
