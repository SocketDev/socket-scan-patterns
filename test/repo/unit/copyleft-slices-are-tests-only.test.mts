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

  it('refuses a bare directory prefix', () => {
    // A cone-style prefix admits everything beneath it, implementation included.
    expect(isTestOnlySparsePattern('pkg/detectors')).toBe(false)
    expect(isTestOnlySparsePattern('pkg/engine/defaults')).toBe(false)
  })
})
