/*
 * @file Rolldown configuration for the published bundle.
 *
 *   Source is ESM `.mts`; output is CJS, the fleet publish shape. The bundle
 *   is deliberately tiny — this package is a DATA package. `src/` is only the
 *   typed accessor over `data/*.json`, and the tables themselves ship as JSON
 *   next to the bundle rather than being inlined, so:
 *
 *   - socket-cli can inline only the one table its subcommand needs at ITS
 *     build time instead of paying for all five, and
 *   - the composite actions in the sauce repo can read a table with plain
 *     `JSON.parse`, no bundler in the loop.
 *
 *   That is why the JSON is `external` here and `files` ships `data/**\/*.json`.
 */

import path from 'node:path'

import type { RolldownOptions } from 'rolldown'

import { REPO_ROOT } from '../../scripts/fleet/paths.mts'

const srcPath = path.join(REPO_ROOT, 'src')
const distPath = path.join(REPO_ROOT, 'dist')

const config: RolldownOptions = {
  external: [
    // Keep the tables as sibling JSON, loaded at runtime — see the file docblock.
    /^\.\.\/data\/.*\.json$/,
    /^node:/,
  ],
  input: { index: path.join(srcPath, 'index.mts') },
  output: {
    dir: distPath,
    entryFileNames: '[name].js',
    format: 'cjs',
    sourcemap: false,
  },
  platform: 'node',
}

export default config
