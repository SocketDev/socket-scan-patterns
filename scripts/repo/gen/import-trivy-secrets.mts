/**
 * @file Derives secret-detector rows from Trivy's built-in secret rules.
 *   Apache-2.0 — attribution is required and lives in `NOTICE`. Reads only
 *   `upstream/trivy/pkg/fanal/secret/builtin-rules.go`.
 *   Trivy composes most regexes at runtime via `fmt.Sprintf` over shared
 *   fragments (`quote`, `connect`, `endSecret`, …) declared as Go consts in
 *   the same file. The generator resolves those fragments from their `const`
 *   block and substitutes them, so the emitted `regexSource` is the pattern
 *   Trivy actually compiles rather than a format string a consumer could not
 *   use.
 */

import type { PatternRule, PatternSeverity } from './_shared/table-types.mts'
import type { DerivedRowSet } from './_shared/emit-table.mts'
import type { UpstreamSlice } from './_shared/upstream-slice.mts'

import { assertRowsPresent, writeSourceRowSet } from './_shared/emit-table.mts'
import {
  readSliceFile,
  resolveUpstreamSlice,
  sliceFilePath,
} from './_shared/upstream-slice.mts'

/**
 * Path of the derivation source inside the pinned slice.
 */
export const TRIVY_RULES_REL_PATH = 'pkg/fanal/secret/builtin-rules.go'

/**
 * Rows the upstream is known to carry at the pinned tag.
 */
export const TRIVY_MIN_EXPECTED_RULES = 90

/**
 * Map Trivy's uppercase severity vocabulary onto the table scale. Trivy has no
 * `INFO` tier for secrets; an unset severity falls back to `high` rather than
 * silently becoming the lowest tier.
 */
export function trivySeverityToPatternSeverity(
  raw: string | undefined,
): PatternSeverity {
  switch (raw?.toUpperCase()) {
    case 'CRITICAL':
      return 'critical'
    case 'HIGH':
      return 'high'
    case 'LOW':
      return 'low'
    case 'MEDIUM':
      return 'medium'
    default:
      return 'high'
  }
}

/**
 * Collect the backtick-quoted Go consts the rule regexes interpolate.
 */
export function readTrivyRegexFragments(
  source: string,
): ReadonlyMap<string, string> {
  const fragments = new Map<string, string>()
  // Matches a Go const line `Name = `value`` at any indent: capture 1 is the
  // identifier, capture 2 is the backtick-quoted raw-string body.
  const pattern = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*`([^`]*)`\s*$/gm
  let matched = pattern.exec(source)
  while (matched) {
    fragments.set(matched[1]!, matched[2]!)
    matched = pattern.exec(source)
  }
  return fragments
}

/**
 * Resolve the `Category<Name>` aliases to the string Trivy tags findings with.
 */
export function readTrivyCategories(
  source: string,
): ReadonlyMap<string, string> {
  const categories = new Map<string, string>()
  // Matches `CategoryFoo = types.SecretRuleCategory("Foo")`: capture 1 is the
  // Go alias the rule literals reference, capture 2 is the tag string Trivy
  // labels findings with.
  const pattern =
    /^\s*(Category[A-Za-z0-9_]*)\s*=\s*types\.SecretRuleCategory\("([^"]*)"\)/gm
  let matched = pattern.exec(source)
  while (matched) {
    categories.set(matched[1]!, matched[2]!)
    matched = pattern.exec(source)
  }
  return categories
}

/**
 * Turn a `MustCompile(...)` / `MustCompileWithoutWordPrefix(...)` argument into
 * a usable pattern string: unwrap the Sprintf, substitute the const fragments
 * in order, and strip the Go backticks.
 */
export function resolveTrivyRegex(
  expression: string,
  fragments: ReadonlyMap<string, string>,
): string | undefined {
  const sprintf = /^fmt\.Sprintf\(\s*`([\s\S]*?)`\s*,\s*([\s\S]*)\)$/.exec(
    expression.trim(),
  )
  if (sprintf) {
    const format = sprintf[1]!
    const args = sprintf[2]!
      .split(',')
      .map(arg => arg.trim())
      .filter(arg => arg.length > 0)
    let argIndex = 0
    return format.replace(/%s/g, () => {
      const name = args[argIndex]
      argIndex += 1
      if (!name) {
        return ''
      }
      return fragments.get(name) ?? ''
    })
  }
  const literal = /^`([\s\S]*)`$/.exec(expression.trim())
  if (literal) {
    return literal[1]
  }
  return undefined
}

/**
 * Read one `Field: value,` out of a Go struct literal body.
 */
export function readTrivyField(
  body: string,
  field: string,
): string | undefined {
  const matched = new RegExp(
    `^\\s*${field}:\\s*([\\s\\S]*?),?\\s*$(?=\\n\\s*(?:[A-Z][A-Za-z]*:|\\}))`,
    'm',
  ).exec(body)
  return matched?.[1]?.trim()
}

/**
 * Split `var builtinRules = []Rule{ … }` into per-rule struct bodies.
 */
export function splitTrivyRuleBodies(source: string): readonly string[] {
  const start = source.indexOf('var builtinRules = []Rule{')
  if (start === -1) {
    return []
  }
  const region = source.slice(start)
  const bodies: string[] = []
  const lines = region.split('\n')
  let current: string[] | undefined
  let depth = 0
  for (let i = 1, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (current === undefined) {
      if (/^\t\{\s*$/.test(line)) {
        current = []
        depth = 1
      } else if (line.startsWith('}')) {
        break
      }
      continue
    }
    depth += (line.match(/\{/g) ?? []).length
    depth -= (line.match(/\}/g) ?? []).length
    if (depth <= 0) {
      bodies.push(current.join('\n'))
      current = undefined
      continue
    }
    current.push(line)
  }
  return bodies
}

/**
 * Read a `Keywords: []string{"a", "b"}` list.
 */
export function readTrivyKeywords(body: string): readonly string[] {
  const matched = /Keywords:\s*\[\]string\{([\s\S]*?)\}/.exec(body)
  if (!matched) {
    return []
  }
  const items: string[] = []
  // Matches one double-quoted Go/TS string literal, capturing its body:
  // `"` then any run of (non-quote, non-backslash | escaped char), then `"`.
  const itemPattern = /"((?:[^"\\]|\\.)*)"/g
  let item = itemPattern.exec(matched[1]!)
  while (item) {
    items.push(item[1]!)
    item = itemPattern.exec(matched[1]!)
  }
  return items.toSorted()
}

/**
 * Parse the pinned Trivy rule source into rows.
 */
export function deriveTrivyRules(slice: UpstreamSlice): DerivedRowSet {
  const source = readSliceFile(slice, TRIVY_RULES_REL_PATH)
  const sourceFile = sliceFilePath(slice, TRIVY_RULES_REL_PATH)
  const fragments = readTrivyRegexFragments(source)
  const categories = readTrivyCategories(source)
  const bodies = splitTrivyRuleBodies(source)
  const rules: PatternRule[] = []

  for (let i = 0, { length } = bodies; i < length; i += 1) {
    const body = bodies[i]!
    const rawId = readTrivyField(body, 'ID')
    const id = rawId ? /^"([^"]*)"/.exec(rawId)?.[1] : undefined
    if (!id) {
      continue
    }
    const rawTitle = readTrivyField(body, 'Title')
    const title = rawTitle ? (/^"([^"]*)"/.exec(rawTitle)?.[1] ?? id) : id
    const rawSeverity = readTrivyField(body, 'Severity')
    const severity = trivySeverityToPatternSeverity(
      rawSeverity ? /^"([^"]*)"/.exec(rawSeverity)?.[1] : undefined,
    )
    const categoryAlias = readTrivyField(body, 'Category')
    const category = categoryAlias
      ? (categories.get(categoryAlias) ?? categoryAlias)
      : 'generic'

    const regexExpr = readTrivyField(body, 'Regex')
    const regexInner = regexExpr
      ? // Unwraps `MustCompile(<arg>)` / `MustCompileWithoutWordPrefix(<arg>)`,
        // capturing the whole argument expression (which may itself be a Sprintf).
        /^MustCompile(?:WithoutWordPrefix)?\(([\s\S]*)\)$/.exec(regexExpr)?.[1]
      : undefined
    const regexSource = regexInner
      ? resolveTrivyRegex(regexInner, fragments)
      : undefined

    const pathExpr = readTrivyField(body, 'Path')
    const pathInner = pathExpr
      ? // Same unwrap as above, for the Path: field's compiled expression.
        /^MustCompile(?:WithoutWordPrefix)?\(([\s\S]*)\)$/.exec(pathExpr)?.[1]
      : undefined
    const pathRegexSource = pathInner
      ? resolveTrivyRegex(pathInner, fragments)
      : undefined

    rules.push({
      category,
      description: title,
      entropy: undefined,
      id: `trivy:${id}`,
      keywords: readTrivyKeywords(body),
      kind: pathRegexSource ? 'path' : 'regex',
      pathRegexSource,
      provenance: {
        license: slice.license,
        ruleId: id,
        source: slice.source,
        sourceFile,
      },
      regexFlags: '',
      regexSource,
      severity,
      title,
    })
  }

  assertRowsPresent(rules, {
    generator: 'scripts/repo/gen/import-trivy-secrets.mts',
    sourceFile,
  })
  if (rules.length < TRIVY_MIN_EXPECTED_RULES) {
    throw new Error(
      `Trivy parse returned an implausibly small table.\n` +
        `  where: ${sourceFile}\n` +
        `  saw:   ${rules.length} rules\n` +
        `  wanted: at least ${TRIVY_MIN_EXPECTED_RULES}\n` +
        `  fix:   the []Rule literal shape changed at ${slice.source}. Update ` +
        `splitTrivyRuleBodies / readTrivyField in ` +
        `scripts/repo/gen/import-trivy-secrets.mts, then re-run pnpm run gen.`,
    )
  }
  return { rules, sources: [slice.source] }
}

/**
 * Generator entry point: derive and write `data/sources/trivy.json`.
 */
export function generateTrivySource(): DerivedRowSet {
  const slice = resolveUpstreamSlice('trivy')
  const rowSet = deriveTrivyRules(slice)
  writeSourceRowSet('trivy', rowSet)
  return rowSet
}
