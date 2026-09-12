import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'

import { packAndInspect } from '../../../scripts/fleet/pack/inspect.mts'
import { withPrunedPackManifest } from '../../../scripts/fleet/registry-infra/npm/pack-manifest.mts'
import { REPO_ROOT } from '../../../scripts/repo/paths.mts'

it('loads all scanner tables from the packed npm artifact', async () => {
  const build = spawnSync(
    process.execPath,
    [path.join(REPO_ROOT, 'scripts', 'repo', 'build.mts'), '--no-gen'],
    { cwd: REPO_ROOT },
  )
  expect(build.status, build.stderr.toString()).toBe(0)
  const inspection = await withPrunedPackManifest(REPO_ROOT, async () =>
    packAndInspect(REPO_ROOT),
  )
  expect(inspection).toBeDefined()
  if (!inspection) {
    return
  }
  const directory = mkdtempSync(path.join(os.tmpdir(), 'scanner-package-'))
  try {
    const unpack = spawnSync('tar', [
      '-xf',
      inspection.tarball,
      '-C',
      directory,
    ])
    expect(unpack.status).toBe(0)
    const loadPackage = createRequire(path.join(directory, 'consumer.cjs'))
    const api = loadPackage(
      './package',
    ) as typeof import('../../../src/index.mts')
    for (const scanner of [
      'agentConfigs',
      'manifests',
      'secrets',
      'skills',
      'workflows',
    ] as const) {
      const table = api.getPatternTable(scanner)
      expect(table.scanner).toBe(scanner)
      expect(table.rules.length).toBeGreaterThan(0)
    }
    expect(inspection.entries).toContain('NOTICE')
    expect(inspection.entries).toContain('dist/index.d.mts')
    expect(inspection.packedScripts?.['prepare']).toBeUndefined()
  } finally {
    rmSync(directory, { recursive: true })
  }
}, 30000)
