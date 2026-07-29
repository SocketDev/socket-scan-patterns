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
 * The tests-only allowlist for a copyleft slice: a Go test file, or anything
 * under a `testdata` directory. Everything else is implementation and must
 * never materialize.
 */
export function isAllowedCopyleftPath(relPath: string): boolean {
  const normalized = normalizePath(relPath)
  return normalized.endsWith('_test.go') || normalized.includes('/testdata/')
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
