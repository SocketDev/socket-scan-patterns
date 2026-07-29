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
    'docs/architecture.md',
  ])('refuses the implementation path %s', candidate => {
    expect(isAllowedCopyleftPath(candidate)).toBe(false)
  })

  it('normalizes Windows separators before matching', () => {
    expect(isAllowedCopyleftPath('pkg\\detectors\\x\\x_test.go')).toBe(true)
  })

  it('allows ROOT metadata, which LICENSE verification depends on', () => {
    for (const name of ['LICENSE', 'LICENSE.md', 'NOTICE', 'README.md']) {
      expect(isAllowedCopyleftPath(name)).toBe(true)
    }
  })

  it('refuses NESTED files that a metadata glob would otherwise match', () => {
    // Regression: the unanchored `NOTICE*` / `README*` globs in the fleet
    // recipe match at any depth, and on a case-insensitive filesystem they
    // materialized two AGPL detector IMPLEMENTATIONS. Root-anchoring is what
    // closes that hole, so this test is the guard on the guard.
    expect(
      isAllowedCopyleftPath('pkg/detectors/noticeable/noticeable.go'),
    ).toBe(false)
    expect(isAllowedCopyleftPath('pkg/detectors/readme/readme.go')).toBe(false)
    expect(isAllowedCopyleftPath('pkg/analyzer/README.md')).toBe(false)
  })
})
