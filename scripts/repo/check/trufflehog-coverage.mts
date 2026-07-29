/**
 * @file Coverage-comparison ORACLE. Reports which secret-detector families
 *   TruffleHog covers that this package's `secrets` table does not.
 *   🚨 TruffleHog is AGPL-3.0 and this package is MIT. This script may read
 *   ONLY test FILE PATHS from the pinned slice — never a file's CONTENTS,
 *   never an implementation file, never a registry. The fact that
 *   `pkg/detectors/stripe/stripe_test.go` exists is enough to conclude "a
 *   Stripe detector exists"; that conclusion is a fact about the world, not a
 *   copyrightable expression. The slice's sparse-checkout admits nothing but
 *   tests, so the stronger guarantee is structural: there is no implementation
 *   on disk to read.
 *   This is an ORACLE, not a gate. It ALWAYS exits 0. A gap here is a prompt
 *   to write an original rule (or derive one from gitleaks, MIT) — never a
 *   licence to port one from TruffleHog.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { DATA_DIR, UPSTREAM_DIR } from '../paths.mts'
import {
  readStringArrayProp,
  readStringProp,
  readTableRuleObjects,
} from '../read-json.mts'
import { walkSliceFiles } from '../upstream-tree.mts'

const logger = getDefaultLogger()

/**
 * The copyleft slice this oracle observes.
 */
export const ORACLE_SLICE = 'trufflehog'

/**
 * Directory under the slice whose subdirectories name detector families.
 */
export const DETECTORS_REL_DIR = 'pkg/detectors'

/**
 * Detector-family names inferred from TEST FILE PATHS only.
 *
 * A family is a directory under `pkg/detectors/` that contains a `_test.go`
 * file. Top-level `pkg/detectors/*_test.go` files are framework tests, not
 * detectors, so a path with no intervening directory is skipped. A trailing
 * `/v1`, `/v2` … is an API-version split of one family and is folded away.
 *
 * No file is opened. Only `readdir` output is consulted.
 */
export function readTruffleHogDetectorFamilies(): ReadonlySet<string> {
  const families = new Set<string>()
  const detectorsDir = path.join(UPSTREAM_DIR, ORACLE_SLICE, DETECTORS_REL_DIR)
  if (!existsSync(detectorsDir)) {
    return families
  }
  walkSliceFiles(detectorsDir, rawPath => {
    const relPath = normalizePath(rawPath)
    if (!relPath.endsWith('_test.go')) {
      return
    }
    const segments = relPath.split('/')
    if (segments.length < 2) {
      return
    }
    const family = segments[0]!
    if (family.length > 0) {
      families.add(family)
    }
  })
  return families
}

/**
 * Normalize a name for comparison: lowercase, strip separators. TruffleHog
 * writes `airtablepersonalaccesstoken`; gitleaks writes
 * `airtable-personal-access-token`.
 */
export function normalizeFamilyToken(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Family tokens this package's secrets table covers, taken from each row's id,
 * category, and keywords.
 */
export function readCoveredFamilies(): ReadonlySet<string> {
  const covered = new Set<string>()
  const tablePath = path.join(DATA_DIR, 'secrets.json')
  if (!existsSync(tablePath)) {
    return covered
  }
  const rules = readTableRuleObjects(tablePath)
  for (let i = 0, { length } = rules; i < length; i += 1) {
    const rule = rules[i]!
    const id = readStringProp(rule, 'id') ?? ''
    const bareId = id.includes(':') ? id.slice(id.indexOf(':') + 1) : id
    covered.add(normalizeFamilyToken(bareId))
    covered.add(normalizeFamilyToken(readStringProp(rule, 'category') ?? ''))
    const keywords = readStringArrayProp(rule, 'keywords')
    for (let j = 0, keywordCount = keywords.length; j < keywordCount; j += 1) {
      covered.add(normalizeFamilyToken(keywords[j]!))
    }
  }
  covered.delete('')
  return covered
}

/**
 * A family counts as covered when any covered token contains its normalized
 * name, or vice versa. Deliberately generous: this is an advisory signal, and
 * a false "covered" is cheaper than a wall of false gaps nobody reads.
 */
export function isFamilyCovered(
  family: string,
  covered: ReadonlySet<string>,
): boolean {
  const token = normalizeFamilyToken(family)
  if (token.length === 0 || covered.has(token)) {
    return true
  }
  for (const candidate of covered) {
    if (
      candidate.length >= 4 &&
      (candidate.includes(token) || token.includes(candidate))
    ) {
      return true
    }
  }
  return false
}

/**
 * What the oracle found.
 */
export interface CoverageReport {
  readonly covered: number
  readonly gaps: readonly string[]
  readonly upstreamFamilies: number
}

/**
 * Compare the two family sets.
 */
export function compareDetectorCoverage(): CoverageReport {
  const upstream = readTruffleHogDetectorFamilies()
  const covered = readCoveredFamilies()
  const gaps: string[] = []
  for (const family of upstream) {
    if (!isFamilyCovered(family, covered)) {
      gaps.push(family)
    }
  }
  gaps.sort()
  return {
    covered: upstream.size - gaps.length,
    gaps,
    upstreamFamilies: upstream.size,
  }
}

/**
 * CLI entry point. Always exits 0 — an oracle reports, it does not gate.
 */
export function main(): void {
  const detectorsDir = path.join(UPSTREAM_DIR, ORACLE_SLICE, DETECTORS_REL_DIR)
  if (!existsSync(detectorsDir)) {
    logger.info(
      `trufflehog-coverage: slice not materialized — skipping. ` +
        `Run node scripts/repo/materialize-upstream.mts ${ORACLE_SLICE} to enable the oracle.`,
    )
    return
  }

  const report = compareDetectorCoverage()
  logger.info(
    `trufflehog-coverage: ${report.covered}/${report.upstreamFamilies} upstream detector families have a counterpart in data/secrets.json.`,
  )
  if (report.gaps.length === 0) {
    return
  }
  logger.info(
    `trufflehog-coverage: ${report.gaps.length} family name(s) with no counterpart (advisory — this NEVER fails the build):`,
  )
  const preview = report.gaps.slice(0, 40)
  for (let i = 0, { length } = preview; i < length; i += 1) {
    logger.info(`  - ${preview[i]}`)
  }
  if (report.gaps.length > preview.length) {
    logger.info(`  … and ${report.gaps.length - preview.length} more`)
  }
  logger.info(
    `trufflehog-coverage: to close a gap, add a rule to a PERMISSIVE upstream's ` +
      `generator (gitleaks is MIT) or author an original Socket rule. Never port ` +
      `one from TruffleHog — it is AGPL-3.0 and this package is MIT.`,
  )
}

main()
