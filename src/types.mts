/**
 * @file Table types shared by every generated detector table and by the
 *   runtime accessor API consumers import.
 */

/**
 * Which baseline scanner a table drives. One value per `socket scan <name>`
 * subcommand.
 */
export type ScannerName =
  | 'agentConfigs'
  | 'manifests'
  | 'secrets'
  | 'skills'
  | 'workflows'

/**
 * Normalized finding severity. Upstreams disagree on vocabulary — Trivy says
 * `CRITICAL`, AgentShield says `critical`, zizmor says `high` — so every
 * generator maps onto this one scale rather than passing the upstream string
 * through.
 */
export type PatternSeverity = 'critical' | 'high' | 'info' | 'low' | 'medium'

/**
 * How a rule decides whether it fired.
 *
 * - `regex` — a regular expression matched against file content.
 * - `path` — a regular expression matched against the file path, gating a content
 *   match to a specific manifest or config file.
 * - `audit` — a documented check implemented in code rather than as a pattern
 *   (every zizmor port, and every AgentShield rule whose upstream body is a
 *   TypeScript predicate).
 * - `capability` — a declarative requirement on a manifest or plugin descriptor
 *   rather than a match over source text.
 */
export type PatternKind = 'audit' | 'capability' | 'path' | 'regex'

/**
 * Which regex engine `regexSource` is valid for.
 *
 * - `js` — compiles with `new RegExp(regexSource, regexFlags)`. The generators
 *   verify this by actually constructing it, so a `js` row is guaranteed
 *   loadable.
 * - `re2` — needs a Go/RE2-class engine. Upstreams write scoped inline flags
 *   (`foo(?i)bar`) that JavaScript cannot express at all; hoisting them to a
 *   global flag would change what the pattern matches, so the row is published
 *   untranslated and honestly labelled instead of being silently broadened or
 *   silently dropped.
 */
export type PatternDialect = 'js' | 're2'

/**
 * Per-row provenance. Every generated row carries one; a row without
 * provenance is a defect, not an omission. `source` is the upstream project
 * at its pinned release, so a row can always be traced back to the exact
 * bytes it came from.
 */
export interface PatternProvenance {
  /**
   * SPDX identifier of the upstream this row derives from.
   */
  readonly license: string
  /**
   * The rule's identifier in the upstream, verbatim.
   */
  readonly ruleId: string
  /**
   * `<upstream>@<pinned tag>`, e.g. `gitleaks@v8.30.1`.
   */
  readonly source: string
  /**
   * Repo-relative path of the upstream file the row was read from.
   */
  readonly sourceFile: string
}

/**
 * One detector rule.
 *
 * `regexSource` + `regexFlags` are kept as strings rather than a live
 * `RegExp` so a table survives JSON transport and so socket-cli can inline it
 * at build time. Build the `RegExp` at the point of use.
 */
export interface PatternRule {
  /**
   * Coarse grouping within a table, e.g. `AWS`, `mcp`, `template-injection`.
   */
  readonly category: string
  /**
   * What the rule detects, in one sentence.
   */
  readonly description: string
  /**
   * Shannon-entropy floor a match must clear, when the upstream sets one.
   */
  readonly entropy?: number | undefined
  /**
   * Stable rule identifier, unique within its table.
   */
  readonly id: string
  /**
   * Literal substrings that must be present before the regex is tried.
   */
  readonly keywords: readonly string[]
  /**
   * Engine `regexSource` is valid for. Check this before compiling.
   */
  readonly dialect: PatternDialect
  readonly kind: PatternKind
  /**
   * Flags for `regexSource`, e.g. `i`. Empty when the rule sets none.
   */
  readonly regexFlags: string
  /**
   * Regex matched against the file path, for `kind: 'path'` rules.
   */
  readonly pathRegexSource?: string | undefined
  readonly provenance: PatternProvenance
  /**
   * Regex matched against file content. Absent for `audit`/`capability`.
   */
  readonly regexSource?: string | undefined
  readonly severity: PatternSeverity
  /**
   * Human-readable rule name.
   */
  readonly title: string
}

/**
 * A generated table: the rules for one scanner plus the provenance of the
 * generation run itself.
 */
export interface PatternTable {
  /**
   * Sorted list of `<upstream>@<tag>` strings the rows derive from.
   */
  readonly sources: readonly string[]
  readonly rules: readonly PatternRule[]
  readonly scanner: ScannerName
  /**
   * Bumped when the table's SHAPE changes, not when a row changes.
   */
  readonly schemaVersion: number
}

/**
 * Current table schema version. Bump only on a breaking shape change, so a
 * consumer pinned to an older major can refuse a table it cannot read.
 */
export const PATTERN_TABLE_SCHEMA_VERSION = 1

/**
 * Severity ordering, most severe first. Sorting by this rather than
 * alphabetically keeps a rendered report's worst findings at the top.
 */
export const PATTERN_SEVERITY_ORDER: readonly PatternSeverity[] = [
  'critical',
  'high',
  'medium',
  'low',
  'info',
]
