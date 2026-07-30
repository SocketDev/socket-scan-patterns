/*
 * @file Tests for `scripts/repo/check/copyleft-slices-are-tests-only.mts` — the sparse-pattern predicate that decides
 *   whether a declared pattern set can admit implementation.
 */

import { describe, expect, it } from 'vitest'

import { isTestOnlySparsePattern } from '../../../scripts/repo/check/copyleft-slices-are-tests-only.mts'

describe('isTestOnlySparsePattern', () => {
  it('accepts a file-level test glob', () => {
    expect(isTestOnlySparsePattern('/pkg/detectors/**/*_test.go')).toBe(true)
    expect(isTestOnlySparsePattern('/pkg/detectors/**/testdata/**')).toBe(true)
  })

  it('accepts a ROOT-ANCHORED metadata glob', () => {
    expect(isTestOnlySparsePattern('/LICENSE*')).toBe(true)
    expect(isTestOnlySparsePattern('/NOTICE*')).toBe(true)
  })

  it('refuses the UNANCHORED form of the same metadata glob', () => {
    // Unanchored, a non-cone glob matches at any depth: `NOTICE*` pulls in
    // pkg/detectors/noticeable/noticeable.go on a case-insensitive filesystem.
    expect(isTestOnlySparsePattern('NOTICE*')).toBe(false)
    expect(isTestOnlySparsePattern('README*')).toBe(false)
  })

  it('refuses a bare directory prefix', () => {
    // A cone-style prefix admits everything beneath it, implementation included.
    expect(isTestOnlySparsePattern('pkg/detectors')).toBe(false)
    expect(isTestOnlySparsePattern('pkg/engine/defaults')).toBe(false)
  })
})
