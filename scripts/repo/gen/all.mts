/**
 * @file Runs every generator, then composes the five consumer tables.
 *   Deterministic and idempotent: two runs over the same pinned slices produce
 *   byte-identical output, which is what makes `data-is-regenerated` a
 *   meaningful gate.
 *   Fails LOUD. A generator that cannot find its slice, or parses an
 *   implausibly small table, throws with What / Where / Saw-vs-wanted / Fix
 *   rather than emitting a partial table — a half-empty detector table is a
 *   silently disabled scanner, which is worse than a red build.
 *   Usage: node scripts/repo/gen/all.mts [--out-dir <dir>]
 */

import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import type { DerivedRowSet } from './_shared/emit-table.mts'

import { composeAllTables } from './compose-tables.mts'
import { generateAgentShieldSources } from './import-agentshield.mts'
import { generateCodexSecuritySource } from './import-codex-security.mts'
import { generateGitleaksSource } from './import-gitleaks.mts'
import { generateSkillSpectorSource } from './import-skillspector.mts'
import { generateTrivySource } from './import-trivy-secrets.mts'
import { generateZizmorSource } from './port-zizmor-audits.mts'

const logger = getDefaultLogger()

/**
 * One generator, named for the run log.
 */
export interface GeneratorEntry {
  readonly name: string
  readonly run: () => readonly DerivedRowSet[]
}

/**
 * Every derivation generator.
 *
 * TruffleHog is absent by design and must stay absent: it is AGPL-3.0 and
 * observed tests-only as a coverage oracle. `copyleft-slices-are-tests-only`
 * fails the build if a generator ever resolves it.
 */
export const GENERATORS: readonly GeneratorEntry[] = [
  {
    name: 'agentshield',
    run: () => {
      const rowSets = generateAgentShieldSources()
      return [rowSets.agentConfigs, rowSets.skills]
    },
  },
  { name: 'codex-security', run: () => [generateCodexSecuritySource()] },
  { name: 'gitleaks', run: () => [generateGitleaksSource()] },
  { name: 'skillspector', run: () => [generateSkillSpectorSource()] },
  { name: 'trivy', run: () => [generateTrivySource()] },
  { name: 'zizmor', run: () => [generateZizmorSource()] },
]

/**
 * Run every generator and report per-source row counts.
 */
export function runAllGenerators(): number {
  let total = 0
  for (let i = 0, { length } = GENERATORS; i < length; i += 1) {
    const generator = GENERATORS[i]!
    const rowSets = generator.run()
    let count = 0
    for (let j = 0, setCount = rowSets.length; j < setCount; j += 1) {
      count += rowSets[j]!.rules.length
    }
    total += count
    logger.info(`  ${generator.name}: ${count} row(s)`)
  }
  return total
}

/**
 * CLI entry point.
 */
export function main(): void {
  logger.info('deriving rows from the pinned upstream slices…')
  const total = runAllGenerators()
  logger.info(`derived ${total} row(s) total`)

  logger.info('composing scanner tables…')
  const composed = composeAllTables()
  for (let i = 0, { length } = composed; i < length; i += 1) {
    const table = composed[i]!
    logger.info(`  data/${table.fileName}: ${table.ruleCount} rule(s)`)
  }
  logger.info(`wrote ${composed.length} table(s)`)
}

try {
  main()
} catch (error) {
  logger.error(errorMessage(error))
  process.exitCode = 1
}
