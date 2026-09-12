import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { expect, it } from 'vitest'

it('describes its command without running its operation', () => {
  const result = spawnSync(
    process.execPath,
    ['scripts/repo/gen/all.mts', '--describe', '--json'],
    {
      encoding: 'utf8',
      timeout: 10000,
    },
  )
  expect(result.status).toBe(0)
  expect(JSON.parse(result.stdout)).toMatchObject({
    name: 'all.mts',
    description: expect.any(String),
  })
})
