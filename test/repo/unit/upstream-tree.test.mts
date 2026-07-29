/*
 * @file Tests for `scripts/repo/upstream-tree.mts` — the tests-only path allowlist that keeps a copyleft
 *   upstream's implementation off disk.
 */

import { describe, expect, it } from 'vitest'

import { isAllowedCopyleftPath } from '../../../scripts/repo/upstream-tree.mts'

describe('isAllowedCopyleftPath', () => {
  it.each([
    'pkg/detectors/stripe/stripe_test.go',
    'pkg/detectors/x/testdata/fixture.txt',
  ])('allows the test path %s', candidate => {
    expect(isAllowedCopyleftPath(candidate)).toBe(true)
  })

  it.each([
    'pkg/detectors/stripe/stripe.go',
    'main.go',
    'pkg/engine/defaults/defaults.go',
    'README.md',
  ])('refuses the implementation path %s', candidate => {
    expect(isAllowedCopyleftPath(candidate)).toBe(false)
  })

  it('normalizes Windows separators before matching', () => {
    expect(isAllowedCopyleftPath('pkg\\detectors\\x\\x_test.go')).toBe(true)
  })
})
