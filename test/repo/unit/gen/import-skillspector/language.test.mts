import { describe, expect, it } from 'vitest'

import { parseSkillSpectorLanguageRules } from '../../../../../scripts/repo/gen/import-skillspector/language.mts'

const LANGUAGE_RULES = String.raw`
_LANG_BY_EXT: dict[str, str] = {
    ".php": "php",
    ".php5": "php",
    ".js": "javascript",
    ".ts": "javascript",
}
_LANG_RULES: dict[str, list] = {
    "php": [
        (
            "DS1",
            "PHP object injection",
            Severity.HIGH,
            [(r"\bunserialize\s*\(", 0.8)],
        ),
    ],
    "javascript": [
        (
            "DS4",
            "Unsafe JavaScript deserialization",
            Severity.MEDIUM,
            [
                (r"""require\(\s*['"]serializer['"]\s*\)""", 0.75),
                (r'\.unserialize\s*\(', 0.6),
            ],
        ),
    ],
}
`

describe('parseSkillSpectorLanguageRules', () => {
  it('preserves rule severity, raw strings, and language extension gates', () => {
    const rules = parseSkillSpectorLanguageRules(LANGUAGE_RULES)
    expect(rules).toHaveLength(3)
    expect(rules[0]).toMatchObject({
      code: 'DS1',
      confidence: 0.8,
      severity: 'high',
      title: 'PHP object injection',
    })
    const phpPath = new RegExp(rules[0]!.pathRegexSource!, 'i')
    expect(phpPath.test('source/parser.PHP5')).toBe(true)
    expect(phpPath.test('source/parser.js')).toBe(false)
    expect(new RegExp(rules[0]!.source).test('unserialize(payload)')).toBe(true)
    expect(rules[1]).toMatchObject({
      code: 'DS4',
      severity: 'medium',
      confidence: 0.75,
    })
    expect(new RegExp(rules[1]!.source).test('require("serializer")')).toBe(
      true,
    )
    expect(new RegExp(rules[1]!.pathRegexSource!).test('parser.ts')).toBe(true)
    expect(new RegExp(rules[1]!.pathRegexSource!).test('parser.rb')).toBe(false)
  })

  it('leaves ordinary pattern modules to the ordinary parser', () => {
    expect(parseSkillSpectorLanguageRules('P1_PATTERNS = []')).toEqual([])
  })

  it('rejects missing extension gates', () => {
    expect(() =>
      parseSkillSpectorLanguageRules(
        LANGUAGE_RULES.replace('"php": [', '"ruby": ['),
      ),
    ).toThrow()
  })

  it('rejects computed patterns instead of silently omitting them', () => {
    expect(() =>
      parseSkillSpectorLanguageRules(
        LANGUAGE_RULES.replace('0.8)', '0.8), (create_pattern(), 0.9)'),
      ),
    ).toThrow()
  })

  it('rejects unknown rule shapes', () => {
    expect(() =>
      parseSkillSpectorLanguageRules(
        LANGUAGE_RULES.replace('Severity.HIGH', 'Severity.UNKNOWN'),
      ),
    ).toThrow()
  })
})
