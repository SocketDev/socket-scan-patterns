import { expect, it } from 'vitest'

import {
  readTrivyCompiledPattern,
  readTrivyQuotedField,
  trivyPatternDialect,
} from '../../../scripts/repo/gen/import-trivy-secrets.mts'
import { translateRegexForJs } from '../../../scripts/repo/gen/_shared/regex-dialect.mts'

it('reads quoted fields and preserves empty values', () => {
  expect(readTrivyQuotedField('ID: "example-rule",\n}', 'ID')).toBe(
    'example-rule',
  )
  expect(readTrivyQuotedField('Title: "",\n}', 'Title')).toBe('')
  expect(readTrivyQuotedField('Title: expression,', 'Title')).toBeUndefined()
  expect(readTrivyQuotedField('', 'ID')).toBeUndefined()
})

it.each(['MustCompile', 'MustCompileWithoutWordPrefix'])(
  'unwraps %s content patterns',
  compileName => {
    expect(
      readTrivyCompiledPattern(
        'Regex: ' + compileName + '(`example-content`),\n}',
        'Regex',
        new Map(),
      ),
    ).toBe('example-content')
  },
)

it('does not compile absent or unrecognized expressions', () => {
  expect(readTrivyCompiledPattern('', 'Regex', new Map())).toBeUndefined()
  expect(
    readTrivyCompiledPattern(
      'Regex: unknownCall("example"),',
      'Regex',
      new Map(),
    ),
  ).toBeUndefined()
})

it('requires compatible content and path dialects', () => {
  const jsPattern = translateRegexForJs('example')
  const re2Pattern = { ...jsPattern, dialect: 're2' as const }
  expect(trivyPatternDialect(jsPattern, undefined)).toBe('js')
  expect(trivyPatternDialect(jsPattern, jsPattern)).toBe('js')
  expect(trivyPatternDialect(jsPattern, re2Pattern)).toBe('re2')
  expect(trivyPatternDialect(re2Pattern, jsPattern)).toBe('re2')
  expect(trivyPatternDialect(undefined, jsPattern)).toBe('re2')
})
