/**
 * @file Fixture-driven tests for the SkillSpector Python parser.
 *   The multi-line-tuple fixture below is the regression guard for a real bug:
 *   the first version of the tuple regex required `)` straight after the
 *   confidence, so every black-formatted multi-line tuple was silently dropped
 *   — 148 of 416 patterns, with no error. The table just came out small.
 */

import { describe, expect, it } from 'vitest'

import {
  parseSkillSpectorExplanations,
  parseSkillSpectorModuleFlags,
  parseSkillSpectorPatterns,
  skillSpectorCategoryFromModule,
  skillSpectorSeverity,
  unescapePythonString,
} from '../../../scripts/repo/gen/import-skillspector.mts'

const SINGLE_LINE_GROUP = `
P1_PATTERNS = [
    (r"ignore\\s+(?:all\\s+)?previous\\s+instructions?", 0.8),
    (r'override\\s+(?:safety|security)', 0.9),
]
`

const MULTI_LINE_GROUP = `
P6_PATTERNS = [
    (
        r"(?:print|output|show)\\s+(?:your\\s+)?(?:system\\s+)?prompt",
        0.85,
    ),
    (
        r"(?:what\\s+(?:are|is)\\s+your)\\s+(?:system\\s+)?instructions?",
        0.8,
    ),
]
`

const WITH_ALLOWLIST_GROUP = `
SC2_PATTERNS = [
    (r"curl[^|]*\\|\\s*(?:ba)?sh", 0.9),
]
_SAFE_DOCKERFILE_PATTERNS = [
    (r"FROM\\s+scratch", 0.5),
]
`

describe('parseSkillSpectorPatterns', () => {
  it('reads single-line tuples in both quote styles', () => {
    const patterns = parseSkillSpectorPatterns(SINGLE_LINE_GROUP)
    expect(patterns).toHaveLength(2)
    expect(patterns[0]).toMatchObject({ code: 'P1', confidence: 0.8 })
    expect(patterns[1]!.source).toBe('override\\s+(?:safety|security)')
  })

  it('reads MULTI-LINE tuples with a trailing comma', () => {
    // Regression: these were silently dropped, shrinking the table by ~35%.
    const patterns = parseSkillSpectorPatterns(MULTI_LINE_GROUP)
    expect(patterns).toHaveLength(2)
    expect(patterns[0]!.code).toBe('P6')
    expect(patterns[0]!.confidence).toBe(0.85)
  })

  it('skips _SAFE_* allowlist groups', () => {
    // Importing an allowlist as a detector would invert its meaning.
    const patterns = parseSkillSpectorPatterns(WITH_ALLOWLIST_GROUP)
    expect(patterns).toHaveLength(1)
    expect(patterns[0]!.code).toBe('SC2')
  })

  it('returns nothing for a module with no pattern groups', () => {
    expect(parseSkillSpectorPatterns('ANALYZER_ID = "x"\n')).toHaveLength(0)
  })
})

describe('parseSkillSpectorModuleFlags', () => {
  it('recovers the flags an analyzer passes at match time', () => {
    const source = 're.finditer(pattern, content, re.IGNORECASE | re.MULTILINE)'
    expect(parseSkillSpectorModuleFlags(source)).toBe('im')
  })

  it('recovers DOTALL', () => {
    expect(parseSkillSpectorModuleFlags('re.DOTALL')).toBe('s')
  })

  it('returns no flags when the analyzer sets none', () => {
    expect(parseSkillSpectorModuleFlags('re.finditer(p, c)')).toBe('')
  })
})

describe('parseSkillSpectorExplanations', () => {
  it('maps a finding code to its explanation', () => {
    const source = `
DEFAULT_EXPLANATIONS: dict[str, str] = {
    "P1": "This pattern attempts to override system instructions.",
    "E2": "Code accesses environment variables that may contain secrets.",
}
`
    const explanations = parseSkillSpectorExplanations(source)
    expect(explanations.get('P1')).toBe(
      'This pattern attempts to override system instructions.',
    )
    expect(explanations.get('E2')).toContain('environment variables')
  })

  it('returns an empty map when the block is absent', () => {
    expect(parseSkillSpectorExplanations('x = 1').size).toBe(0)
  })
})

describe('skillSpectorSeverity', () => {
  it.each([
    [0.95, 'critical'],
    [0.9, 'critical'],
    [0.85, 'high'],
    [0.75, 'high'],
    [0.6, 'medium'],
    [0.5, 'medium'],
    [0.4, 'low'],
  ])('maps confidence %s to %s', (confidence, expected) => {
    expect(skillSpectorSeverity(confidence)).toBe(expected)
  })
})

describe('skillSpectorCategoryFromModule', () => {
  it('derives a hyphenated category from the module name', () => {
    expect(
      skillSpectorCategoryFromModule('static_patterns_prompt_injection.py'),
    ).toBe('prompt-injection')
  })
})

describe('unescapePythonString', () => {
  it('collapses escapes and whitespace', () => {
    expect(unescapePythonString('a\\nb   c')).toBe('a b c')
  })

  it('unescapes an embedded quote', () => {
    expect(unescapePythonString('say \\"hi\\"')).toBe('say "hi"')
  })
})
