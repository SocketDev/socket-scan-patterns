/**
 * @file Composes the five consumer tables from the per-upstream derivations.
 *   Generators are one-per-upstream; tables are one-per-scanner, and the two do
 *   not line up 1:1 — `secrets` merges gitleaks and Trivy, `skills` merges
 *   SkillSpector, AgentShield and codex-security. Keeping composition separate
 *   from derivation means re-shaping a table never requires re-reading (or even
 *   materializing) an upstream slice.
 *   `manifests` is a VIEW, not a separate upstream: it is the subset of secret
 *   rules whose firing is gated on a manifest or config file path. Those rules
 *   are what a package-manifest scan needs, and they already carry the right
 *   provenance from whichever upstream declared them.
 */

import type { DerivedRowSet } from './_shared/emit-table.mts'
import type { PatternRule, ScannerName } from './_shared/table-types.mts'

import { readSourceRowSet, writeScannerTable } from './_shared/emit-table.mts'

/**
 * One composed table: which sources feed it and what file it lands in.
 */
export interface TablePlan {
  readonly fileName: string
  readonly scanner: ScannerName
  readonly sourceNames: readonly string[]
}

/**
 * Which per-upstream derivations feed each scanner table.
 */
export const TABLE_PLANS: readonly TablePlan[] = [
  {
    fileName: 'agent-configs.json',
    scanner: 'agentConfigs',
    sourceNames: ['agentshield-agent-configs'],
  },
  {
    fileName: 'secrets.json',
    scanner: 'secrets',
    sourceNames: ['gitleaks', 'trivy'],
  },
  {
    fileName: 'skills.json',
    scanner: 'skills',
    sourceNames: ['agentshield-skills', 'codex-security', 'skillspector'],
  },
  {
    fileName: 'workflows.json',
    scanner: 'workflows',
    sourceNames: ['zizmor'],
  },
]

/**
 * Where the manifests view is written.
 */
export const MANIFESTS_FILE_NAME = 'manifests.json'

/**
 * A rule belongs in the `manifests` view when it is path-gated — its firing
 * depends on the file being a specific manifest or config file (`settings.xml`,
 * `nuget.config`, a `.tf`, a Kubernetes YAML). A rule that fires on any file is
 * a general secret rule and stays out.
 */
export function isManifestScopedRule(rule: PatternRule): boolean {
  return rule.kind === 'path' && Boolean(rule.pathRegexSource)
}

/**
 * Merge several derivations into one row set.
 */
export function mergeRowSets(sourceNames: readonly string[]): DerivedRowSet {
  const rules: PatternRule[] = []
  const sources = new Set<string>()
  for (let i = 0, { length } = sourceNames; i < length; i += 1) {
    const rowSet = readSourceRowSet(sourceNames[i]!)
    rules.push(...rowSet.rules)
    for (const source of rowSet.sources) {
      sources.add(source)
    }
  }
  return { rules, sources: [...sources] }
}

/**
 * What a composition run produced, for the summary line.
 */
export interface ComposedTable {
  readonly fileName: string
  readonly ruleCount: number
  readonly scanner: ScannerName
}

/**
 * Compose and write every table.
 */
export function composeAllTables(): readonly ComposedTable[] {
  const composed: ComposedTable[] = []

  for (let i = 0, { length } = TABLE_PLANS; i < length; i += 1) {
    const plan = TABLE_PLANS[i]!
    const rowSet = mergeRowSets(plan.sourceNames)
    writeScannerTable(plan.scanner, plan.fileName, rowSet)
    composed.push({
      fileName: plan.fileName,
      ruleCount: rowSet.rules.length,
      scanner: plan.scanner,
    })
  }

  // The manifests view derives from the already-composed secrets row set.
  const secretsRowSet = mergeRowSets(['gitleaks', 'trivy'])
  const manifestRules = secretsRowSet.rules.filter(isManifestScopedRule)
  const manifestSources = new Set<string>()
  for (let i = 0, { length } = manifestRules; i < length; i += 1) {
    manifestSources.add(manifestRules[i]!.provenance.source)
  }
  writeScannerTable('manifests', MANIFESTS_FILE_NAME, {
    rules: manifestRules,
    sources: [...manifestSources],
  })
  composed.push({
    fileName: MANIFESTS_FILE_NAME,
    ruleCount: manifestRules.length,
    scanner: 'manifests',
  })

  return composed
}
