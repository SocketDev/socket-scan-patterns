/**
 * @file The dialect translator is the correctness seam between three upstream
 *   regex engines and JavaScript, so it is tested against the exact shapes the
 *   pinned upstreams actually contain.
 */

import { describe, expect, it } from 'vitest'

import {
  convertNamedGroupSyntax,
  inlineFlagToJsFlag,
  mergeRegexFlags,
  tallyDialects,
  translateRegexForJs,
} from '../../../scripts/repo/gen/_shared/regex-dialect.mts'

describe('convertNamedGroupSyntax', () => {
  it('rewrites a Go/Python named group to the JS spelling', () => {
    expect(convertNamedGroupSyntax('(?P<secret>[a-z]+)')).toBe(
      '(?<secret>[a-z]+)',
    )
  })

  it('leaves a pattern with no named group alone', () => {
    expect(convertNamedGroupSyntax('[a-z]+')).toBe('[a-z]+')
  })
})

describe('inlineFlagToJsFlag', () => {
  it.each([
    ['i', 'i'],
    ['m', 'm'],
    ['s', 's'],
  ])('maps %s to the JS flag %s', (letter, expected) => {
    expect(inlineFlagToJsFlag(letter)).toBe(expected)
  })

  it('returns undefined for a flag JS cannot express', () => {
    expect(inlineFlagToJsFlag('U')).toBeUndefined()
    expect(inlineFlagToJsFlag('x')).toBeUndefined()
  })
})

describe('translateRegexForJs', () => {
  it('lifts a leading inline flag into the flags string', () => {
    const result = translateRegexForJs('(?i)adobe[a-f0-9]{32}')
    expect(result).toEqual({
      dialect: 'js',
      flags: 'i',
      source: 'adobe[a-f0-9]{32}',
    })
  })

  it('lifts a multi-letter leading flag group', () => {
    const result = translateRegexForJs('(?is)foo.bar')
    expect(result.dialect).toBe('js')
    expect([...result.flags].toSorted().join('')).toBe('is')
    expect(result.source).toBe('foo.bar')
  })

  it('labels a SCOPED inline flag as re2 and leaves it untranslated', () => {
    // Hoisting this to a global `i` would broaden the match, so the row must
    // stay honest rather than become a silent false-positive source.
    const raw = 'foo(?i)bar'
    const result = translateRegexForJs(raw)
    expect(result.dialect).toBe('re2')
    expect(result.source).toBe(raw)
    expect(result.flags).toBe('')
  })

  it('labels a flag JS cannot express as re2', () => {
    const result = translateRegexForJs('(?U)a+')
    expect(result.dialect).toBe('re2')
  })

  it('converts named groups while translating', () => {
    const result = translateRegexForJs('(?i)(?P<secret>ghp_[0-9a-zA-Z]{36})')
    expect(result.dialect).toBe('js')
    expect(result.source).toBe('(?<secret>ghp_[0-9a-zA-Z]{36})')
  })

  it('falls back to re2 when the translated pattern will not compile', () => {
    const result = translateRegexForJs('(unclosed')
    expect(result.dialect).toBe('re2')
  })

  it('produces a pattern that actually compiles for every js result', () => {
    const patterns = [
      '(?i)adobe',
      '(?P<secret>AKIA[A-Z0-9]{16})',
      '\\bA3-[A-Z0-9]{6}\\b',
    ]
    for (const raw of patterns) {
      const result = translateRegexForJs(raw)
      if (result.dialect === 'js') {
        expect(() => new RegExp(result.source, result.flags)).not.toThrow()
      }
    }
  })
})

describe('mergeRegexFlags', () => {
  it('unions and dedupes flag sets', () => {
    expect(mergeRegexFlags('i', 'is')).toBe('is')
  })

  it('is stable regardless of argument order', () => {
    expect(mergeRegexFlags('s', 'i')).toBe(mergeRegexFlags('i', 's'))
  })

  it('returns an empty string when nothing is set', () => {
    expect(mergeRegexFlags('', '')).toBe('')
  })
})

describe('tallyDialects', () => {
  it('counts each dialect', () => {
    const tally = tallyDialects([
      { dialect: 'js', flags: '', source: 'a' },
      { dialect: 're2', flags: '', source: 'b' },
      { dialect: 'js', flags: '', source: 'c' },
    ])
    expect(tally).toEqual({ js: 2, re2: 1 })
  })
})
