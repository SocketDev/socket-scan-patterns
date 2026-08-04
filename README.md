# scan-patterns

<a href="https://badge.socket.dev/npm/package/@socketsecurity/scan-patterns"><img src="https://badge.socket.dev/npm/package/@socketsecurity/scan-patterns" alt="Socket Badge" height="20"></a>
![Coverage](https://raw.githubusercontent.com/SocketDev/socket-scan-patterns/HEAD/assets/repo/badges/coverage.svg)

[![Follow @SocketSecurity](https://raw.githubusercontent.com/SocketDev/socket-scan-patterns/HEAD/assets/fleet/badge-follow-x.svg)](https://twitter.com/SocketSecurity)
[![Follow @socket.dev on Bluesky](https://raw.githubusercontent.com/SocketDev/socket-scan-patterns/HEAD/assets/fleet/badge-follow-bluesky.svg)](https://bsky.app/profile/socket.dev)

Canonical detector pattern tables for Socket's baseline security scanners.

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

**TruffleHog is AGPL-3.0, and its implementation is unreadable here by
construction.** Deriving AGPL rules into an MIT package would relicense the
package, so the posture is clean-room: this repo may observe TruffleHog's
_tests_ and never its implementation. Its sparse-checkout admits only
`*_test.go` files and `testdata/` fixtures, so not one line of implementation
lands on disk — absence is the block, not a rule asking people to behave. The
coverage oracle infers detector families from test file paths alone (that
`pkg/detectors/stripe/stripe_test.go` exists proves a Stripe detector exists)
and _reports_ gaps; it never gates. No generator reads TruffleHog, no table row
cites it, and none of its bytes are vendored into this tree. For secret
detection, gitleaks (MIT) is the sanctioned source. The same tests-only rule
applies to any future copyleft upstream, enforced by
`scripts/repo/check/copyleft-slices-are-tests-only.mts` and the
`no-copyleft-source-read` guard.

Everything that ships here is MIT, with Apache-2.0 attribution for the Trivy,
SkillSpector, and codex-security derivations recorded in [`NOTICE`](NOTICE).

**Never build license detection here.** Socket's API already returns
authoritative per-package license data through
[`@socketsecurity/sdk`](https://github.com/SocketDev/socket-sdk-js):
`LicenseDetails` carries `spdxDisj` (the SPDX expression in disjunctive normal
form), `authors[]`, `provenance` (package.json / LICENSE file / README),
`filepath`, and a confidence score, and the batch endpoints accept
`include_license_details`. Anything in this repo — or downstream of it — that
needs "what license is this dependency" consumes that. No regex license
sniffing, ever.

This repo eats its own cooking: `upstream-licenses-match-registry` looks every
pinned upstream up through that same SDK and fails when an upstream's reported
`spdxDisj` no longer covers the SPDX id recorded here. TruffleHog itself
relicensed GPL-2.0 → AGPL-3.0 at v3.0, which is exactly how a compliant
derivation quietly becomes a non-compliant one; the check is offline-safe and
skips without a token rather than failing closed.

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
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/SocketDev/socket-scan-patterns/HEAD/assets/fleet/socket-combomark-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/SocketDev/socket-scan-patterns/HEAD/assets/fleet/socket-combomark-light.svg">
    <img width="320" height="91" alt="Socket" src="https://raw.githubusercontent.com/SocketDev/socket-scan-patterns/HEAD/assets/fleet/socket-combomark-light.svg">
  </picture>
</div>
