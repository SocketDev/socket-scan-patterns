/**
 * @file Deterministic table emission. Every generator funnels through here so
 *   two runs over the same pinned slice produce byte-identical JSON — that
 *   property is what makes the drift check meaningful.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
import path from 'node:path'

import type {
  PatternRule,
  PatternSeverity,
  PatternTable,
  ScannerName,
} from './table-types.mts'

import { PATTERN_TABLE_SCHEMA_VERSION } from './table-types.mts'
import { DATA_DIR, DATA_SOURCES_DIR } from '../../paths.mts'
import { readJsonObjectFile, readStringArrayProp } from '../../read-json.mts'

/**
 * Rows plus the sources they came from — what a generator hands back before
 * composition into a consumer table.
 */
export interface DerivedRowSet {
  readonly rules: readonly PatternRule[]
  readonly sources: readonly string[]
}

/**
 * Sort rules into a stable order: severity first (worst first), then id. Two
 * runs must agree, and an upstream reordering its own file must not churn the
 * table.
 */
export function sortPatternRules(
  rules: readonly PatternRule[],
): readonly PatternRule[] {
  const severityRank: Readonly<Record<PatternSeverity, number>> = {
    critical: 0,
    high: 1,
    info: 4,
    low: 3,
    medium: 2,
  }
  return [...rules].toSorted((a, b) => {
    const bySeverity = severityRank[a.severity] - severityRank[b.severity]
    if (bySeverity !== 0) {
      return bySeverity
    }
    return a.id.localeCompare(b.id)
  })
}

/**
 * Fail when a generator produced no rows. An empty table always means a
 * parser stopped matching an upstream that moved, and silently shipping it
 * would disable a whole scanner.
 */
export function assertRowsPresent(
  rules: readonly PatternRule[],
  context: { readonly generator: string; readonly sourceFile: string },
): void {
  if (rules.length === 0) {
    throw new Error(
      `Generator produced zero rows.\n` +
        `  where: ${context.generator}\n` +
        `  saw:   0 rules parsed from ${context.sourceFile}\n` +
        `  wanted: at least one rule\n` +
        `  fix:   the upstream almost certainly changed shape at its new pin. ` +
        `Read ${context.sourceFile} and update the parser in ${context.generator}. ` +
        `Do not hand-write the table.`,
    )
  }
}

/**
 * Fail on a duplicate rule id within a table. A duplicate means two upstreams
 * (or two categories) collided and one row would silently win at lookup time.
 */
export function assertRuleIdsUnique(
  rules: readonly PatternRule[],
  context: { readonly generator: string },
): void {
  const seen = new Set<string>()
  const duplicates: string[] = []
  for (let i = 0, { length } = rules; i < length; i += 1) {
    const { id } = rules[i]!
    if (seen.has(id)) {
      duplicates.push(id)
    }
    seen.add(id)
  }
  if (duplicates.length > 0) {
    throw new Error(
      `Duplicate rule ids in one table.\n` +
        `  where: ${context.generator}\n` +
        `  saw:   ${duplicates.slice(0, 5).join(', ')}` +
        `${duplicates.length > 5 ? ` (+${duplicates.length - 5} more)` : ''}\n` +
        `  wanted: every rule id unique within its table\n` +
        `  fix:   prefix the colliding rows with their upstream, e.g. ` +
        `"trivy:<id>", in the generator that emits them`,
    )
  }
}

/**
 * Serialize deterministically: 2-space JSON with a trailing newline, matching
 * what oxfmt would produce for a checked-in JSON file.
 */
export function serializePatternTable(table: PatternTable): string {
  return `${JSON.stringify(table, undefined, 2)}\n`
}

/**
 * Build a table from a row set.
 */
export function buildPatternTable(
  scanner: ScannerName,
  rowSet: DerivedRowSet,
): PatternTable {
  return {
    rules: sortPatternRules(rowSet.rules),
    scanner,
    schemaVersion: PATTERN_TABLE_SCHEMA_VERSION,
    sources: [...rowSet.sources].toSorted(),
  }
}

/**
 * Write a per-upstream derivation file under `data/sources/`.
 */
export function writeSourceRowSet(name: string, rowSet: DerivedRowSet): string {
  mkdirSync(DATA_SOURCES_DIR, { recursive: true })
  const outPath = path.join(DATA_SOURCES_DIR, `${name}.json`)
  const payload = {
    rules: sortPatternRules(rowSet.rules),
    schemaVersion: PATTERN_TABLE_SCHEMA_VERSION,
    sources: [...rowSet.sources].toSorted(),
  }
  writeFileSync(outPath, `${JSON.stringify(payload, undefined, 2)}\n`, 'utf8')
  return outPath
}

/**
 * Read a per-upstream derivation file back. Composition reads these rather
 * than re-running the generators, so composing never needs the slices on disk.
 */
export function readSourceRowSet(name: string): DerivedRowSet {
  const inPath = path.join(DATA_SOURCES_DIR, `${name}.json`)
  if (!existsSync(inPath)) {
    throw new Error(
      `Derived source file missing.\n` +
        `  where: ${inPath}\n` +
        `  saw:   no such file\n` +
        `  wanted: the ${name} generator's output\n` +
        `  fix:   pnpm run gen`,
    )
  }
  const root = readJsonObjectFile(inPath)
  const rules = root['rules']
  const sources = readStringArrayProp(root, 'sources')
  if (!Array.isArray(rules)) {
    throw new Error(
      `Derived source file has no "rules" array.\n` +
        `  where: ${inPath}\n` +
        `  saw:   rules = ${rules === undefined ? 'absent' : typeof rules}\n` +
        `  wanted: an array of rule objects\n` +
        `  fix:   pnpm run gen`,
    )
  }
  // The generators are the only writers and they emit PatternRule shapes; the
  // structural check above is what makes this narrowing sound.
  return { rules: rules as readonly PatternRule[], sources }
}

/**
 * Write one of the five consumer tables under `data/`.
 */
export function writeScannerTable(
  scanner: ScannerName,
  fileName: string,
  rowSet: DerivedRowSet,
): string {
  mkdirSync(DATA_DIR, { recursive: true })
  const table = buildPatternTable(scanner, rowSet)
  assertRuleIdsUnique(table.rules, { generator: `compose:${scanner}` })
  const outPath = path.join(DATA_DIR, fileName)
  writeFileSync(outPath, serializePatternTable(table), 'utf8')
  return outPath
}
