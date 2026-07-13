import { createInterface } from 'node:readline'

/**
 * 向终端输出提示并读取一行用户输入（去除首尾空白）。
 */
export function question(message: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    })
    rl.question(message, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}
