/**
 * @file Derives plugin-capability rows from codex-security's bundled plugin.
 *   Apache-2.0 — attribution is required and lives in `NOTICE`. Reads only
 *   `upstream/codex-security/sdk/typescript/_bundled_plugin/`.
 *   codex-security is an AI-agent-driven scanner: its findings come from model
 *   analysis, not a pattern table, so there are no regexes to derive. What it
 *   DOES declare, machine-readably, is the shape a well-formed security plugin
 *   must have — `preflight/capability-profiles.toml` names the capabilities a
 *   deep scan requires, including the exact set of plugin skills that must be
 *   present.
 *   Those become `kind: 'capability'` rows in the `skills` table: a consumer
 *   scanning an agent plugin can assert the required skills exist and the
 *   declared runtime capabilities are satisfiable. That is a real, checkable
 *   property — and it is the honest limit of what this upstream supports.
 */

import type { DerivedRowSet } from './_shared/emit-table.mts'
import type { PatternRule } from './_shared/table-types.mts'
import type { UpstreamSlice } from './_shared/upstream-slice.mts'

import { assertRowsPresent, writeSourceRowSet } from './_shared/emit-table.mts'
import {
  readSliceFile,
  resolveUpstreamSlice,
  sliceFilePath,
} from './_shared/upstream-slice.mts'

/**
 * Capability profile source inside the pinned slice.
 */
export const CODEX_CAPABILITIES_REL_PATH = 'preflight/capability-profiles.toml'

/**
 * Prefix of the bundled-plugin tree inside the slice.
 */
export const CODEX_PLUGIN_REL_DIR = 'sdk/typescript/_bundled_plugin'

/**
 * Rows the upstream is known to carry at the pinned tag.
 */
export const CODEX_MIN_EXPECTED_RULES = 5

/**
 * One `[capabilities.<name>]` block.
 */
export interface CodexCapability {
  /**
   * `plugin_skills`, `runtime`, `config`, `multi_agent_capacity`, …
   */
  readonly kind: string
  readonly name: string
  /**
   * Skill names for a `plugin_skills` capability.
   */
  readonly required: readonly string[]
}

/**
 * Parse the `[capabilities.<name>]` blocks out of the profile TOML.
 */
export function parseCodexCapabilities(
  toml: string,
): readonly CodexCapability[] {
  const capabilities: CodexCapability[] = []
  const lines = toml.split('\n')
  let name: string | undefined
  let body: string[] = []

  const flush = (): void => {
    if (!name) {
      return
    }
    const text = body.join('\n')
    // Matches `kind = "value"`, capturing the quoted value.
    const kind = /^\s*kind\s*=\s*"([^"]*)"/m.exec(text)?.[1] ?? 'unknown'
    capabilities.push({ kind, name, required: parseTomlStringArray(text) })
    name = undefined
    body = []
  }

  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    // Matches a `[capabilities.<name>]` section header.
    const header = /^\s*\[capabilities\.([A-Za-z0-9_]+)\]\s*$/.exec(line)
    if (header) {
      flush()
      name = header[1]!
      continue
    }
    if (line.trimStart().startsWith('[')) {
      flush()
      continue
    }
    if (name) {
      body.push(line)
    }
  }
  flush()
  return capabilities
}

/**
 * Read a `required = [ "a", "b" ]` array, which may span lines.
 */
export function parseTomlStringArray(block: string): readonly string[] {
  const matched = /^\s*required\s*=\s*\[([\s\S]*?)\]/m.exec(block)
  if (!matched) {
    return []
  }
  const items: string[] = []
  // Matches one double-quoted string, capturing its body.
  const itemPattern = /"((?:[^"\\]|\\.)*)"/g
  let item = itemPattern.exec(matched[1]!)
  while (item) {
    items.push(item[1]!)
    item = itemPattern.exec(matched[1]!)
  }
  return items.toSorted()
}

/**
 * A missing required skill breaks a deep scan outright; every other capability
 * is a degraded-mode signal. That distinction is the only severity the
 * upstream expresses, so it is the only one recorded.
 */
export function codexCapabilitySeverity(
  kind: string,
): 'high' | 'info' | 'medium' {
  if (kind === 'plugin_skills') {
    return 'high'
  }
  if (kind === 'config' || kind === 'runtime') {
    return 'medium'
  }
  return 'info'
}

/**
 * Parse the pinned capability profiles into rows.
 */
export function deriveCodexCapabilities(slice: UpstreamSlice): DerivedRowSet {
  const relPath = `${CODEX_PLUGIN_REL_DIR}/${CODEX_CAPABILITIES_REL_PATH}`
  const toml = readSliceFile(slice, relPath)
  const sourceFile = sliceFilePath(slice, relPath)
  const capabilities = parseCodexCapabilities(toml)

  const rules: PatternRule[] = []
  for (let i = 0, { length } = capabilities; i < length; i += 1) {
    const capability = capabilities[i]!
    const requiredNote =
      capability.required.length > 0
        ? ` Requires the plugin skills: ${capability.required.join(', ')}.`
        : ''
    rules.push({
      category: capability.kind,
      description:
        `codex-security declares the "${capability.name}" capability ` +
        `(kind: ${capability.kind}) for a deep security scan.${requiredNote}`,
      dialect: 'js',
      entropy: undefined,
      id: `codex-security:${capability.name.replace(/_/g, '-')}`,
      keywords: capability.required,
      kind: 'capability',
      pathRegexSource: undefined,
      provenance: {
        license: slice.license,
        ruleId: capability.name,
        source: slice.source,
        sourceFile,
      },
      regexFlags: '',
      regexSource: undefined,
      severity: codexCapabilitySeverity(capability.kind),
      title: capability.name.replace(/_/g, ' '),
    })
  }

  assertRowsPresent(rules, {
    generator: 'scripts/repo/gen/import-codex-security.mts',
    sourceFile,
  })
  if (rules.length < CODEX_MIN_EXPECTED_RULES) {
    throw new Error(
      `codex-security parse returned an implausibly small table.\n` +
        `  where: ${sourceFile}\n` +
        `  saw:   ${rules.length} capabilities\n` +
        `  wanted: at least ${CODEX_MIN_EXPECTED_RULES}\n` +
        `  fix:   the [capabilities.*] block shape changed at ${slice.source}. ` +
        `Update parseCodexCapabilities in ` +
        `scripts/repo/gen/import-codex-security.mts, then re-run pnpm run gen.`,
    )
  }
  return { rules, sources: [slice.source] }
}

/**
 * Generator entry point: derive and write `data/sources/codex-security.json`.
 */
export function generateCodexSecuritySource(): DerivedRowSet {
  const slice = resolveUpstreamSlice('codex-security')
  const rowSet = deriveCodexCapabilities(slice)
  writeSourceRowSet('codex-security', rowSet)
  return rowSet
}
