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

| name             | pinned       | sparse-checkout                                             | role                  |
| ---------------- | ------------ | ----------------------------------------------------------- | --------------------- |
| `gitleaks`       | `v8.30.1`    | `config`, `testdata/config`                                 | derive                |
| `zizmor`         | `v1.28.0`    | `docs`, `crates/zizmor/tests`                               | derive                |
| `trivy`          | `v0.72.0`    | `pkg/fanal/secret`                                          | derive                |
| `codex-security` | `npm-v0.1.1` | `sdk/typescript/_bundled_plugin/{preflight,schemas,skills}` | derive                |
| `agentshield`    | `v1.4.0`     | `src`                                                       | derive                |
| `skillspector`   | `v2.5.0`     | `src/skillspector/nodes/analyzers`                          | derive                |
| `trufflehog`     | `v3.96.0`    | `**/*_test.go`, `**/testdata/**` (no-cone)                  | **tests-only oracle** |

### Licenses

| upstream       | license      | obligation                          |
| -------------- | ------------ | ----------------------------------- |
| gitleaks       | MIT          | notice reproduced in `NOTICE`       |
| zizmor         | MIT          | notice reproduced in `NOTICE`       |
| agentshield    | MIT          | notice reproduced in `NOTICE`       |
| trivy          | Apache-2.0   | attribution **required** — `NOTICE` |
| codex-security | Apache-2.0   | attribution **required** — `NOTICE` |
| skillspector   | Apache-2.0   | attribution **required** — `NOTICE` |
| trufflehog     | **AGPL-3.0** | **never derive** — see below        |

SkillSpector's `src/skillspector/yara_rules` tree is deliberately outside the
sparse-checkout. The `skills` table derives only from the
NVIDIA-copyright `static_patterns_*.py` category modules and
`pattern_defaults.py`, so none of the obligations in SkillSpector's own
`THIRD_PARTY_NOTICES.md` carry forward.

## Copyleft upstreams are TESTS-ONLY

This is the generic rule, not a TruffleHog special case. **Any upstream whose
license appears in `COPYLEFT_LICENSES`** (`scripts/repo/upstream-config.mts` —
AGPL-1.0, AGPL-3.0, GPL-2.0, GPL-3.0, SSPL-1.0) inherits this posture
automatically. A future copyleft upstream gets it by default rather than
because someone remembered.

This package is MIT. Deriving copyleft rules into it would relicense it. So the
posture is **clean-room**: we may observe a copyleft upstream's **tests** and
never its **implementation**.

**The implementation must be UNREADABLE, not merely un-copied.** A rule saying
"do not copy this" is only as good as the reader's discipline; a file that
never lands on disk cannot be read by any agent or human. Absence is the block.

Four layers enforce it:

1. **Sparse-checkout admits tests only** — `*_test.go` files and `testdata/**`,
   in **`no-cone` mode**. Cone mode can only express directory prefixes and
   would silently admit whole trees, so `sparse-mode = no-cone` is
   load-bearing. Materialize with
   `node scripts/repo/materialize-upstream.mts <name>`, which re-applies the
   pattern set in the declared mode; a bare fleet clone would leave it in cone
   mode.
2. **`no-copyleft-source-read` guard** (`.claude/hooks/repo/`) blocks every
   reach-around: Read/Grep/Glob at a non-test path in the slice, `gh api` /
   `curl` / `wget` fetches of the upstream org, `git show` / `cat-file` of a
   non-test blob, a `sparse-checkout set|add|disable` that would widen the
   cone, and WebFetch of the upstream's source hosting. Bypass phrase:
   `Allow copyleft-source-read bypass`, owner-typed only.
3. **`copyleft-slices-are-tests-only` gate** (wired into `check --all`) fails
   when the declared pattern set admits a non-test path, when the mode is cone,
   when a non-test file is present on disk, when a generator resolves the
   slice, or when a table row cites it as a `source`.
4. **Never vendor their bytes.** Conformance runs read the pinned submodule,
   copying to an `os.tmpdir()` scratch dir at runtime for side-effect hygiene.
   That is execution, not redistribution. Nothing copyleft enters git-tracked
   content.

### What the TruffleHog oracle actually does

`scripts/repo/check/detector-coverage-is-reported.mts` lists test **file paths** and
takes each detector directory name as a fact: `pkg/detectors/stripe/stripe_test.go`
exists, therefore a Stripe detector exists. It compares that family list
against this package's `secrets` table and **reports** the gap. It never reads
an implementation file, never consults a registry, and never gates the build.

There is **no TruffleHog generator and no TruffleHog-derived row, ever.**

If you need broader secret coverage, add a rule to a **permissive** upstream's
generator — gitleaks (MIT) is the sanctioned source — or author an original
Socket rule. Never port one from a copyleft upstream.

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
