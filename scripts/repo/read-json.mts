/**
 * @file Narrowing JSON readers.
 *   `JSON.parse` returns `any`, and casting that straight to a shape trips
 *   `typescript/no-unsafe-type-assertion` — correctly, because a malformed file
 *   would then flow through the program as a lie. These readers parse to
 *   `unknown` and narrow with a real predicate, so a bad file fails at the read
 *   with a message naming the file instead of somewhere downstream.
 */

import { readFileSync } from 'node:fs'

/**
 * True for a non-array, non-null object.
 */
export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * True for an array whose every element is a non-array object.
 */
export function isJsonObjectArray(
  value: unknown,
): value is Array<Record<string, unknown>> {
  return Array.isArray(value) && value.every(isJsonObject)
}

/**
 * Read and parse a JSON file, asserting the top level is an object.
 */
export function readJsonObjectFile(filePath: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'))
  if (!isJsonObject(parsed)) {
    throw new Error(
      `JSON file is not an object.\n` +
        `  where: ${filePath}\n` +
        `  saw:   ${Array.isArray(parsed) ? 'an array' : typeof parsed}\n` +
        `  wanted: a JSON object at the top level\n` +
        `  fix:   regenerate the file with pnpm run gen, or repair it by hand if ` +
        `it is a hand-authored config`,
    )
  }
  return parsed
}

/**
 * Read the `rules` array out of a generated table file, narrowed to objects.
 */
export function readTableRuleObjects(
  filePath: string,
): ReadonlyArray<Record<string, unknown>> {
  const root = readJsonObjectFile(filePath)
  const rules = root['rules']
  if (!isJsonObjectArray(rules)) {
    throw new Error(
      `Generated table has no "rules" array.\n` +
        `  where: ${filePath}\n` +
        `  saw:   rules = ${rules === undefined ? 'absent' : typeof rules}\n` +
        `  wanted: an array of rule objects\n` +
        `  fix:   pnpm run gen`,
    )
  }
  return rules
}

/**
 * Read a string property, or undefined when absent or the wrong type.
 */
export function readStringProp(
  source: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = source[key]
  return typeof value === 'string' ? value : undefined
}

/**
 * Read an array-of-strings property, defaulting to empty.
 */
export function readStringArrayProp(
  source: Record<string, unknown>,
  key: string,
): readonly string[] {
  const value = source[key]
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((item): item is string => typeof item === 'string')
}
