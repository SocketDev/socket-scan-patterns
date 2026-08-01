/**
 * @file Reads the declared upstream divergences.
 *   A generator that quietly derives nothing from part of an upstream is the
 *   worst failure mode this package has: the table still looks healthy and a
 *   whole detector category is missing. So every skip is DECLARED, with a
 *   reason, in `.config/repo/upstream-divergence.json` — outside the
 *   generators, so it reads as a reviewed decision rather than a code path.
 *   Generators call `isDeclaredDivergence` before accepting a zero-row parse;
 *   an undeclared zero throws.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

import { CONFIG_REPO_DIR } from '../../paths.mts'
import { isJsonObject, readJsonObjectFile } from '../../read-json.mts'

/**
 * The declaration file of record.
 */
export const DIVERGENCE_FILE = path.join(
  CONFIG_REPO_DIR,
  'upstream-divergence.json',
)

/**
 * One declared skip.
 */
export interface DivergenceEntry {
  readonly reason: string
  readonly skipped: boolean
}

/**
 * Look up a declared divergence for one module of one upstream.
 */
export function readDivergenceEntry(
  upstream: string,
  moduleName: string,
): DivergenceEntry | undefined {
  if (!existsSync(DIVERGENCE_FILE)) {
    return undefined
  }
  const root = readJsonObjectFile(DIVERGENCE_FILE)
  const upstreamEntry = root[upstream]
  if (!isJsonObject(upstreamEntry)) {
    return undefined
  }
  const modules = upstreamEntry['modules']
  if (!isJsonObject(modules)) {
    return undefined
  }
  const entry = modules[moduleName]
  if (!isJsonObject(entry)) {
    return undefined
  }
  const reason = entry['reason']
  const skipped = entry['skipped']
  if (typeof reason !== 'string' || reason.length === 0) {
    throw new Error(
      `Declared divergence has no reason.\n` +
        `  where: ${DIVERGENCE_FILE} → ${upstream}.modules["${moduleName}"]\n` +
        `  saw:   reason = ${JSON.stringify(reason)}\n` +
        `  wanted: a non-empty reason explaining why the module is not derived\n` +
        `  fix:   add a "reason" naming the upstream shape that blocks derivation`,
    )
  }
  return { reason, skipped: skipped === true }
}

/**
 * True when a module is explicitly declared as not derived.
 */
export function isDeclaredDivergence(
  upstream: string,
  moduleName: string,
): boolean {
  return readDivergenceEntry(upstream, moduleName)?.skipped === true
}
