/**
 * @file Fixture-driven tests for the gitleaks TOML parser. The fixtures below
 *   are hand-written miniatures of the real block shapes in
 *   `config/gitleaks.toml` — including the `[rules.allowlist]` subtable, which
 *   is the case that makes a naive scalar read pick up the WRONG regex.
 */

import { describe, expect, it } from 'vitest'

import {
  gitleaksCategoryFromId,
  readGitleaksKeywords,
  readGitleaksNumber,
  readGitleaksScalar,
  splitGitleaksRuleBlocks,
} from '../../../scripts/repo/gen/import-gitleaks.mts'

const TWO_RULES = `
title = "gitleaks config"

[[rules]]
id = "adobe-client-id"
description = "An Adobe OAuth Web Client ID."
regex = '''(?i)adobe[a-f0-9]{32}'''
entropy = 2
keywords = ["adobe"]

[[rules]]
id = "nuget-config-password"
description = "A NuGet config password."
regex = '''(?i)<add key="ClearTextPassword" value="(.{8,64})"'''
path = '''(?i)nuget\\.config$'''
keywords = ["cleartextpassword"]
`

const RULE_WITH_ALLOWLIST = `
[[rules]]
id = "generic-api-key"
description = "A generic API key."
regex = '''api[_-]?key\\s*=\\s*([a-z0-9]{32})'''
keywords = ["api_key", "apikey"]

[rules.allowlist]
regex = '''example|sample'''
path = '''(?i)\\.md$'''
`

describe('splitGitleaksRuleBlocks', () => {
  it('splits each [[rules]] block', () => {
    expect(splitGitleaksRuleBlocks(TWO_RULES)).toHaveLength(2)
  })

  it('returns nothing for a config with no rules', () => {
    expect(splitGitleaksRuleBlocks('title = "x"\n')).toHaveLength(0)
  })

  it('keeps a rule and its [rules.allowlist] subtable in one block', () => {
    const blocks = splitGitleaksRuleBlocks(RULE_WITH_ALLOWLIST)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toContain('[rules.allowlist]')
  })
})

describe('readGitleaksScalar', () => {
  it('reads a triple-quoted literal string', () => {
    const block = splitGitleaksRuleBlocks(TWO_RULES)[0]!
    expect(readGitleaksScalar(block, 'regex')).toBe('(?i)adobe[a-f0-9]{32}')
  })

  it('reads a basic double-quoted string', () => {
    const block = splitGitleaksRuleBlocks(TWO_RULES)[0]!
    expect(readGitleaksScalar(block, 'id')).toBe('adobe-client-id')
  })

  it('reads an optional path scalar', () => {
    const block = splitGitleaksRuleBlocks(TWO_RULES)[1]!
    expect(readGitleaksScalar(block, 'path')).toBe('(?i)nuget\\.config$')
  })

  it('returns undefined for an absent key', () => {
    const block = splitGitleaksRuleBlocks(TWO_RULES)[0]!
    expect(readGitleaksScalar(block, 'path')).toBeUndefined()
  })

  it('does NOT read the allowlist subtable’s regex as the rule’s', () => {
    // The allowlist declares its own `regex` and `path`. Picking those up
    // would invert the rule: an allow pattern published as a detector.
    const block = splitGitleaksRuleBlocks(RULE_WITH_ALLOWLIST)[0]!
    expect(readGitleaksScalar(block, 'regex')).toBe(
      'api[_-]?key\\s*=\\s*([a-z0-9]{32})',
    )
    expect(readGitleaksScalar(block, 'path')).toBeUndefined()
  })
})

describe('readGitleaksKeywords', () => {
  it('reads and sorts the keyword array', () => {
    const block = splitGitleaksRuleBlocks(RULE_WITH_ALLOWLIST)[0]!
    expect(readGitleaksKeywords(block)).toEqual(['api_key', 'apikey'])
  })

  it('returns an empty array when the key is absent', () => {
    expect(readGitleaksKeywords('id = "x"')).toEqual([])
  })
})

describe('readGitleaksNumber', () => {
  it('reads an entropy floor', () => {
    const block = splitGitleaksRuleBlocks(TWO_RULES)[0]!
    expect(readGitleaksNumber(block, 'entropy')).toBe(2)
  })

  it('reads a fractional entropy floor', () => {
    expect(readGitleaksNumber('entropy = 3.8\n', 'entropy')).toBe(3.8)
  })

  it('returns undefined when the rule sets none', () => {
    const block = splitGitleaksRuleBlocks(TWO_RULES)[1]!
    expect(readGitleaksNumber(block, 'entropy')).toBeUndefined()
  })
})

describe('gitleaksCategoryFromId', () => {
  it('takes the leading vendor token', () => {
    expect(gitleaksCategoryFromId('adobe-client-id')).toBe('adobe')
  })

  it('falls back to generic for an empty id', () => {
    expect(gitleaksCategoryFromId('')).toBe('generic')
  })
})
