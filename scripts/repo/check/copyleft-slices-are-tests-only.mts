/*
 * @file `check --all` gate: a copyleft upstream slice admits TESTS ONLY, and
 *   nothing in this repo derives from one.
 *   This is the license boundary expressed as code. TruffleHog is AGPL-3.0;
 *   deriving its rules into this MIT package would relicense the package. The
 *   posture is clean-room: we may observe an AGPL upstream's TESTS (to learn
 *   that a detector family exists) and never its implementation. Five failure
 *   modes are gated:
 *
 *   1. the declared sparse pattern set admits a non-test path,
 *   2. the pattern set is declared in cone mode, which cannot express a file-level
 *      glob and would silently admit whole directories,
 *   3. a non-test file is present in the materialized working tree,
 *   4. a generator reads the slice, or a tracked table cites it as a `source`,
 *   5. the slice has no license on record, so its posture is unknown. Exit 0 when
 *      clean, 1 on any finding.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import type { UpstreamSliceConfig } from '../upstream-config.mts'

import {
  DATA_DIR,
  DATA_SOURCES_DIR,
  REPO_ROOT,
  UPSTREAM_DIR,
} from '../paths.mts'
import { listNonTestFiles } from '../upstream-tree.mts'
import {
  COPYLEFT_TEST_ONLY_PATTERN,
  listUpstreamSliceConfigs,
  UPSTREAM_SLICE_LICENSES,
} from '../upstream-config.mts'

const logger = getDefaultLogger()

/**
 * Directory holding the derivation generators. No copyleft slice may appear
 * here.
 */
export const GEN_DIR = path.join(REPO_ROOT, 'scripts', 'repo', 'gen')

/**
 * A sparse pattern is test-safe when every path it can admit ends in a Go test
 * file or sits under a `testdata` directory. A bare directory prefix (the cone
 * form) admits everything beneath it, so it is never test-safe.
 */
export function isTestOnlySparsePattern(pattern: string): boolean {
  if (pattern.endsWith('_test.go') || pattern.includes('/testdata/')) {
    return true
  }
  // A ROOT-ANCHORED metadata glob (`/LICENSE*`) is allowed; the same glob
  // unanchored (`LICENSE*`) is NOT, because non-cone globs match at any depth
  // and would admit implementation — `NOTICE*` pulls in
  // pkg/detectors/noticeable/noticeable.go on a case-insensitive filesystem.
  return /^\/(?:AUTHORS|CONTRIBUTORS|COPYING|LICENSE|NOTICE|README)[^/]*$/.test(
    pattern,
  )
}

/**
 * One gate finding.
 */
export interface CopyleftFinding {
  readonly detail: string
  readonly fix: string
  readonly slice: string
}

/**
 * Check the declared pattern set and mode.
 */
export function checkSliceDeclaration(
  config: UpstreamSliceConfig,
): readonly CopyleftFinding[] {
  const findings: CopyleftFinding[] = []
  const patterns = (config.sparseCheckout ?? '').split(/\s+/).filter(Boolean)

  if (patterns.length === 0) {
    findings.push({
      detail: `no sparse-checkout declared, so the whole AGPL tree would materialize`,
      fix:
        `set a tests-only pattern set: git config -f .gitmodules ` +
        `submodule.upstream/${config.name}.sparse-checkout ` +
        `'/pkg/**/*_test.go /pkg/**/testdata/**'`,
      slice: config.name,
    })
  }

  const unsafe = patterns.filter(pattern => !isTestOnlySparsePattern(pattern))
  if (unsafe.length > 0) {
    findings.push({
      detail: `sparse-checkout admits non-test path(s): ${unsafe.join(', ')}`,
      fix:
        `narrow every pattern to ${COPYLEFT_TEST_ONLY_PATTERN}. A copyleft ` +
        `upstream's implementation must never land on disk — absence is the block.`,
      slice: config.name,
    })
  }

  if (config.sparseMode !== 'no-cone' && patterns.length > 0) {
    findings.push({
      detail: `sparse-mode is "${config.sparseMode ?? 'cone (default)'}"; cone mode ignores file-level globs and admits whole directories`,
      fix:
        `git config -f .gitmodules submodule.upstream/${config.name}.sparse-mode no-cone, ` +
        `then re-materialize with node scripts/repo/materialize-upstream.mts ${config.name}`,
      slice: config.name,
    })
  }

  return findings
}

/**
 * Check the materialized working tree.
 */
export function checkSliceWorktree(
  config: UpstreamSliceConfig,
): readonly CopyleftFinding[] {
  const worktree = path.join(UPSTREAM_DIR, config.name)
  if (!existsSync(worktree)) {
    return []
  }
  const offenders = listNonTestFiles(worktree)
  if (offenders.length === 0) {
    return []
  }
  return [
    {
      detail: `${offenders.length} non-test file(s) present on disk, e.g. ${offenders.slice(0, 3).join(', ')}`,
      fix:
        `node scripts/repo/materialize-upstream.mts ${config.name} re-applies the ` +
        `no-cone tests-only pattern set. If implementation was read while it was ` +
        `present, treat any resulting rule as contaminated and re-derive it from ` +
        `gitleaks (MIT).`,
      slice: config.name,
    },
  ]
}

/**
 * Check that nothing derives from the slice: no generator reads it, and no
 * emitted table cites it.
 */
export function checkNoDerivation(
  config: UpstreamSliceConfig,
): readonly CopyleftFinding[] {
  const findings: CopyleftFinding[] = []

  // Look for a slice RESOLUTION, not a bare mention. The shared resolver names
  // every copyleft slice in its own blocklist, and a docblock may name one to
  // explain why it is off limits; neither reads a byte. What must never appear
  // is the call that hands a generator the slice's path.
  const resolutionHits = [
    ...findFilesContaining(GEN_DIR, `resolveUpstreamSlice('${config.name}')`),
    ...findFilesContaining(GEN_DIR, `resolveUpstreamSlice("${config.name}")`),
    ...findFilesContaining(GEN_DIR, `upstream/${config.name}/`),
  ]
  if (resolutionHits.length > 0) {
    findings.push({
      detail: `generator(s) resolve or read the slice: ${[...new Set(resolutionHits)].join(', ')}`,
      fix:
        `no generator may read a copyleft slice. Delete the reference. For secret ` +
        `detection derive from gitleaks (MIT) via scripts/repo/gen/import-gitleaks.mts.`,
      slice: config.name,
    })
  }

  for (const dir of [DATA_DIR, DATA_SOURCES_DIR]) {
    if (!existsSync(dir)) {
      continue
    }
    const tableHits = findFilesContaining(dir, `"${config.name}@`)
    if (tableHits.length > 0) {
      findings.push({
        detail: `generated table(s) cite the slice as a provenance source: ${tableHits.join(', ')}`,
        fix:
          `a copyleft upstream may never appear in a row's provenance. Remove the ` +
          `rows and re-run pnpm run gen.`,
        slice: config.name,
      })
    }
  }

  return findings
}

/**
 * Repo-relative paths of files under `dir` whose text contains `needle`.
 */
export function findFilesContaining(
  dir: string,
  needle: string,
): readonly string[] {
  const hits: string[] = []
  const walk = (current: string): void => {
    const entries = readdirSync(current, { withFileTypes: true })
    for (let i = 0, { length } = entries; i < length; i += 1) {
      const entry = entries[i]!
      const abs = path.join(current, entry.name)
      if (entry.isDirectory()) {
        walk(abs)
      } else if (readFileSync(abs, 'utf8').includes(needle)) {
        hits.push(path.relative(REPO_ROOT, abs))
      }
    }
  }
  if (existsSync(dir)) {
    walk(dir)
  }
  return hits.toSorted()
}

/**
 * Run every gate and report.
 */
export function checkCopyleftSlices(): readonly CopyleftFinding[] {
  const findings: CopyleftFinding[] = []
  const configs = listUpstreamSliceConfigs()
  for (let i = 0, { length } = configs; i < length; i += 1) {
    const config = configs[i]!
    if (!UPSTREAM_SLICE_LICENSES[config.name]) {
      findings.push({
        detail: `no license on record, so its copyleft posture is unknown`,
        fix:
          `add "${config.name}" to UPSTREAM_SLICE_LICENSES in ` +
          `scripts/repo/upstream-config.mts with its SPDX identifier`,
        slice: config.name,
      })
      continue
    }
    if (!config.copyleft) {
      continue
    }
    findings.push(
      ...checkSliceDeclaration(config),
      ...checkSliceWorktree(config),
      ...checkNoDerivation(config),
    )
  }
  return findings
}

/**
 * CLI entry point.
 */
export function main(): void {
  const findings = checkCopyleftSlices()
  if (findings.length === 0) {
    const copyleft = listUpstreamSliceConfigs().filter(
      config => config.copyleft,
    )
    logger.info(
      `copyleft-slices-are-tests-only: ${copyleft.length} copyleft slice(s) are tests-only and underived.`,
    )
    return
  }
  logger.error(
    `copyleft-slices-are-tests-only: ${findings.length} finding(s) — a copyleft upstream's implementation must be unreadable, not merely uncopied.`,
  )
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const finding = findings[i]!
    logger.error(`  where: upstream/${finding.slice}`)
    logger.error(`  saw:   ${finding.detail}`)
    logger.error(
      `  wanted: ${COPYLEFT_TEST_ONLY_PATTERN} only, and zero derivation`,
    )
    logger.error(`  fix:   ${finding.fix}`)
  }
  process.exitCode = 1
}

main()
