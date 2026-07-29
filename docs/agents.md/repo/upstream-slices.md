# Upstream slices

Every table under `data/` is derived from a pinned upstream reference under
`upstream/<name>`. The pins live in `.gitmodules` and nowhere else — the `ref`
plus the `sha256:` header **are** the pin, so there is no tracked gitlink.

> This file is the repo's `upstream/README.md`. It lives here instead because
> `**/upstream/` is unconditionally git-ignored fleet-wide and the fleet
> forbids re-including it with a `!` negation, so no file inside `upstream/`
> can be tracked. See `docs/agents.md/fleet/upstream-references.md`.

## Materializing a slice

```sh
node scripts/fleet/git-partial-submodule.mts clone upstream/<name>
```

`git submodule init` / `update` do not work here — both resolve a pathspec
against the index, and these references have no index entry.

## The slices

| name | pinned | sparse-checkout | role |
| --- | --- | --- | --- |
| `gitleaks` | `v8.30.1` | `config`, `testdata/config` | derive |
| `zizmor` | `v1.28.0` | `docs`, `crates/zizmor/tests` | derive |
| `trivy` | `v0.72.0` | `pkg/fanal/secret` | derive |
| `codex-security` | `npm-v0.1.1` | `sdk/typescript/_bundled_plugin/{preflight,schemas,skills}` | derive |
| `agentshield` | `v1.4.0` | `src` | derive |
| `trufflehog` | `v3.96.0` | `pkg/engine/defaults` | **conformance-only** |

### Licenses

| upstream | license | obligation |
| --- | --- | --- |
| gitleaks | MIT | notice reproduced in `NOTICE` |
| zizmor | MIT | notice reproduced in `NOTICE` |
| agentshield | MIT | notice reproduced in `NOTICE` |
| trivy | Apache-2.0 | attribution **required** — `NOTICE` |
| codex-security | Apache-2.0 | attribution **required** — `NOTICE` |
| trufflehog | **AGPL-3.0** | **never derive** — see below |

## TruffleHog is conformance-only

TruffleHog is AGPL-3.0. Deriving its regexes or rule data into this package
would relicense the package, so it is pinned **solely as a coverage-comparison
oracle**.

`scripts/check/trufflehog-coverage.mts` reads the detector **index** — the
import list in `pkg/engine/defaults/defaults.go`, which is a list of Go package
names — and reports which detector families this package's `secrets` table does
not cover. It reports; it never gates, and it never writes to `data/`.

Three things keep that honest:

1. The sparse-checkout is narrowed to `pkg/engine/defaults`, so the
   regex-bearing `pkg/detectors` tree (2780 files) is never materialized.
2. The coverage check derives only detector family **names** for comparison and
   emits no upstream datum into any artifact.
3. No generator under `scripts/gen/` may read `upstream/trufflehog`;
   `data-is-regenerated` fails if one does.

If you need broader secret coverage, add a rule to a **derivable** upstream's
generator or author an original Socket rule. Never port one from TruffleHog.

## Bumping a pin

Never hand-edit `ref` — the archive hash cannot be recomputed at edit time and
`uses-sha-verify-guard` blocks it. Bump both together:

```sh
node scripts/fleet/gen/gitmodules-hash.mts --set upstream/<name> <ref> --label <name>-<version>
node scripts/fleet/git-partial-submodule.mts clone upstream/<name>
pnpm run gen
pnpm run check:data-drift
```

Pin the newest stable release tag, never a moving branch and never a
prerelease.
