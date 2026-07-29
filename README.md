# scan-patterns

<a href="https://badge.socket.dev/npm/package/@socketsecurity/scan-patterns"><img src="https://badge.socket.dev/npm/package/@socketsecurity/scan-patterns" alt="Socket Badge" height="20"></a>
![Coverage](assets/repo/badges/coverage.svg)

[![Follow @SocketSecurity](assets/fleet/badge-follow-x.svg)](https://twitter.com/SocketSecurity)
[![Follow @socket.dev on Bluesky](assets/fleet/badge-follow-bluesky.svg)](https://bsky.app/profile/socket.dev)

Canonical detector pattern tables for Socket's baseline security scanners.

## Why this repo exists

`socket scan secrets|workflows|agent-configs|skills|manifests` needs one
authoritative set of detector patterns, and so do the composite-action wrappers
in the public sauce repo. Keeping those tables in each consumer meant two
copies drifting apart, so they live here instead: build-inlined by socket-cli,
imported directly by everyone else.

Every table is **generated** from a pinned upstream, never hand-maintained. A
generator reads only its own `upstream/` slice and stamps each row with a
`provenance` object naming the upstream project, the pinned release, the
upstream rule id, and the upstream license. Regenerate with `pnpm run gen`; a
drift check fails the build when `data/` no longer matches its sources.

**TruffleHog is AGPL-3.0 and is never derived from.** It is pinned solely as a
coverage-comparison oracle: a check reads its detector index and *reports* which
detector families this package does not cover. No TruffleHog regex, rule datum,
or source is copied into `data/`, `src/`, or any published artifact. Everything
that ships here is MIT, with Apache-2.0 attribution for the Trivy and
codex-security derivations recorded in [`NOTICE`](NOTICE).

## Install

```sh
npm install @socketsecurity/scan-patterns
```

## Usage

```js
import { secrets, workflows } from '@socketsecurity/scan-patterns'

const awsRule = secrets.rules.find(rule => rule.id === 'aws-access-key-id')

console.log(awsRule.severity, awsRule.provenance.source)
// 'critical' 'trivy@v0.72.0'

for (const audit of workflows.rules) {
  console.log(audit.id, audit.provenance.ruleId)
}
```

Each table also publishes as raw JSON for consumers that inline it at build
time:

```js
import secretsTable from '@socketsecurity/scan-patterns/data/secrets.json' with { type: 'json' }
```

## Development

<details>
<summary>Contributor commands</summary>

```sh
pnpm install
pnpm run check
pnpm run test
```

Regenerate the tables from the pinned upstreams:

```sh
node scripts/fleet/git-partial-submodule.mts clone upstream/gitleaks
pnpm run gen
pnpm run check:data-drift
```

Report detector families TruffleHog covers and this package does not (advisory,
never a gate):

```sh
pnpm run check:coverage-oracle
```

</details>

## License

MIT

<br/>
<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/fleet/socket-combomark-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="assets/fleet/socket-combomark-light.svg">
    <img width="420" height="120" alt="Socket" src="assets/fleet/socket-combomark-light.svg">
  </picture>
</div>
