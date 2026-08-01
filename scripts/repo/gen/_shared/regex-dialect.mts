/*
 * @file Translates an upstream regex into JavaScript, or labels it honestly
 *   when it cannot be translated.
 *   gitleaks and Trivy write Go/RE2 patterns; SkillSpector writes Python.
 *   Neither dialect is JavaScript:
 *
 *   - **Leading inline flags.** `(?i)foo` is 114 of gitleaks' rules. JS has no
 *     inline flag syntax, but a LEADING flag group applies to the whole
 *     pattern, so it lifts losslessly into the `flags` argument.
 *   - **Scoped inline flags.** `foo(?i)bar` applies case-insensitivity from that
 *     point on. JS cannot express this at all. Hoisting it to a global `i`
 *     would make the pattern match strictly more than upstream does — a silent
 *     false-positive source — so these rows are published as `re2` rather than
 *     broadened or dropped.
 *   - **Named groups.** Go and Python spell them `(?P<name>…)`; JS spells them
 *     `(?<name>…)`. A pure syntax swap, 68 Trivy rules deep. Every translated
 *     pattern is then COMPILED here. A row labelled `js` is one this file
 *     actually constructed, so a consumer can trust it.
 */

import type { PatternDialect } from './table-types.mts'

/**
 * A pattern translated for a target engine.
 */
export interface TranslatedRegex {
  readonly dialect: PatternDialect
  readonly flags: string
  readonly source: string
}

/**
 * Matches a run of inline flag groups at the very START of a pattern, e.g.
 * `(?i)` or `(?is)`. Only the matched TEXT is used (the letters are read off
 * match[0]), so the inner group stays non-capturing.
 */
const LEADING_INLINE_FLAGS = /^(?:\(\?(?:[a-zA-Z]+)\))+/

/**
 * Matches any inline flag group anywhere, used to detect a SCOPED one that
 * survives after the leading run is stripped.
 */
const ANY_INLINE_FLAGS = /\(\?[a-zA-Z]+\)/

/**
 * Map RE2 / Python inline flag letters onto JS `RegExp` flags. Letters with no
 * JS equivalent (`U` ungreedy, `x` extended) are dropped from the flag string
 * and force the `re2` dialect, because silently ignoring them would change the
 * match.
 */
export function inlineFlagToJsFlag(letter: string): string | undefined {
  switch (letter) {
    case 'i':
      return 'i'
    case 'm':
      return 'm'
    case 's':
      return 's'
    default:
      return undefined
  }
}

/**
 * Rewrite Go/Python named groups to the JS spelling.
 */
export function convertNamedGroupSyntax(source: string): string {
  return source.replace(/\(\?P</g, '(?<')
}

/**
 * Translate one upstream pattern.
 */
export function translateRegexForJs(rawSource: string): TranslatedRegex {
  let source = convertNamedGroupSyntax(rawSource)
  let flags = ''
  let translatable = true

  const leading = LEADING_INLINE_FLAGS.exec(source)
  if (leading) {
    // Collect every letter in the leading run, not just the last group's.
    const runText = leading[0]
    const letters = runText.replace(/[()?]/g, '')
    for (const letter of letters) {
      const jsFlag = inlineFlagToJsFlag(letter)
      if (jsFlag === undefined) {
        translatable = false
      } else if (!flags.includes(jsFlag)) {
        flags += jsFlag
      }
    }
    source = source.slice(runText.length)
  }

  // A flag group left over after the leading run is SCOPED — inexpressible.
  if (ANY_INLINE_FLAGS.test(source)) {
    return { dialect: 're2', flags: '', source: rawSource }
  }
  if (!translatable) {
    return { dialect: 're2', flags: '', source: rawSource }
  }

  // The label means "this compiled", so prove it.
  try {
    void new RegExp(source, flags)
  } catch {
    return { dialect: 're2', flags: '', source: rawSource }
  }
  return { dialect: 'js', flags, source }
}

/**
 * Tally of how a generator's patterns translated, for the run summary.
 */
export interface DialectTally {
  readonly js: number
  readonly re2: number
}

/**
 * Count dialects across a set of translations.
 */
export function tallyDialects(
  translations: readonly TranslatedRegex[],
): DialectTally {
  let js = 0
  let re2 = 0
  for (let i = 0, { length } = translations; i < length; i += 1) {
    if (translations[i]!.dialect === 'js') {
      js += 1
    } else {
      re2 += 1
    }
  }
  return { js, re2 }
}

/**
 * Union two JS flag strings, deduped and in a stable order.
 *
 * A pattern can pick up flags from two places: a leading inline group lifted
 * out of the pattern itself, and the flags its analyzer passes at match time
 * (Python keeps `re.IGNORECASE` in the `finditer` call, not the literal).
 * Both have to survive into the emitted row or the rule matches differently
 * than upstream.
 */
export function mergeRegexFlags(...flagSets: readonly string[]): string {
  const seen = new Set<string>()
  for (let i = 0, { length } = flagSets; i < length; i += 1) {
    for (const flag of flagSets[i]!) {
      seen.add(flag)
    }
  }
  return [...seen].toSorted().join('')
}
