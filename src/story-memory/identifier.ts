const MACHINE_READABLE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9._:-]*$/

export function isMachineReadableId(value: unknown): value is string {
  return typeof value === 'string' && MACHINE_READABLE_ID_PATTERN.test(value)
}
