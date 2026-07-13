/**
 * Count Chinese characters plus English words.
 * 中文字符覆盖 CJK 基本区（U+4E00–U+9FFF）与扩展 A 区（U+3400–U+4DBF）。
 */
export function countChineseWords(text: string): number {
  const chineseChars = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) ?? []).length
  const englishWords = (text.match(/[a-zA-Z]+/g) ?? []).length
  return chineseChars + englishWords
}

/**
 * 将正文按空行切分为段落，过滤空段落与 Markdown 标题行。
 */
export function splitContentParagraphs(content: string): string[] {
  return content
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0 && !/^#{1,6}\s+/.test(paragraph))
}
