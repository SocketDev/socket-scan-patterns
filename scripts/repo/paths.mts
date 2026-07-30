/**
 * @file Repo-specific path constants. Inherits every fleet path by re-export
 *   (the "1 path, 1 reference" mantra) and adds only the paths this package
 *   owns: the pinned upstream slices, the generated table data, and the source
 *   tree.
 */

import path from 'node:path'
import process from 'node:process'

import { REPO_ROOT } from '../fleet/paths.mts'

export * from '../fleet/paths.mts'

/**
 * Generated detector tables. Owned by `scripts/repo/gen/`, never hand-edited.
 */
export const DATA_DIR =
  process.env['SCAN_PATTERNS_DATA_DIR'] ?? path.join(REPO_ROOT, 'data')

/**
 * Per-upstream derived rows, one file per generator. These are the raw
 * derivation output; the five consumer tables are composed from them.
 */
export const DATA_SOURCES_DIR = path.join(DATA_DIR, 'sources')

/**
 * Materialized upstream reference slices. Git-ignored, pinned in `.gitmodules`.
 */
export const UPSTREAM_DIR = path.join(REPO_ROOT, 'upstream')

/**
 * The typed accessor API consumers import.
 */
export const SRC_DIR = path.join(REPO_ROOT, 'src')
