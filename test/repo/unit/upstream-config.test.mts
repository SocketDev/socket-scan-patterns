/*
 * @file Tests for `scripts/repo/upstream-config.mts` — the slice declarations and the copyleft policy
 *   they are measured against.
 */

import { describe, expect, it } from 'vitest'

import { isTestOnlySparsePattern } from '../../../scripts/repo/check/copyleft-slices-are-tests-only.mts'
import {
  COPYLEFT_LICENSES,
  listUpstreamSliceConfigs,
  readUpstreamSliceConfig,
  UPSTREAM_SLICE_LICENSES,
} from '../../../scripts/repo/upstream-config.mts'

describe('the pinned trufflehog slice', () => {
  it('is recorded as AGPL-3.0 and therefore copyleft', () => {
    const config = readUpstreamSliceConfig('trufflehog')
    expect(config.license).toBe('AGPL-3.0')
    expect(config.copyleft).toBe(true)
  })

  it('declares a tests-only sparse pattern set', () => {
    const config = readUpstreamSliceConfig('trufflehog')
    const patterns = (config.sparseCheckout ?? '').split(/\s+/).filter(Boolean)
    expect(patterns.length).toBeGreaterThan(0)
    for (const pattern of patterns) {
      expect(isTestOnlySparsePattern(pattern)).toBe(true)
    }
  })

  it('declares no-cone mode, without which file globs are ignored', () => {
    expect(readUpstreamSliceConfig('trufflehog').sparseMode).toBe('no-cone')
  })
})

describe('slice license bookkeeping', () => {
  it('records a license for every declared slice', () => {
    for (const config of listUpstreamSliceConfigs()) {
      expect(UPSTREAM_SLICE_LICENSES[config.name]).toBeDefined()
      expect(config.license).not.toBe('UNKNOWN')
    }
  })

  it('treats exactly the copyleft families as copyleft', () => {
    for (const config of listUpstreamSliceConfigs()) {
      expect(config.copyleft).toBe(COPYLEFT_LICENSES.includes(config.license))
    }
  })
})
