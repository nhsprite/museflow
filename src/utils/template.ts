function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Simple variable-interpolation template renderer.
 *
 * Replaces every occurrence of `{VAR_NAME}` with the string value of the
 * corresponding variable. Missing variables are left untouched.
 */
export function renderTemplate(
  template: string,
  variables: Record<string, string | number>
): string {
  let result = template
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{${escapeRegExp(key)}\\}`, 'g'), String(value))
  }
  return result
}
