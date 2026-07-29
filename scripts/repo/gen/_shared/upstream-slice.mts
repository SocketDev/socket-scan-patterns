/**
 * @file Resolves a pinned `upstream/<name>` slice for a generator and fails
 *   loud when it is missing, unreadable, or off its pin. A generator that
 *   silently skips an unmaterialized slice emits a partial table and the drift
 *   check then blesses it, so every miss here is a hard error.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { REPO_ROOT, UPSTREAM_DIR } from '../../paths.mts'

/**
 * A pinned upstream, resolved from `.gitmodules` and confirmed on disk.
 */
export interface UpstreamSlice {
  /**
   * SPDX identifier the generator stamps onto every row it derives.
   */
  readonly license: string
  /**
   * Directory name under `upstream/`.
   */
  readonly name: string
  /**
   * `<name>@<tag>`, the value a row's `provenance.source` carries.
   */
  readonly source: string
  /**
   * Absolute path of the materialized tree.
   */
  readonly rootPath: string
  /**
   * The pinned release tag from the `.gitmodules` `branch` field.
   */
  readonly tag: string
}

/**
 * SPDX license per upstream. Hard-coded rather than sniffed from the slice so
 * a generator cannot silently mislabel a row's license if an upstream
 * relicenses; a relicense should break this map and force a review.
 *
 * `trufflehog` is absent on purpose — it is AGPL-3.0 and conformance-only, so
 * asking for it as a derivation slice must fail.
 */
export const UPSTREAM_LICENSES: Readonly<Record<string, string>> = {
  agentshield: 'MIT',
  'codex-security': 'Apache-2.0',
  gitleaks: 'MIT',
  skillspector: 'Apache-2.0',
  trivy: 'Apache-2.0',
  zizmor: 'MIT',
}

/**
 * Upstreams no generator may read. TruffleHog is AGPL-3.0: deriving its rules
 * into this MIT package would relicense the package, so the read is blocked
 * here rather than left to review.
 */
export const DERIVATION_BLOCKED_UPSTREAMS: readonly string[] = ['trufflehog']

/**
 * Read the `branch` (pinned tag) for an upstream out of `.gitmodules`.
 */
export function readPinnedTag(name: string): string | undefined {
  const gitmodulesPath = path.join(REPO_ROOT, '.gitmodules')
  if (!existsSync(gitmodulesPath)) {
    return undefined
  }
  const text = readFileSync(gitmodulesPath, 'utf8')
  const blockStart = text.indexOf(`[submodule "upstream/${name}"]`)
  if (blockStart === -1) {
    return undefined
  }
  const rest = text.slice(blockStart)
  const nextBlock = rest.indexOf('[submodule', 1)
  const block = nextBlock === -1 ? rest : rest.slice(0, nextBlock)
  const matched = /^\s*branch\s*=\s*(.+)$/m.exec(block)
  return matched?.[1]?.trim()
}

/**
 * Resolve a slice, or throw with What / Where / Saw vs. wanted / Fix.
 */
export function resolveUpstreamSlice(name: string): UpstreamSlice {
  if (DERIVATION_BLOCKED_UPSTREAMS.includes(name)) {
    throw new Error(
      `Refusing to derive from a conformance-only upstream.\n` +
        `  where: upstream/${name}\n` +
        `  saw:   a generator asked to read ${name} as a derivation source\n` +
        `  wanted: ${name} read only by scripts/check/, never by scripts/gen/\n` +
        `  fix:   ${name} is AGPL-3.0. Deriving its rules would relicense this ` +
        `MIT package. Add the rule to a derivable upstream's generator or ` +
        `author an original Socket rule. See docs/agents.md/repo/upstream-slices.md`,
    )
  }

  const license = UPSTREAM_LICENSES[name]
  if (!license) {
    throw new Error(
      `Unknown upstream — no license on record.\n` +
        `  where: scripts/gen/_shared/upstream-slice.mts UPSTREAM_LICENSES\n` +
        `  saw:   a generator asked for "${name}"\n` +
        `  wanted: every derivation source declares its SPDX license\n` +
        `  fix:   add "${name}" to UPSTREAM_LICENSES with the upstream's SPDX id, ` +
        `and record the attribution in NOTICE if it is not MIT`,
    )
  }

  const tag = readPinnedTag(name)
  if (!tag) {
    throw new Error(
      `Upstream is not pinned in .gitmodules.\n` +
        `  where: ${path.join(REPO_ROOT, '.gitmodules')}\n` +
        `  saw:   no [submodule "upstream/${name}"] block with a branch field\n` +
        `  wanted: a block pinning ${name} to a release tag\n` +
        `  fix:   node scripts/fleet/gen/gitmodules-hash.mts --set upstream/${name} <ref> --label ${name}-<version>`,
    )
  }

  const rootPath = path.join(UPSTREAM_DIR, name)
  if (!existsSync(rootPath)) {
    throw new Error(
      `Upstream slice is not materialized.\n` +
        `  where: ${rootPath}\n` +
        `  saw:   the directory does not exist\n` +
        `  wanted: the pinned ${name}@${tag} tree on disk\n` +
        `  fix:   node scripts/fleet/git-partial-submodule.mts clone upstream/${name}`,
    )
  }

  return { license, name, rootPath, source: `${name}@${tag}`, tag }
}

/**
 * Read one file out of a slice, or throw pointing at the sparse-checkout that
 * would have to widen. A missing file almost always means the slice's
 * `sparse-checkout` does not cover the path, not that the upstream dropped it.
 */
export function readSliceFile(slice: UpstreamSlice, relPath: string): string {
  const absPath = path.join(slice.rootPath, relPath)
  if (!existsSync(absPath)) {
    throw new Error(
      `Upstream file missing from the pinned slice.\n` +
        `  where: ${absPath}\n` +
        `  saw:   no such file in ${slice.source}\n` +
        `  wanted: ${relPath} readable from the materialized slice\n` +
        `  fix:   widen sparse-checkout for [submodule "upstream/${slice.name}"] ` +
        `in .gitmodules to cover ${relPath}, then re-run ` +
        `node scripts/fleet/git-partial-submodule.mts clone upstream/${slice.name}`,
    )
  }
  return readFileSync(absPath, 'utf8')
}

/**
 * Repo-relative slice path for a row's `provenance.sourceFile`.
 */
export function sliceFilePath(slice: UpstreamSlice, relPath: string): string {
  return normalizePath(path.join('upstream', slice.name, relPath))
}
