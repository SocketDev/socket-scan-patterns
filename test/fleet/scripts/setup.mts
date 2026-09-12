/**
 * @file Fleet-canonical vitest setup, wired via `setupFiles` in
 *   `.config/repo/vitest.config.mts`, loaded only when present. Registers the
 *   fleet's custom matchers globally with `expect.extend` so every test under
 *   `test/**` can use them without an import. Currently: `toContainPath` — a
 *   separator-agnostic path-substring assertion (see ./../_shared/lib/
 *   matchers.mts). Also isolates git so a test's git ops can't touch the live
 *   repo, and blocks external connections at the socket, DNS and UDP boundaries
 *   so any test hitting an unmocked third-party server throws — the fleet
 *   "tests never connect to third-party servers" rule, enforced fleet-wide here
 *   so it isn't per-repo. Nock lifecycle hooks configure and clean mocks only
 *   when tests load Nock. Repo-specific setup belongs in
 *   `test/repo/scripts/setup.mts`.
 */

import '../_shared/lib/network-preload.mjs'
import { createRequire } from 'node:module'
import process from 'node:process'

import type nock from 'nock'
import { afterAll, afterEach, beforeAll, expect } from 'vitest'

import { isolateGitEnv } from '../../../.git-hooks/_shared/isolate-git-env.mts'
import { prepareSubprocessCoverageEnv } from '../_shared/lib/coverage-env.mts'
import { isolateHomeEnv } from '../_shared/lib/isolate-home-env.mts'
import { toContainPathResult } from '../_shared/lib/matchers.mts'

const require = createRequire(import.meta.url)
const nockPath = require.resolve('nock')

function getLoadedNetworkMock(): typeof nock | undefined {
  return require.cache[nockPath]?.exports as typeof nock | undefined
}

// Neutralize the inherited git env so a test's `git` spawns can't touch the
// live repo. The stronger `pinConfigToNull` form is safe here — no vitest
// fixture manipulates a controlled global `git config` (the signing-gate tests
// that do live under node:test, which strips-only). Single source of truth in
// .git-hooks/_shared/isolate-git-env.mts.
isolateGitEnv({ pinConfigToNull: true })

// Point HOME and the XDG dirs at a throwaway dir under os.tmpdir(), so a test
// cannot read or write the developer's real home. This is the filesystem
// counterpart to the git isolation above and the network fail-closed below: a
// run should not depend on, or disturb, anything outside the repo and tmp.
//
// Measured, not assumed: a socket-lib run with HOME redirected leaves
// `.socket/_dlx/{jre,sbt}`, `.socket/_cacache/`, `.npm/_logs/` and
// `Library/Caches/` behind. Unredirected, all of that lands in the real home,
// and a test enumerating the dlx cache then counts binaries the machine
// happened to download rather than the ones it created.
isolateHomeEnv()

// Subprocess coverage capture (cover.mts sets FLEET_CHILD_V8_COVERAGE_DIR).
// This also drops the already-consumed COVERAGE flag so a test-spawned Vitest
// child cannot clean the outer run's shared coverage/.tmp reports.
prepareSubprocessCoverageEnv(process.env)

// The parent reporter owns the job summary; fixture subprocesses cannot append to it.
delete process.env['GITHUB_STEP_SUMMARY']

const networkPreload = new URL(
  '../_shared/lib/network-preload.mjs',
  import.meta.url,
).href
const preloadOption = `--import=${networkPreload}`
if (!process.env['NODE_OPTIONS']?.includes(preloadOption)) {
  process.env['NODE_OPTIONS'] =
    `${process.env['NODE_OPTIONS'] ?? ''} ${preloadOption}`.trim()
}

// Fail network CLOSED fleet-wide: block every real connection so an unmocked
// third-party request throws instead of reaching the internet. Loopback stays
// reachable for local fixture servers. Tests mock remote endpoints with nock;
// everything else fails closed. (Was repo-only — promoted here so every fleet
// repo inherits it.)
beforeAll(() => {
  const nock = getLoadedNetworkMock()
  nock?.disableNetConnect()
  // Match IPv4 loopback, bracketed IPv6 loopback, or localhost with an optional numeric port.
  nock?.enableNetConnect(/^(?:127\.\d+\.\d+\.\d+|\[::1\]|localhost)(?::\d+)?$/)
})

afterEach(() => {
  // Reset nock interceptors between tests so a registration cannot leak forward.
  getLoadedNetworkMock()?.cleanAll()
})

afterAll(() => {
  getLoadedNetworkMock()?.enableNetConnect()
})

expect.extend({
  toContainPath(received: unknown, expected: string) {
    return toContainPathResult(received, expected)
  },
})

declare module 'vitest' {
  // Declaration merging requires the EXACT upstream type parameters. vitest 5
  // reordered them to `<R extends void | Promise<void>, T = unknown>`, so the
  // former single `<T = any>` no longer merges and tsc rejects the file.
  interface Matchers<
    R extends void | Promise<void> = void | Promise<void>,
    T = unknown,
  > {
    // Assert the received path string contains `expected` after both are
    // normalized to "/" separators — cross-platform path assertions without
    // per-OS branching.
    toContainPath: (expected: string) => R
  }
}
