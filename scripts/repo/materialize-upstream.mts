/**
 * @file Materializes a pinned `upstream/<name>` slice, honoring the
 *   `sparse-mode` field the fleet clone does not know about.
 *   The fleet's `git-partial-submodule.mts clone` applies sparse patterns in
 *   git's default CONE mode, which can only express directory prefixes. A
 *   copyleft slice must admit individual FILE globs — `*_test.go` and nothing
 *   else — so it needs NO-CONE. This script runs the fleet clone first, then
 *   re-applies the pattern set in the declared mode.
 *   Why it matters: for an AGPL upstream the sparse pattern is not an
 *   optimization, it is the license boundary. Implementation that never lands
 *   on disk cannot be read by any agent or human, which is a far stronger
 *   guarantee than a rule saying "do not copy this".
 *   Usage: node scripts/repo/materialize-upstream.mts <name> [<name>…]
 *   node scripts/repo/materialize-upstream.mts --all.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { REPO_ROOT, UPSTREAM_DIR } from './paths.mts'
import { listNonTestFiles } from './upstream-tree.mts'
import {
  COPYLEFT_TEST_ONLY_PATTERN,
  listUpstreamSliceConfigs,
  readUpstreamSliceConfig,
} from './upstream-config.mts'

const logger = getDefaultLogger()

/**
 * Run the fleet partial-submodule clone for one slice.
 */
export async function cloneUpstreamSlice(name: string): Promise<void> {
  await spawn(
    'node',
    [
      path.join(REPO_ROOT, 'scripts', 'fleet', 'git-partial-submodule.mts'),
      'clone',
      `upstream/${name}`,
    ],
    { cwd: REPO_ROOT, stdio: 'inherit' },
  )
}

/**
 * Re-apply the slice's sparse patterns in its declared mode. Cone mode is
 * git's default and the fleet clone already produced it, so this only has work
 * to do for a `no-cone` slice.
 */
export async function applySliceSparseMode(name: string): Promise<void> {
  const config = readUpstreamSliceConfig(name)
  if (config.sparseMode !== 'no-cone' || !config.sparseCheckout) {
    return
  }
  const worktree = path.join(UPSTREAM_DIR, name)
  await spawn(
    'git',
    [
      '-C',
      worktree,
      'sparse-checkout',
      'set',
      '--no-cone',
      ...config.sparseCheckout.split(/\s+/).filter(Boolean),
    ],
    { cwd: REPO_ROOT, stdio: 'inherit' },
  )
  logger.info(
    `upstream/${name}: re-applied ${config.sparseCheckout.split(/\s+/).filter(Boolean).length} sparse pattern(s) in no-cone mode`,
  )
}

/**
 * Assert a copyleft slice materialized to tests and fixtures only. Runs right
 * after materialization so a bad pattern set is caught before anything reads
 * the tree, rather than at the next `check --all`.
 */
export function assertCopyleftSliceIsTestsOnly(name: string): void {
  const config = readUpstreamSliceConfig(name)
  if (!config.copyleft) {
    return
  }
  const worktree = path.join(UPSTREAM_DIR, name)
  if (!existsSync(worktree)) {
    return
  }
  const offenders = listNonTestFiles(worktree)
  if (offenders.length > 0) {
    throw new Error(
      `Copyleft slice materialized non-test files.\n` +
        `  where: ${worktree}\n` +
        `  saw:   ${offenders.length} file(s) outside the test allowlist, e.g. ${offenders.slice(0, 3).join(', ')}\n` +
        `  wanted: only ${COPYLEFT_TEST_ONLY_PATTERN} — a copyleft upstream's implementation must never land on disk\n` +
        `  fix:   node scripts/repo/materialize-upstream.mts ${name} ` +
        `(re-applies the no-cone tests-only pattern set). If the pattern set ` +
        `itself is wrong, fix sparse-checkout for [submodule "upstream/${name}"] ` +
        `in .gitmodules — never widen it to admit implementation.`,
    )
  }
}

/**
 * CLI entry point.
 */
export async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const names =
    args.length === 0 || args.includes('--all')
      ? listUpstreamSliceConfigs().map(config => config.name)
      : args.filter(arg => !arg.startsWith('-'))

  for (let i = 0, { length } = names; i < length; i += 1) {
    const name = names[i]!
    logger.info(`materializing upstream/${name}…`)
    // Sequential on purpose: concurrent clones of several large upstreams
    // thrash the network and interleave their git output unreadably.
    await cloneUpstreamSlice(name)
    await applySliceSparseMode(name)
    assertCopyleftSliceIsTestsOnly(name)
  }
  logger.info(`materialized ${names.length} upstream slice(s)`)
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    logger.error(errorMessage(error))
    process.exit(1)
  },
)
