import { describe, expect, it } from 'vitest'

import {
  compileRulePathRegex,
  compileRuleRegex,
  findRuleById,
  getAgentConfigsTable,
  getManifestsTable,
  getPatternTable,
  getSecretsTable,
  getSkillsTable,
  getWorkflowsTable,
  isPatternTable,
  selectJsCompilableRules,
} from '../../../src/index.mts'
import type { PatternRule } from '../../../src/types.mts'

describe('published pattern API', () => {
  it.each([
    ['agentConfigs', getAgentConfigsTable],
    ['manifests', getManifestsTable],
    ['secrets', getSecretsTable],
    ['skills', getSkillsTable],
    ['workflows', getWorkflowsTable],
  ] as const)('loads and caches the %s table', (scanner, getter) => {
    const table = getter()
    expect(table.scanner).toBe(scanner)
    expect(table.schemaVersion).toBe(1)
    expect(table.rules.length).toBeGreaterThan(0)
    expect(isPatternTable(table)).toBe(true)
    expect(getPatternTable(scanner)).toBe(table)
    expect(findRuleById(table, table.rules[0]!.id)).toBe(table.rules[0])
    expect(findRuleById(table, 'missing-example-rule')).toBeUndefined()
    expect(selectJsCompilableRules(table)).toEqual(
      table.rules.filter(rule => rule.dialect === 'js'),
    )
  })

  it.each([null, undefined, 42, 'example-table', {}, { rules: [] }])(
    'rejects an incomplete table: %j',
    candidate => {
      expect(isPatternTable(candidate)).toBe(false)
    },
  )

  it('compiles JavaScript content and path patterns with their flags', () => {
    const rule: PatternRule = {
      ...getSecretsTable().rules[0]!,
      dialect: 'js',
      regexFlags: 'i',
      regexSource: '^example-content$',
      pathRegexSource: '^example-manifest[.]json$',
    }
    expect(compileRuleRegex(rule)?.test('EXAMPLE-CONTENT')).toBe(true)
    expect(compileRuleRegex(rule)?.test('unrelated')).toBe(false)
    expect(compileRulePathRegex(rule)?.test('EXAMPLE-MANIFEST.JSON')).toBe(true)
    expect(compileRulePathRegex(rule)?.test('unrelated.json')).toBe(false)
    expect(compileRuleRegex({ ...rule, dialect: 're2' })).toBeUndefined()
    expect(compileRulePathRegex({ ...rule, dialect: 're2' })).toBeUndefined()
    expect(
      compileRuleRegex({ ...rule, regexSource: undefined }),
    ).toBeUndefined()
    expect(
      compileRulePathRegex({ ...rule, pathRegexSource: undefined }),
    ).toBeUndefined()
  })
})
