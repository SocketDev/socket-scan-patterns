/**
 * @file Derives agent-config rows from AgentShield's built-in rule modules.
 *   MIT. Reads only `upstream/agentshield/src/rules/*.ts`.
 *   AgentShield's rules are TypeScript predicates — each rule's body is a
 *   `check(file, allFiles)` function, not a pattern. So the derivable surface
 *   is each rule's DECLARED metadata (id, name, description, severity,
 *   category), which the upstream writes as a uniform literal header on every
 *   rule. Those become `kind: 'audit'` rows: a consumer learns what AgentShield
 *   checks and at what severity, and implements the predicate itself.
 *   `src/injection/payloads.ts` is deliberately NOT derived. It is a red-team
 *   corpus of prose jailbreak payloads, not a detector table — matching those
 *   strings literally would catch only verbatim copies. Prompt-injection
 *   DETECTION comes from the SkillSpector generator, which ships real regexes.
 */

import { readdirSync } from 'node:fs'
import path from 'node:path'

import type { PatternRule, PatternSeverity } from './_shared/table-types.mts'
import type { DerivedRowSet } from './_shared/emit-table.mts'
import type { UpstreamSlice } from './_shared/upstream-slice.mts'

import { assertRowsPresent, writeSourceRowSet } from './_shared/emit-table.mts'
import {
  readSliceFile,
  resolveUpstreamSlice,
  sliceFilePath,
} from './_shared/upstream-slice.mts'

/**
 * Directory of rule modules inside the pinned slice.
 */
export const AGENTSHIELD_RULES_REL_DIR = 'src/rules'

/**
 * Rule modules that feed the `skills` table rather than `agentConfigs`.
 * AgentShield tags these `category: "skills"` and they only fire on
 * `SKILL.md`, so they belong with the other skill scanners.
 */
export const AGENTSHIELD_SKILL_MODULES: readonly string[] = ['skills']

/**
 * Modules that are not rule sources.
 */
export const AGENTSHIELD_NON_RULE_MODULES: readonly string[] = ['index']

/**
 * Rows the upstream is known to carry at the pinned tag.
 */
export const AGENTSHIELD_MIN_EXPECTED_RULES = 100

/**
 * Map AgentShield's severity vocabulary onto the table scale. The two agree
 * token-for-token, so an unknown value means the upstream added a tier and the
 * mapping needs a decision rather than a silent default.
 */
export function agentShieldSeverity(raw: string): PatternSeverity {
  switch (raw) {
    case 'critical':
      return 'critical'
    case 'high':
      return 'high'
    case 'info':
      return 'info'
    case 'low':
      return 'low'
    case 'medium':
      return 'medium'
    default:
      throw new Error(
        `Unmapped AgentShield severity.\n` +
          `  where: scripts/repo/gen/import-agentshield.mts agentShieldSeverity\n` +
          `  saw:   "${raw}"\n` +
          `  wanted: one of critical, high, info, low, medium\n` +
          `  fix:   the upstream added a severity tier — map it onto PatternSeverity`,
      )
  }
}

/**
 * A rule's declared metadata header.
 */
export interface AgentShieldRuleMeta {
  readonly category: string
  readonly description: string
  readonly id: string
  readonly name: string
  readonly severity: string
}

/**
 * Read every top-level rule header out of a module. A rule literal opens at
 * four-space indentation inside the exported array; nested `Finding` objects
 * inside a `check()` body are indented deeper, so anchoring on the exact
 * indentation is what keeps findings out of the table.
 */
export function parseAgentShieldRules(
  source: string,
): readonly AgentShieldRuleMeta[] {
  const metas: AgentShieldRuleMeta[] = []
  // Matches a rule literal's five-line declared header at EXACTLY four-space
  // indent — id, name, description (which the upstream sometimes wraps onto
  // the next line), severity, category. The indent anchor is what excludes the
  // deeper-nested Finding objects built inside each check() body.
  const pattern =
    /^ {4}id: "([^"]+)",\n {4}name: "((?:[^"\\]|\\.)*)",\n {4}description:\s*\n? *"((?:[^"\\]|\\.)*)",\n {4}severity: "([^"]+)",\n {4}category: "([^"]+)",/gm
  let matched = pattern.exec(source)
  while (matched) {
    metas.push({
      category: matched[5]!,
      description: unescapeDoubleQuoted(matched[3]!),
      id: matched[1]!,
      name: unescapeDoubleQuoted(matched[2]!),
      severity: matched[4]!,
    })
    matched = pattern.exec(source)
  }
  return metas
}

/**
 * Undo the escaping of a TypeScript double-quoted string literal.
 */
export function unescapeDoubleQuoted(raw: string): string {
  return raw
    .replace(/\\n/g, ' ')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Both AgentShield row sets, split by which table they belong to.
 */
export interface AgentShieldRowSets {
  readonly agentConfigs: DerivedRowSet
  readonly skills: DerivedRowSet
}

/**
 * Parse every rule module in the pinned slice.
 */
export function deriveAgentShieldRules(
  slice: UpstreamSlice,
): AgentShieldRowSets {
  const rulesDir = path.join(slice.rootPath, AGENTSHIELD_RULES_REL_DIR)
  const moduleFiles = readdirSync(rulesDir)
    .filter(name => name.endsWith('.ts'))
    .toSorted()

  const agentConfigRules: PatternRule[] = []
  const skillRules: PatternRule[] = []

  for (let i = 0, { length } = moduleFiles; i < length; i += 1) {
    const fileName = moduleFiles[i]!
    const moduleName = fileName.replace(/\.ts$/, '')
    if (AGENTSHIELD_NON_RULE_MODULES.includes(moduleName)) {
      continue
    }
    const relPath = `${AGENTSHIELD_RULES_REL_DIR}/${fileName}`
    const source = readSliceFile(slice, relPath)
    const sourceFile = sliceFilePath(slice, relPath)
    const metas = parseAgentShieldRules(source)
    const target = AGENTSHIELD_SKILL_MODULES.includes(moduleName)
      ? skillRules
      : agentConfigRules
    for (let j = 0, metaCount = metas.length; j < metaCount; j += 1) {
      const meta = metas[j]!
      target.push({
        category: meta.category,
        description: meta.description,
        entropy: undefined,
        id: `agentshield:${meta.id}`,
        keywords: [],
        kind: 'audit',
        pathRegexSource: undefined,
        provenance: {
          license: slice.license,
          ruleId: meta.id,
          source: slice.source,
          sourceFile,
        },
        regexFlags: '',
        regexSource: undefined,
        severity: agentShieldSeverity(meta.severity),
        title: meta.name,
      })
    }
  }

  const total = agentConfigRules.length + skillRules.length
  assertRowsPresent(agentConfigRules, {
    generator: 'scripts/repo/gen/import-agentshield.mts',
    sourceFile: sliceFilePath(slice, AGENTSHIELD_RULES_REL_DIR),
  })
  if (total < AGENTSHIELD_MIN_EXPECTED_RULES) {
    throw new Error(
      `AgentShield parse returned an implausibly small table.\n` +
        `  where: ${sliceFilePath(slice, AGENTSHIELD_RULES_REL_DIR)}\n` +
        `  saw:   ${total} rules across ${moduleFiles.length} modules\n` +
        `  wanted: at least ${AGENTSHIELD_MIN_EXPECTED_RULES}\n` +
        `  fix:   the rule literal header shape changed at ${slice.source}. ` +
        `Update parseAgentShieldRules in ` +
        `scripts/repo/gen/import-agentshield.mts, then re-run pnpm run gen.`,
    )
  }

  return {
    agentConfigs: { rules: agentConfigRules, sources: [slice.source] },
    skills: { rules: skillRules, sources: [slice.source] },
  }
}

/**
 * Generator entry point: writes `data/sources/agentshield-agent-configs.json`
 * and `data/sources/agentshield-skills.json`.
 */
export function generateAgentShieldSources(): AgentShieldRowSets {
  const slice = resolveUpstreamSlice('agentshield')
  const rowSets = deriveAgentShieldRules(slice)
  writeSourceRowSet('agentshield-agent-configs', rowSets.agentConfigs)
  writeSourceRowSet('agentshield-skills', rowSets.skills)
  return rowSets
}
