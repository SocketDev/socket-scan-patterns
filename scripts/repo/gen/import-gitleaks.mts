/**
 * @file Derives secret-detector rows from gitleaks' generated TOML config.
 *   MIT. Reads only `upstream/gitleaks/config/gitleaks.toml`.
 *   The upstream file is itself generated ("This file has been auto-generated")
 *   from `cmd/generate/config/rules/*.go`, so its `[[rules]]` blocks are
 *   uniform: flat scalar keys, `'''`-quoted literal strings for the regexes.
 *   That regularity is why a targeted block parser is correct here rather than
 *   a full TOML dependency — and why the parser asserts a plausible row count
 *   instead of trusting a silent partial parse.
 */

import type { PatternRule } from './_shared/table-types.mts'
import type { DerivedRowSet } from './_shared/emit-table.mts'
import type { UpstreamSlice } from './_shared/upstream-slice.mts'

import { assertRowsPresent, writeSourceRowSet } from './_shared/emit-table.mts'
import { translateRegexForJs } from './_shared/regex-dialect.mts'
import {
  readSliceFile,
  resolveUpstreamSlice,
  sliceFilePath,
} from './_shared/upstream-slice.mts'

/**
 * Path of the derivation source inside the pinned slice.
 */
export const GITLEAKS_CONFIG_REL_PATH = 'config/gitleaks.toml'

/**
 * Rows the upstream is known to carry at the pinned tag. A parse that returns
 * fewer than this means the block shape moved and the table would silently
 * lose detectors, so the generator fails instead.
 */
export const GITLEAKS_MIN_EXPECTED_RULES = 200

/**
 * Gitleaks declares no per-rule severity — the upstream model is "a match is a
 * leaked credential". Normalizing every row to `high` preserves that: the
 * table never claims a precision gitleaks does not express. Rules that carry an
 * entropy floor are the higher-confidence subset, and consumers can raise them
 * using `entropy` rather than a severity this generator invented.
 */
export const GITLEAKS_DEFAULT_SEVERITY = 'high'

/**
 * Split the TOML into `[[rules]]` block bodies. A block runs to the next
 * top-level `[` that is not one of its own `[rules.*]` subtables.
 */
export function splitGitleaksRuleBlocks(toml: string): readonly string[] {
  const blocks: string[] = []
  const lines = toml.split('\n')
  let current: string[] | undefined
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (line.trimStart().startsWith('[[rules]]')) {
      if (current) {
        blocks.push(current.join('\n'))
      }
      current = []
      continue
    }
    if (!current) {
      continue
    }
    const trimmed = line.trimStart()
    if (trimmed.startsWith('[') && !trimmed.startsWith('[rules.')) {
      blocks.push(current.join('\n'))
      current = undefined
      continue
    }
    current.push(line)
  }
  if (current) {
    blocks.push(current.join('\n'))
  }
  return blocks
}

/**
 * Read a `key = '''value'''` or `key = "value"` scalar out of a block. Stops
 * at the first `[rules.` subtable so an allowlist's own `regex`/`path` keys
 * cannot be mistaken for the rule's.
 */
export function readGitleaksScalar(
  block: string,
  key: string,
): string | undefined {
  const head = block.split(/^\s*\[rules\./m)[0] ?? block
  const literal = new RegExp(`^\\s*${key}\\s*=\\s*'''([\\s\\S]*?)'''\\s*$`, 'm')
  const literalMatch = literal.exec(head)
  if (literalMatch) {
    return literalMatch[1]
  }
  const basic = new RegExp(
    `^\\s*${key}\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"\\s*$`,
    'm',
  )
  const basicMatch = basic.exec(head)
  if (basicMatch) {
    return basicMatch[1]!.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
  return undefined
}

/**
 * Read a `keywords = [...]` array of double-quoted strings.
 */
export function readGitleaksKeywords(block: string): readonly string[] {
  const head = block.split(/^\s*\[rules\./m)[0] ?? block
  const matched = /^\s*keywords\s*=\s*\[([\s\S]*?)\]/m.exec(head)
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
 * Read a numeric scalar such as `entropy = 3.8`.
 */
export function readGitleaksNumber(
  block: string,
  key: string,
): number | undefined {
  const head = block.split(/^\s*\[rules\./m)[0] ?? block
  const matched = new RegExp(
    `^\\s*${key}\\s*=\\s*([0-9]+(?:\\.[0-9]+)?)\\s*$`,
    'm',
  ).exec(head)
  return matched ? Number(matched[1]) : undefined
}

/**
 * Gitleaks embeds its flags inline in the pattern (`(?i)`), so the extracted
 * `regexSource` is already self-describing and no flag string is separated
 * out. Category is derived from the rule id's leading vendor token, which is
 * how the upstream names every rule (`adobe-client-id` → `adobe`).
 */
export function gitleaksCategoryFromId(id: string): string {
  const head = id.split('-')[0]
  return head && head.length > 0 ? head : 'generic'
}

/**
 * Parse the pinned gitleaks config into rows.
 */
export function deriveGitleaksRules(slice: UpstreamSlice): DerivedRowSet {
  const toml = readSliceFile(slice, GITLEAKS_CONFIG_REL_PATH)
  const sourceFile = sliceFilePath(slice, GITLEAKS_CONFIG_REL_PATH)
  const blocks = splitGitleaksRuleBlocks(toml)
  const rules: PatternRule[] = []
  for (let i = 0, { length } = blocks; i < length; i += 1) {
    const block = blocks[i]!
    const id = readGitleaksScalar(block, 'id')
    const regexSource = readGitleaksScalar(block, 'regex')
    if (!id || !regexSource) {
      continue
    }
    const rawPath = readGitleaksScalar(block, 'path')
    const description = readGitleaksScalar(block, 'description') ?? id
    const translated = translateRegexForJs(regexSource)
    const translatedPath = rawPath ? translateRegexForJs(rawPath) : undefined
    // A path-scoped rule is only JS-safe when BOTH of its patterns translated.
    const dialect =
      translated.dialect === 'js' &&
      (translatedPath === undefined || translatedPath.dialect === 'js')
        ? 'js'
        : 're2'
    rules.push({
      category: gitleaksCategoryFromId(id),
      description,
      dialect,
      entropy: readGitleaksNumber(block, 'entropy'),
      id: `gitleaks:${id}`,
      keywords: readGitleaksKeywords(block),
      kind: rawPath ? 'path' : 'regex',
      pathRegexSource: translatedPath?.source,
      provenance: {
        license: slice.license,
        ruleId: id,
        source: slice.source,
        sourceFile,
      },
      regexFlags: translated.flags,
      regexSource: translated.source,
      severity: GITLEAKS_DEFAULT_SEVERITY,
      title: id,
    })
  }

  assertRowsPresent(rules, {
    generator: 'scripts/repo/gen/import-gitleaks.mts',
    sourceFile,
  })
  if (rules.length < GITLEAKS_MIN_EXPECTED_RULES) {
    throw new Error(
      `gitleaks parse returned an implausibly small table.\n` +
        `  where: ${sourceFile}\n` +
        `  saw:   ${rules.length} rules\n` +
        `  wanted: at least ${GITLEAKS_MIN_EXPECTED_RULES}\n` +
        `  fix:   the [[rules]] block shape changed at ${slice.source}. ` +
        `Update splitGitleaksRuleBlocks / readGitleaksScalar in ` +
        `scripts/repo/gen/import-gitleaks.mts to match, then re-run pnpm run gen.`,
    )
  }
  return { rules, sources: [slice.source] }
}

/**
 * Generator entry point: derive and write `data/sources/gitleaks.json`.
 */
export function generateGitleaksSource(): DerivedRowSet {
  const slice = resolveUpstreamSlice('gitleaks')
  const rowSet = deriveGitleaksRules(slice)
  writeSourceRowSet('gitleaks', rowSet)
  return rowSet
}
