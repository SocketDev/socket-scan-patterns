/**
 * @file The ONE place tooling reaches into `src/` for the table types.
 *   `socket/prefer-stable-self-import` normally requires tooling to import the
 *   PUBLISHED `-stable` surface rather than WIP `src/`. That surface does not
 *   exist yet: `@socketsecurity/scan-patterns` is at 0.0.0 and unpublished, so
 *   there is no `@socketsecurity/scan-patterns-stable` to import. The
 *   generators must also type against the exact shape they emit — a second
 *   hand-maintained copy of `PatternRule` would drift from the one consumers
 *   read, which is the failure this package exists to prevent.
 *   So the exception is taken exactly once, here, and every generator imports
 *   from this module. When the first version publishes, this file changes to
 *   re-export from `@socketsecurity/scan-patterns-stable` and the disable goes
 *   away — a one-line edit rather than a sweep.
 */

// oxlint-disable-next-line socket/prefer-stable-self-import -- package is unpublished (0.0.0), so no -stable surface exists yet; see the docblock above. Single chokepoint for the whole scripts/ tree.
export type {
  PatternDialect,
  PatternKind,
  PatternProvenance,
  PatternRule,
  PatternSeverity,
  PatternTable,
  ScannerName,
} from '../../../../src/types.mts'

// oxlint-disable-next-line socket/prefer-stable-self-import -- see above; the runtime constant travels with the types it describes.
export { PATTERN_TABLE_SCHEMA_VERSION } from '../../../../src/types.mts'
