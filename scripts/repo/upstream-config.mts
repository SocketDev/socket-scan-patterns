/**
 * @file Single reader for the `.gitmodules` upstream slice declarations, plus
 *   the copyleft policy every slice is measured against.
 *   The materializer, the tests-only gate, and the coverage oracle all need
 *   the same facts (which slices exist, which are copyleft, what their sparse
 *   pattern set is), so those facts are parsed in exactly one place.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { REPO_ROOT } from './paths.mts'

/**
 * Absolute path of the pin file of record.
 */
export const GITMODULES_PATH = path.join(REPO_ROOT, '.gitmodules')

/**
 * SPDX identifiers this repo treats as copyleft. A slice with one of these
 * licenses is TESTS-ONLY: its implementation must never materialize, so it can
 * never be read, derived from, or accidentally ported.
 *
 * This list is the generic rule, not a TruffleHog special case — a future
 * AGPL/GPL upstream inherits the tests-only posture by default rather than by
 * someone remembering to ask for it.
 */
export const COPYLEFT_LICENSES: readonly string[] = [
  'AGPL-1.0',
  'AGPL-3.0',
  'GPL-2.0',
  'GPL-3.0',
  'SSPL-1.0',
]

/**
 * Human-readable description of the tests-only allowlist, used in messages.
 */
export const COPYLEFT_TEST_ONLY_PATTERN =
  '`*_test.go` files and `testdata/` fixtures'

/**
 * License per upstream slice, keyed by slice name. Copyleft entries drive the
 * tests-only posture; permissive entries derive normally with attribution.
 */
export const UPSTREAM_SLICE_LICENSES: Readonly<Record<string, string>> = {
  agentshield: 'MIT',
  'codex-security': 'Apache-2.0',
  gitleaks: 'MIT',
  skillspector: 'Apache-2.0',
  trivy: 'Apache-2.0',
  trufflehog: 'AGPL-3.0',
  zizmor: 'MIT',
}

/**
 * One slice as declared in `.gitmodules`.
 */
export interface UpstreamSliceConfig {
  /**
   * True when the slice's license is copyleft and it is therefore tests-only.
   */
  readonly copyleft: boolean
  readonly license: string
  readonly name: string
  /**
   * Whitespace-separated sparse patterns, verbatim from `.gitmodules`.
   */
  readonly sparseCheckout: string | undefined
  /**
   * `no-cone` when the pattern set needs file-level globs.
   */
  readonly sparseMode: string | undefined
  /**
   * Pinned release tag.
   */
  readonly tag: string | undefined
}

/**
 * Read one `[submodule "upstream/<name>"]` block's body.
 */
export function readGitmodulesBlock(name: string): string | undefined {
  if (!existsSync(GITMODULES_PATH)) {
    return undefined
  }
  const text = readFileSync(GITMODULES_PATH, 'utf8')
  const header = `[submodule "upstream/${name}"]`
  const start = text.indexOf(header)
  if (start === -1) {
    return undefined
  }
  const rest = text.slice(start + header.length)
  const next = rest.indexOf('[submodule')
  return next === -1 ? rest : rest.slice(0, next)
}

/**
 * Read a single field out of a block body.
 */
export function readGitmodulesField(
  block: string,
  field: string,
): string | undefined {
  const matched = new RegExp(`^\\s*${field}\\s*=\\s*(.+)$`, 'm').exec(block)
  return matched?.[1]?.trim()
}

/**
 * Resolve one slice's declaration, or throw when it is not pinned.
 */
export function readUpstreamSliceConfig(name: string): UpstreamSliceConfig {
  const block = readGitmodulesBlock(name)
  if (!block) {
    throw new Error(
      `Upstream slice is not declared.\n` +
        `  where: ${GITMODULES_PATH}\n` +
        `  saw:   no [submodule "upstream/${name}"] block\n` +
        `  wanted: a pinned block for "${name}"\n` +
        `  fix:   declare it with git config -f .gitmodules, then pin it via ` +
        `node scripts/fleet/gen/gitmodules-hash.mts --set upstream/${name} <ref> --label ${name}-<version>`,
    )
  }
  const license = UPSTREAM_SLICE_LICENSES[name] ?? 'UNKNOWN'
  return {
    copyleft: COPYLEFT_LICENSES.includes(license),
    license,
    name,
    sparseCheckout: readGitmodulesField(block, 'sparse-checkout'),
    sparseMode: readGitmodulesField(block, 'sparse-mode'),
    tag: readGitmodulesField(block, 'branch'),
  }
}

/**
 * Every slice declared in `.gitmodules`, in declaration order.
 */
export function listUpstreamSliceConfigs(): readonly UpstreamSliceConfig[] {
  if (!existsSync(GITMODULES_PATH)) {
    return []
  }
  const text = readFileSync(GITMODULES_PATH, 'utf8')
  const names: string[] = []
  const pattern = /^\[submodule "upstream\/([^"]+)"\]$/gm
  let matched = pattern.exec(text)
  while (matched) {
    names.push(matched[1]!)
    matched = pattern.exec(text)
  }
  return names.map(name => readUpstreamSliceConfig(name))
}

/**
 * Slices that are copyleft and therefore tests-only.
 */
export function listCopyleftSliceConfigs(): readonly UpstreamSliceConfig[] {
  return listUpstreamSliceConfigs().filter(config => config.copyleft)
}
