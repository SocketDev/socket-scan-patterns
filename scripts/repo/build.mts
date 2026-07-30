/*
 * @file Build the publishable artifact.
 *
 *   Two steps, in order:
 *
 *   1. **Generate the tables** when the upstream slices are materialized, so a
 *      release can never ship a stale `data/`. On a machine without the slices
 *      the committed tables are used as-is and the step is announced as
 *      skipped — the drift gate is what proves they were current when they
 *      landed.
 *   2. **Bundle `src/` to CJS** with rolldown, the fleet's publish shape.
 *
 *   Usage: node scripts/repo/build.mts [--no-gen]
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { REPO_ROOT, UPSTREAM_DIR } from './paths.mts'
import { listUpstreamSliceConfigs } from './upstream-config.mts'

const logger = getDefaultLogger()

/**
 * Rolldown config for the published bundle.
 */
export const ROLLDOWN_CONFIG_REL_PATH = '.config/repo/rolldown.config.mts'

/**
 * True when every derivable slice is on disk, so a regeneration would be
 * complete rather than partial.
 */
export function canRegenerateTables(): boolean {
  return listUpstreamSliceConfigs()
    .filter(config => !config.copyleft)
    .every(config => existsSync(path.join(UPSTREAM_DIR, config.name)))
}

/**
 * Regenerate `data/` from the pinned slices.
 */
export async function runTableGeneration(): Promise<void> {
  await spawn(
    'node',
    [path.join(REPO_ROOT, 'scripts', 'repo', 'gen', 'all.mts')],
    { cwd: REPO_ROOT, stdio: 'inherit' },
  )
}

/**
 * Emit the `.d.ts` declarations the `exports` map's `types` condition points
 * at. rolldown bundles runtime JS only, so without this step the published
 * package advertises types it does not ship and every TypeScript consumer
 * falls back to `any`.
 */
export async function runDeclarations(): Promise<void> {
  await spawn(
    'node',
    [
      path.join(REPO_ROOT, 'node_modules', 'typescript', 'bin', 'tsc'),
      '--project',
      '.config/repo/tsconfig.dts.json',
    ],
    { cwd: REPO_ROOT, stdio: 'inherit' },
  )
}

/**
 * Bundle `src/` with rolldown.
 */
export async function runBundle(): Promise<void> {
  await spawn(
    'node',
    [
      path.join(REPO_ROOT, 'node_modules', 'rolldown', 'bin', 'cli.mjs'),
      '--config',
      ROLLDOWN_CONFIG_REL_PATH,
    ],
    { cwd: REPO_ROOT, stdio: 'inherit' },
  )
}

/**
 * CLI entry point.
 */
export async function main(): Promise<void> {
  const skipGen = process.argv.includes('--no-gen')
  if (skipGen) {
    logger.info('build: table generation skipped (--no-gen)')
  } else if (canRegenerateTables()) {
    logger.info('build: regenerating detector tables from the pinned slices…')
    await runTableGeneration()
  } else {
    logger.info(
      'build: upstream slices are not materialized — using the committed ' +
        'tables. Run node scripts/repo/materialize-upstream.mts --all to ' +
        'regenerate from source.',
    )
  }

  if (!existsSync(path.join(REPO_ROOT, ROLLDOWN_CONFIG_REL_PATH))) {
    throw new Error(
      `Rolldown config is missing.\n` +
        `  where: ${ROLLDOWN_CONFIG_REL_PATH}\n` +
        `  saw:   no such file\n` +
        `  wanted: the fleet CJS bundle config for a published js package\n` +
        `  fix:   add ${ROLLDOWN_CONFIG_REL_PATH}, or re-run the wheelhouse cascade`,
    )
  }
  logger.info('build: bundling src/ to CJS…')
  await runBundle()
  logger.info('build: emitting type declarations…')
  await runDeclarations()
  logger.info('build: done')
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    logger.error(errorMessage(error))
    process.exit(1)
  },
)
