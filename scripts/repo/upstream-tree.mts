/**
 * @file Side-effect-free helpers for inspecting a materialized upstream slice.
 *   These live apart from `materialize-upstream.mts` on purpose: that module is
 *   a CLI with a top-level `await main()`, so importing it to borrow a helper
 *   would run a full re-materialization. The tests-only gate needs the walker
 *   without the side effect.
 */

import { readdirSync } from 'node:fs'
import path from 'node:path'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

/**
 * Root-level metadata a copyleft slice may materialize. `LICENSE` is
 * load-bearing: the SPDX id recorded for a slice must be verifiable from the
 * upstream's own LICENSE, so blocking that read would make the rule
 * unfollowable.
 *
 * ROOT-level only, and that anchoring is the whole point. The fleet recipe's
 * unanchored `NOTICE*` / `README*` globs match at ANY depth, and on a
 * case-insensitive filesystem that pulls in
 * `pkg/detectors/noticeable/noticeable.go` and `pkg/detectors/readme/readme.go`
 * — two AGPL detector IMPLEMENTATIONS, the exact bytes this posture exists to
 * keep off disk. Anchoring with a leading `/` in the sparse pattern, and
 * requiring a bare basename here, closes that hole.
 */
export const COPYLEFT_ROOT_METADATA =
  /^(?:AUTHORS|CONTRIBUTORS|COPYING|LICENSE|NOTICE|README)[^/]*$/

/**
 * The tests-only allowlist for a copyleft slice: a Go test file, anything
 * under a `testdata` directory, or a root-level metadata file. Everything else
 * is implementation and must never materialize.
 */
export function isAllowedCopyleftPath(relPath: string): boolean {
  const normalized = normalizePath(relPath)
  return (
    normalized.endsWith('_test.go') ||
    normalized.includes('/testdata/') ||
    COPYLEFT_ROOT_METADATA.test(normalized)
  )
}

/**
 * Walk a slice's working tree, skipping git's own metadata.
 */
export function walkSliceFiles(
  root: string,
  onFile: (relPath: string) => void,
): void {
  const walk = (dir: string, prefix: string): void => {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (let i = 0, { length } = entries; i < length; i += 1) {
      const entry = entries[i]!
      if (entry.name === '.git') {
        continue
      }
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), relPath)
      } else {
        onFile(relPath)
      }
    }
  }
  walk(root, '')
}

/**
 * Every working-tree file in a slice that is neither a Go test nor a fixture.
 */
export function listNonTestFiles(worktree: string): readonly string[] {
  const found: string[] = []
  walkSliceFiles(worktree, relPath => {
    if (!isAllowedCopyleftPath(relPath)) {
      found.push(relPath)
    }
  })
  return found.toSorted()
}
