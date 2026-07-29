/*
 * @file Exports-map generator config.
 *
 *   The bundle has ONE entry point (`src/index.mts` → `dist/index.js`), but
 *   `tsc --emitDeclarationOnly` writes one `.d.mts` per source module, so
 *   `dist/types.d.mts` and `dist/load-table.d.mts` land beside the entry
 *   declaration. They are not separate public entry points — `index.d.mts`
 *   re-exports everything through them, and that is the only way a consumer
 *   reaches them.
 *
 *   Giving each one its own `exports` subpath would advertise an API surface
 *   this package does not intend to keep stable, so they are declared
 *   generator-ignored instead. The runtime bundle stays single-entry.
 */

/**
 * Shape the exports generator and `public-files-are-exported` both read.
 */
export interface PackageExportsConfig {
  readonly ignore: readonly string[]
}

export const config: PackageExportsConfig = {
  ignore: ['dist/*.d.mts'],
}
