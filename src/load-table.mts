/**
 * @file Loads a generated table off disk and validates its shape.
 *   Tables ship as JSON so socket-cli can inline them at build time and the
 *   sauce composite actions can read them without a bundler. Loading them
 *   through this module rather than a bare import means a table written by an
 *   older (or newer) generator fails at load with a message naming the file,
 *   instead of surfacing as an undefined property inside a scan.
 */

import { createRequire } from 'node:module'

import type { PatternRule, PatternTable, ScannerName } from './types.mts'

import { PATTERN_TABLE_SCHEMA_VERSION } from './types.mts'

const requireJson = createRequire(import.meta.url)

/**
 * Data file backing each scanner table.
 */
export const TABLE_FILE_BY_SCANNER: Readonly<Record<ScannerName, string>> = {
  agentConfigs: '../data/agent-configs.json',
  manifests: '../data/manifests.json',
  secrets: '../data/secrets.json',
  skills: '../data/skills.json',
  workflows: '../data/workflows.json',
}

/**
 * Compile a rule's path-scoping pattern, when it has one.
 */
export function compileRulePathRegex(rule: PatternRule): RegExp | undefined {
  if (rule.dialect !== 'js' || !rule.pathRegexSource) {
    return undefined
  }
  return new RegExp(rule.pathRegexSource, rule.regexFlags)
}

/**
 * Compile a rule's content pattern.
 *
 * Returns `undefined` for a rule with no content pattern (an `audit` or
 * `capability` row) and for a `re2` row, which by definition does not compile
 * under JavaScript. Callers that need full coverage should route `re2` rows to
 * an RE2-class engine rather than treating the `undefined` as "no rule".
 */
export function compileRuleRegex(rule: PatternRule): RegExp | undefined {
  if (rule.dialect !== 'js' || !rule.regexSource) {
    return undefined
  }
  return new RegExp(rule.regexSource, rule.regexFlags)
}

/**
 * Look one rule up by id.
 */
export function findRuleById(
  table: PatternTable,
  id: string,
): PatternRule | undefined {
  return table.rules.find(rule => rule.id === id)
}

/**
 * True when a value has the shape of a loadable table.
 */
export function isPatternTable(value: unknown): value is PatternTable {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Partial<PatternTable>
  return (
    Array.isArray(candidate.rules) &&
    Array.isArray(candidate.sources) &&
    typeof candidate.scanner === 'string' &&
    typeof candidate.schemaVersion === 'number'
  )
}

/**
 * Load one scanner's table.
 */
export function loadPatternTable(scanner: ScannerName): PatternTable {
  const relPath = TABLE_FILE_BY_SCANNER[scanner]
  const loaded: unknown = requireJson(relPath)
  if (!isPatternTable(loaded)) {
    throw new Error(
      `Detector table is malformed.\n` +
        `  where: ${relPath} (scanner: ${scanner})\n` +
        `  saw:   a value without rules/sources/scanner/schemaVersion\n` +
        `  wanted: a PatternTable\n` +
        `  fix:   regenerate with \`pnpm run gen\` in @socketsecurity/scan-patterns`,
    )
  }
  if (loaded.schemaVersion !== PATTERN_TABLE_SCHEMA_VERSION) {
    throw new Error(
      `Detector table schema version mismatch.\n` +
        `  where: ${relPath} (scanner: ${scanner})\n` +
        `  saw:   schemaVersion ${loaded.schemaVersion}\n` +
        `  wanted: ${PATTERN_TABLE_SCHEMA_VERSION}\n` +
        `  fix:   upgrade @socketsecurity/scan-patterns to a release whose ` +
        `schemaVersion matches, or regenerate the table`,
    )
  }
  return loaded
}

/**
 * Rules from a table that compile under JavaScript.
 */
export function selectJsCompilableRules(
  table: PatternTable,
): readonly PatternRule[] {
  return table.rules.filter(rule => rule.dialect === 'js')
}
