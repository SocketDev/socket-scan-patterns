import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { expect, it, vi } from 'vitest'
import { fetchReportedLicenses } from '../../../../scripts/repo/check/upstream-licenses-match-registry.mts'

const { batchPackageFetch } = vi.hoisted(() => ({ batchPackageFetch: vi.fn() }))

vi.mock('@socketsecurity/sdk', () => ({
  SocketSdk: class {
    batchPackageFetch = batchPackageFetch
  },
}))

vi.mock('@socketsecurity/lib-stable/secrets/socket-api-token', () => ({
  readSocketApiTokenSync: () => 'example-api-key',
}))

it('describes its command without running its operation', () => {
  const result = spawnSync(
    process.execPath,
    [
      'scripts/repo/check/upstream-licenses-match-registry.mts',
      '--describe',
      '--json',
    ],
    {
      encoding: 'utf8',
      timeout: 10000,
    },
  )
  expect(result.status).toBe(0)
  expect(JSON.parse(result.stdout)).toMatchObject({
    name: 'upstream-licenses-match-registry.mts',
    description: expect.any(String),
  })
})

it('requests detailed licenses through the SDK query contract', async () => {
  const purl = 'pkg:npm/example-package@1.0.0'
  const license = { confidence: 1, errorData: '', spdxDisj: 'MIT' }
  batchPackageFetch.mockResolvedValueOnce({
    success: true,
    data: [{ purl, licenseDetails: [license] }],
  })
  const result = await fetchReportedLicenses(
    new Map([['example-upstream', purl]]),
  )
  expect(batchPackageFetch).toHaveBeenCalledWith(
    { components: [{ purl }] },
    { licensedetails: true },
  )
  expect(result?.get('example-upstream')).toEqual(license)
})
