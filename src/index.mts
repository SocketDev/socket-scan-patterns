/**
 * @file Public API: the five scanner tables plus the types and helpers needed
 *   to use them.
 *   Tables are loaded lazily. socket-cli inlines the JSON at build time and
 *   only reaches for the subcommand it is running, so eagerly parsing ~900
 *   rules across five files on import would be work nobody asked for.
 */

export type {
  PatternDialect,
  PatternKind,
  PatternProvenance,
  PatternRule,
  PatternSeverity,
  PatternTable,
  ScannerName,
} from './types.mts'

export {
  PATTERN_SEVERITY_ORDER,
  PATTERN_TABLE_SCHEMA_VERSION,
} from './types.mts'

export {
  compileRulePathRegex,
  compileRuleRegex,
  findRuleById,
  isPatternTable,
  loadPatternTable,
  selectJsCompilableRules,
  TABLE_FILE_BY_SCANNER,
} from './load-table.mts'

import type { PatternTable, ScannerName } from './types.mts'

import { loadPatternTable } from './load-table.mts'

const tableCache = new Map<ScannerName, PatternTable>()

/**
 * Agent-configuration rules, derived from AgentShield (MIT). Backs
 * `socket scan agent-configs`.
 */
export function getAgentConfigsTable(): PatternTable {
  return getPatternTable('agentConfigs')
}

/**
 * Manifest-scoped secret rules — the subset whose firing is gated on a
 * package-manifest or config file path. Backs `socket scan manifests`.
 */
export function getManifestsTable(): PatternTable {
  return getPatternTable('manifests')
}

/**
 * Load a scanner table once and memoize it.
 */
export function getPatternTable(scanner: ScannerName): PatternTable {
  const cached = tableCache.get(scanner)
  if (cached) {
    return cached
  }
  const table = loadPatternTable(scanner)
  tableCache.set(scanner, table)
  return table
}

/**
 * Secret-detector patterns, derived from gitleaks (MIT) and Trivy
 * (Apache-2.0). Backs `socket scan secrets`.
 */
export function getSecretsTable(): PatternTable {
  return getPatternTable('secrets')
}

/**
 * Agent-skill scanning patterns, derived from NVIDIA SkillSpector
 * (Apache-2.0), AgentShield (MIT) and codex-security (Apache-2.0). Backs
 * `socket scan skills`.
 */
export function getSkillsTable(): PatternTable {
  return getPatternTable('skills')
}

/**
 * GitHub Actions workflow audits, ported from zizmor's documentation (MIT).
 * Backs `socket scan workflows`.
 */
export function getWorkflowsTable(): PatternTable {
  return getPatternTable('workflows')
}
