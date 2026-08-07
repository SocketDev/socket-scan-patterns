/**
 * @file Derives agent-skill scanning rows from NVIDIA SkillSpector's static
 *   analyzers. Apache-2.0 — attribution is required and lives in `NOTICE`.
 *   Reads only `upstream/skillspector/src/skillspector/nodes/analyzers/`.
 *   SkillSpector is the real pattern corpus for AI-agent skill security: each
 *   `static_patterns_<category>.py` module declares groups of
 *   `(<regex>, <confidence>)` tuples keyed by a finding code (`P1`, `E3`,
 *   `SC2`, …), and `pattern_defaults.py` maps each code to the explanation of
 *   why the finding matters. Together those give a fully provenanced row.
 *   Groups whose name starts with `_` (`_SAFE_DOCKERFILE_PATTERNS`) are
 *   upstream ALLOWLISTS used to suppress findings, not detectors, so they are
 *   skipped — importing them as detectors would invert their meaning.
 *   The `yara_rules` tree is deliberately outside the pinned sparse-checkout
 *   and is not derived from.
 */

import { readdirSync } from 'node:fs'
import path from 'node:path'

import type { DerivedRowSet } from './_shared/emit-table.mts'
import type { PatternRule, PatternSeverity } from './_shared/table-types.mts'
import type { UpstreamSlice } from './_shared/upstream-slice.mts'

import { isDeclaredDivergence } from './_shared/divergence.mts'
import { assertRowsPresent, writeSourceRowSet } from './_shared/emit-table.mts'
import {
  mergeRegexFlags,
  translateRegexForJs,
} from './_shared/regex-dialect.mts'
import {
  readSliceFile,
  resolveUpstreamSlice,
  sliceFilePath,
} from './_shared/upstream-slice.mts'

/**
 * Analyzer directory inside the pinned slice.
 */
export const SKILLSPECTOR_ANALYZERS_REL_DIR = 'src/skillspector/nodes/analyzers'

/**
 * Module holding the finding-code explanations.
 */
export const SKILLSPECTOR_DEFAULTS_MODULE = 'pattern_defaults.py'

/**
 * Rows the upstream is known to carry at the pinned tag.
 */
export const SKILLSPECTOR_MIN_EXPECTED_RULES = 380

/**
 * Map an upstream confidence weight onto the table severity scale.
 *
 * SkillSpector's second tuple element is the analyzer's confidence that a
 * match is a true positive, which is the only per-pattern signal it carries.
 * The bands below keep that ordering intact rather than inventing a severity
 * the upstream never stated.
 */
export function skillSpectorSeverity(confidence: number): PatternSeverity {
  if (confidence >= 0.9) {
    return 'critical'
  }
  if (confidence >= 0.75) {
    return 'high'
  }
  if (confidence >= 0.5) {
    return 'medium'
  }
  return 'low'
}

/**
 * `static_patterns_prompt_injection.py` → `prompt-injection`.
 */
export function skillSpectorCategoryFromModule(moduleName: string): string {
  return moduleName
    .replace(/^static_patterns_/, '')
    .replace(/\.py$/, '')
    .replace(/_/g, '-')
}

/**
 * Read the `re.*` flags an analyzer passes at match time. SkillSpector keeps
 * flags in the `re.finditer(pattern, content, re.IGNORECASE | re.MULTILINE)`
 * call rather than in the pattern, so a row built from the literal alone would
 * silently match case-sensitively when upstream does not.
 */
export function parseSkillSpectorModuleFlags(source: string): string {
  let flags = ''
  // Upstream is a pinned Python module with no importable typed export;
  // reading its re.* constants is the only way to recover match flags.
  // oxlint-disable-next-line socket/no-source-sniffing -- pinned Python source
  if (source.includes('re.IGNORECASE')) {
    flags += 'i'
  }
  // oxlint-disable-next-line socket/no-source-sniffing -- pinned Python source
  if (source.includes('re.MULTILINE')) {
    flags += 'm'
  }
  // oxlint-disable-next-line socket/no-source-sniffing -- pinned Python source
  if (source.includes('re.DOTALL')) {
    flags += 's'
  }
  return flags
}

/**
 * One `(regex, confidence)` tuple with the group code that owns it.
 */
export interface SkillSpectorPattern {
  readonly code: string
  readonly confidence: number
  readonly source: string
}

/**
 * Read `DEFAULT_EXPLANATIONS = { "P1": "…", … }` from `pattern_defaults.py`.
 */
export function parseSkillSpectorExplanations(
  source: string,
): ReadonlyMap<string, string> {
  const explanations = new Map<string, string>()
  const blockStart = source.indexOf('DEFAULT_EXPLANATIONS')
  if (blockStart === -1) {
    return explanations
  }
  const block = source.slice(blockStart)
  // Matches one `"CODE": "text",` entry: capture 1 is the finding code,
  // capture 2 is the explanation body (allowing escaped quotes).
  const pattern = /"([A-Z]{1,3}\d{1,2})":\s*"((?:[^"\\]|\\.)*)"/g
  let matched = pattern.exec(block)
  while (matched) {
    explanations.set(matched[1]!, unescapePythonString(matched[2]!))
    matched = pattern.exec(block)
  }
  return explanations
}

/**
 * Undo escaping in a Python double-quoted string.
 */
export function unescapePythonString(raw: string): string {
  return raw
    .replace(/\\n/g, ' ')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Extract every detector pattern from one analyzer module.
 */
export function parseSkillSpectorPatterns(
  source: string,
): readonly SkillSpectorPattern[] {
  const patterns: SkillSpectorPattern[] = []
  // Matches a group assignment `CODE_PATTERNS = [ … ]` at module scope:
  // capture 1 is the finding code, capture 2 is the bracketed body. A leading
  // underscore is excluded by the character class — those groups are upstream
  // allowlists, not detectors.
  const groupPattern = /^([A-Z][A-Z0-9]*)_PATTERNS\s*=\s*\[([\s\S]*?)^\]/gm
  let group = groupPattern.exec(source)
  while (group) {
    const code = group[1]!
    const body = group[2]!
    // Matches one `(r"regex", 0.8)` tuple, single- or double-quoted: capture 1
    // and 2 are the two quote styles, capture 3 is the confidence weight. The
    // optional trailing comma before `)` is load-bearing — upstream wraps long
    // tuples across lines and black adds a trailing comma, so omitting it here
    // silently drops every multi-line pattern.
    const tuplePattern =
      /\(\s*r(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')\s*,\s*([0-9.]+)\s*,?\s*\)/g
    let tuple = tuplePattern.exec(body)
    while (tuple) {
      const regexSource = tuple[1] ?? tuple[2]
      if (regexSource !== undefined && regexSource.length > 0) {
        patterns.push({
          code,
          confidence: Number(tuple[3]),
          source: regexSource,
        })
      }
      tuple = tuplePattern.exec(body)
    }
    group = groupPattern.exec(source)
  }
  return patterns
}

/**
 * Parse every analyzer module in the pinned slice into rows.
 */
export function deriveSkillSpectorRules(slice: UpstreamSlice): DerivedRowSet {
  const analyzersDir = path.join(slice.rootPath, SKILLSPECTOR_ANALYZERS_REL_DIR)
  const explanations = parseSkillSpectorExplanations(
    readSliceFile(
      slice,
      `${SKILLSPECTOR_ANALYZERS_REL_DIR}/${SKILLSPECTOR_DEFAULTS_MODULE}`,
    ),
  )

  const moduleFiles = readdirSync(analyzersDir)
    .filter(name => name.startsWith('static_patterns_') && name.endsWith('.py'))
    .toSorted()

  const rules: PatternRule[] = []
  for (let i = 0, { length } = moduleFiles; i < length; i += 1) {
    const fileName = moduleFiles[i]!
    const relPath = `${SKILLSPECTOR_ANALYZERS_REL_DIR}/${fileName}`
    const source = readSliceFile(slice, relPath)
    const sourceFile = sliceFilePath(slice, relPath)
    const category = skillSpectorCategoryFromModule(fileName)
    const patterns = parseSkillSpectorPatterns(source)
    const moduleFlags = parseSkillSpectorModuleFlags(source)

    if (
      patterns.length === 0 &&
      !isDeclaredDivergence('skillspector', fileName)
    ) {
      throw new Error(
        `Analyzer module parsed to zero patterns.\n` +
          `  where: ${sourceFile}\n` +
          `  saw:   no <CODE>_PATTERNS tuples matched\n` +
          `  wanted: at least one detector pattern, or a declared divergence\n` +
          `  fix:   either update parseSkillSpectorPatterns for the module's shape, ` +
          `or record the skip with a reason in ` +
          `.config/repo/upstream-divergence.json under skillspector.modules`,
      )
    }

    // Per-code ordinal keeps ids stable and unique when a group holds several
    // patterns; the upstream numbers the GROUP, not the individual pattern.
    const seenPerCode = new Map<string, number>()
    for (let j = 0, patternCount = patterns.length; j < patternCount; j += 1) {
      const entry = patterns[j]!
      const ordinal = (seenPerCode.get(entry.code) ?? 0) + 1
      seenPerCode.set(entry.code, ordinal)
      const translated = translateRegexForJs(entry.source)
      const explanation = explanations.get(entry.code)
      rules.push({
        category,
        description:
          explanation ??
          `SkillSpector ${entry.code} pattern in the ${category} analyzer.`,
        dialect: translated.dialect,
        entropy: undefined,
        id: `skillspector:${entry.code.toLowerCase()}-${ordinal}`,
        keywords: [],
        kind: 'regex',
        pathRegexSource: undefined,
        provenance: {
          license: slice.license,
          ruleId: entry.code,
          source: slice.source,
          sourceFile,
        },
        regexFlags: mergeRegexFlags(translated.flags, moduleFlags),
        regexSource: translated.source,
        severity: skillSpectorSeverity(entry.confidence),
        title: `${entry.code} ${category}`,
      })
    }
  }

  assertRowsPresent(rules, {
    generator: 'scripts/repo/gen/import-skillspector.mts',
    sourceFile: sliceFilePath(slice, SKILLSPECTOR_ANALYZERS_REL_DIR),
  })
  if (rules.length < SKILLSPECTOR_MIN_EXPECTED_RULES) {
    throw new Error(
      `SkillSpector parse returned an implausibly small table.\n` +
        `  where: ${sliceFilePath(slice, SKILLSPECTOR_ANALYZERS_REL_DIR)}\n` +
        `  saw:   ${rules.length} rules across ${moduleFiles.length} analyzer module(s)\n` +
        `  wanted: at least ${SKILLSPECTOR_MIN_EXPECTED_RULES}\n` +
        `  fix:   the <CODE>_PATTERNS group shape changed at ${slice.source}. ` +
        `Update parseSkillSpectorPatterns in ` +
        `scripts/repo/gen/import-skillspector.mts, then re-run pnpm run gen.`,
    )
  }
  return { rules, sources: [slice.source] }
}

/**
 * Generator entry point: derive and write `data/sources/skillspector.json`.
 */
export function generateSkillSpectorSource(): DerivedRowSet {
  const slice = resolveUpstreamSlice('skillspector')
  const rowSet = deriveSkillSpectorRules(slice)
  writeSourceRowSet('skillspector', rowSet)
  return rowSet
}
