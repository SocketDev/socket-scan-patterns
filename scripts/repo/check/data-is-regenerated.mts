/**
 * @file `check --all` gate: `data/` matches what the generators produce.
 *   The tables are generated, never hand-maintained, so a diff between the
 *   committed tables and a fresh generation means one of three things: someone
 *   hand-edited a table, a generator changed without its output being
 *   regenerated, or an upstream pin moved. All three must be loud.
 *   Regenerates into a temp dir and compares, so the check itself never
 *   mutates the tree — the fleet runner invokes every check argless and a
 *   check that writes would silently drift a tracked file.
 *   SKIPS when the upstream slices are not materialized: a fresh clone has no
 *   `upstream/` trees (they are git-ignored) and failing there would gate the
 *   build on a network fetch. Skipping is announced, never silent.
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { DATA_DIR, REPO_ROOT, UPSTREAM_DIR } from '../paths.mts'
import { listUpstreamSliceConfigs } from '../upstream-config.mts'

const logger = getDefaultLogger()

/**
 * The command a failure tells the operator to run.
 */
export const REGENERATE_COMMAND = 'pnpm run gen'

/**
 * Slices a generator needs on disk. TruffleHog is absent by design: it is
 * copyleft and no generator reads it.
 */
export function listDerivationSliceNames(): readonly string[] {
  return listUpstreamSliceConfigs()
    .filter(config => !config.copyleft)
    .map(config => config.name)
}

/**
 * Slices that a generator needs but that are not materialized.
 */
export function listMissingSlices(): readonly string[] {
  return listDerivationSliceNames().filter(
    name => !existsSync(path.join(UPSTREAM_DIR, name)),
  )
}

/**
 * Read every JSON file under a data dir into a path → text map.
 */
export function readDataTree(root: string): ReadonlyMap<string, string> {
  const files = new Map<string, string>()
  const walk = (dir: string, prefix: string): void => {
    if (!existsSync(dir)) {
      return
    }
    const entries = readdirSync(dir, { withFileTypes: true })
    for (let i = 0, { length } = entries; i < length; i += 1) {
      const entry = entries[i]!
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), rel)
      } else if (entry.name.endsWith('.json')) {
        files.set(rel, readFileSync(path.join(dir, entry.name), 'utf8'))
      }
    }
  }
  walk(root, '')
  return files
}

/**
 * How the committed tree differs from a fresh generation.
 */
export interface DriftReport {
  readonly added: readonly string[]
  readonly changed: readonly string[]
  readonly removed: readonly string[]
}

/**
 * Compare two data trees.
 */
export function compareDataTrees(
  committed: ReadonlyMap<string, string>,
  fresh: ReadonlyMap<string, string>,
): DriftReport {
  const added: string[] = []
  const changed: string[] = []
  const removed: string[] = []
  for (const [rel, text] of fresh) {
    const existing = committed.get(rel)
    if (existing === undefined) {
      added.push(rel)
    } else if (existing !== text) {
      changed.push(rel)
    }
  }
  for (const rel of committed.keys()) {
    if (!fresh.has(rel)) {
      removed.push(rel)
    }
  }
  return {
    added: added.toSorted(),
    changed: changed.toSorted(),
    removed: removed.toSorted(),
  }
}

/**
 * Regenerate into a scratch dir and diff against the committed tables.
 *
 * The generators honor `SCAN_PATTERNS_DATA_DIR`, so the fresh run writes into
 * an `os.tmpdir()` scratch dir and the committed tree is never touched. That
 * matters twice over: the fleet runner invokes every check argless and forbids
 * a check that mutates a tracked file, and it runs checks in PARALLEL — a
 * check that regenerated in place would race any other check reading `data/`.
 */
export async function checkDataIsRegenerated(): Promise<DriftReport> {
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'scan-patterns-drift-'))
  try {
    await spawn(
      'node',
      [path.join(REPO_ROOT, 'scripts', 'repo', 'gen', 'all.mts')],
      {
        cwd: REPO_ROOT,
        env: { ...process.env, SCAN_PATTERNS_DATA_DIR: scratch },
        stdio: 'ignore',
      },
    )
    return compareDataTrees(readDataTree(DATA_DIR), readDataTree(scratch))
  } finally {
    safeDeleteSync(scratch)
  }
}

/**
 * CLI entry point.
 */
export async function main(): Promise<void> {
  const missing = listMissingSlices()
  if (missing.length > 0) {
    logger.info(
      `data-is-regenerated: skipped — ${missing.length} upstream slice(s) not materialized ` +
        `(${missing.join(', ')}). Run node scripts/repo/materialize-upstream.mts --all to enable this gate.`,
    )
    return
  }
  if (!existsSync(DATA_DIR)) {
    logger.error(`data-is-regenerated: data/ is missing.`)
    logger.error(`  where: ${DATA_DIR}`)
    logger.error(`  saw:   no generated tables`)
    logger.error(`  wanted: the five scanner tables plus data/sources/`)
    logger.error(`  fix:   ${REGENERATE_COMMAND}`)
    process.exitCode = 1
    return
  }

  const report = await checkDataIsRegenerated()
  const total =
    report.added.length + report.changed.length + report.removed.length
  if (total === 0) {
    logger.info('data-is-regenerated: data/ matches a fresh generation.')
    return
  }

  logger.error(
    `data-is-regenerated: data/ does not match what the generators produce.`,
  )
  logger.error(`  where: ${DATA_DIR}`)
  logger.error(
    `  saw:   ${report.changed.length} changed, ${report.added.length} missing, ${report.removed.length} stale`,
  )
  for (const rel of report.changed) {
    logger.error(`           changed: data/${rel}`)
  }
  for (const rel of report.added) {
    logger.error(`           missing: data/${rel}`)
  }
  for (const rel of report.removed) {
    logger.error(`           stale:   data/${rel}`)
  }
  logger.error(`  wanted: data/ byte-identical to a fresh generation`)
  logger.error(
    `  fix:   ${REGENERATE_COMMAND} and commit the result. Never hand-edit a ` +
      `table — if the output is wrong, fix the generator under scripts/repo/gen/.`,
  )
  process.exitCode = 1
}

main().catch((error: unknown) => {
  logger.error(`data-is-regenerated: ${errorMessage(error)}`)
  process.exitCode = 1
})
