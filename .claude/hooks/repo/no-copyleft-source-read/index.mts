#!/usr/bin/env node
// Claude Code PreToolUse hook — no-copyleft-source-read (repo-tier).
//
// BLOCKS every route by which a copyleft upstream's IMPLEMENTATION could be
// read. This package is MIT; TruffleHog is AGPL-3.0. Deriving AGPL rules into
// an MIT package would relicense the package, so the posture is clean-room: we
// may observe a copyleft upstream's TESTS (enough to learn that a Stripe
// detector exists) and never its implementation.
//
// The primary defense is absence — the sparse-checkout admits only
// `*_test.go` and `testdata/**`, so implementation never lands on disk. This
// guard closes the routes that would reach around that:
//
//   1. Read/Grep/Glob on `upstream/trufflehog/**` at a non-test path.
//   2. Bash fetches of the upstream: `gh api repos/trufflesecurity/**`,
//      `curl`/`wget` of raw.githubusercontent.com/trufflesecurity/**.
//   3. `git show` / `git cat-file` against a non-test blob in the submodule.
//   4. `git -C upstream/trufflehog sparse-checkout set|add|disable` — widening
//      the cone would materialize implementation.
//   5. WebFetch of a copyleft upstream's source-hosting URL.
//
// Fails OPEN on a parse error: a guard bug must never wedge every tool call.
//
// Convention: docs/agents.md/repo/upstream-slices.md.
// Bypass: the user types `Allow copyleft-source-read bypass` verbatim.

import process from 'node:process'

import { bypassPhrasePresent, readStdin } from '../../fleet/_shared/transcript.mts'

const BYPASS_PHRASE = 'Allow copyleft-source-read bypass'
const BYPASS_LOOKBACK_USER_TURNS = 8

/**
 * Copyleft slices and the upstream org that publishes each. Keep in lock-step
 * with `COPYLEFT_LICENSES` + `UPSTREAM_SLICE_LICENSES` in
 * `scripts/repo/upstream-config.mts`; the check script
 * `copyleft-slices-are-tests-only.mts` is the belt that catches a slice added
 * there but not here.
 */
export const COPYLEFT_SLICES: ReadonlyArray<{
  readonly license: string
  readonly org: string
  readonly slice: string
}> = [
  { license: 'AGPL-3.0', org: 'trufflesecurity', slice: 'trufflehog' },
]

/** The sanctioned permissive alternative, named in every refusal. */
export const SANCTIONED_ALTERNATIVE =
  'gitleaks (MIT) via scripts/repo/gen/import-gitleaks.mts'

interface PreToolUsePayload {
  readonly tool_name?: string | undefined
  readonly tool_input?:
    | {
        readonly command?: unknown | undefined
        readonly file_path?: unknown | undefined
        readonly pattern?: unknown | undefined
        readonly path?: unknown | undefined
        readonly url?: unknown | undefined
      }
    | undefined
  readonly transcript_path?: string | undefined
}

/** One reason the call was refused. */
export interface CopyleftReadFinding {
  readonly detail: string
  readonly license: string
  readonly slice: string
}

/**
 * A path inside a copyleft slice is readable only when it is a Go test or a
 * fixture — the same allowlist the sparse-checkout enforces.
 */
export function isAllowedCopyleftPath(candidate: string): boolean {
  const normalized = candidate.replace(/\\/g, '/')
  return normalized.endsWith('_test.go') || normalized.includes('/testdata/')
}

/**
 * Flag a direct file-tool access at a non-test path inside a copyleft slice.
 */
export function detectPathAccess(
  candidate: string,
): CopyleftReadFinding | undefined {
  const normalized = candidate.replace(/\\/g, '/')
  for (const entry of COPYLEFT_SLICES) {
    const marker = `upstream/${entry.slice}`
    if (!normalized.includes(marker)) {
      continue
    }
    // The slice root itself, and any test path, stay readable.
    const tail = normalized.slice(normalized.indexOf(marker) + marker.length)
    if (tail === '' || tail === '/' || isAllowedCopyleftPath(normalized)) {
      return undefined
    }
    return {
      detail: `a non-test path inside the ${entry.slice} slice: ${normalized}`,
      license: entry.license,
      slice: entry.slice,
    }
  }
  return undefined
}

/**
 * Flag a Bash command that would fetch, widen, or dump copyleft implementation.
 */
export function detectBashAccess(
  command: string,
): CopyleftReadFinding | undefined {
  const text = command.replace(/\s+/g, ' ')
  for (const entry of COPYLEFT_SLICES) {
    const { license, org, slice } = entry

    // Widening the sparse cone would materialize implementation.
    if (
      new RegExp(
        `git\\b[^|;&]*upstream/${slice}[^|;&]*sparse-checkout\\s+(?:add|disable|set)`,
      ).test(text) ||
      new RegExp(
        `sparse-checkout\\s+(?:add|disable|set)[^|;&]*upstream/${slice}`,
      ).test(text)
    ) {
      return {
        detail: `a sparse-checkout widening on the ${slice} slice`,
        license,
        slice,
      }
    }

    // Dumping a blob straight out of the submodule's object store.
    const blobDump = new RegExp(
      `git\\b[^|;&]*-C\\s+\\S*upstream/${slice}\\S*[^|;&]*\\b(?:cat-file|show)\\b([^|;&]*)`,
    ).exec(text)
    if (blobDump && !isAllowedCopyleftPath(blobDump[1] ?? '')) {
      return {
        detail: `a git show/cat-file against a non-test blob in the ${slice} slice`,
        license,
        slice,
      }
    }

    // Fetching the upstream over the network, bypassing the sparse checkout.
    if (
      new RegExp(`gh\\s+api\\b[^|;&]*repos/${org}/`, 'i').test(text) ||
      new RegExp(
        `(?:curl|wget)\\b[^|;&]*(?:raw\\.githubusercontent\\.com|codeload\\.github\\.com|github\\.com)/${org}/`,
        'i',
      ).test(text)
    ) {
      return {
        detail: `a network fetch of ${org} source, which bypasses the tests-only checkout`,
        license,
        slice,
      }
    }
  }
  return undefined
}

/**
 * Flag a WebFetch of a copyleft upstream's source hosting.
 */
export function detectUrlAccess(url: string): CopyleftReadFinding | undefined {
  for (const entry of COPYLEFT_SLICES) {
    if (new RegExp(`/${entry.org}/`, 'i').test(url)) {
      return {
        detail: `a WebFetch of ${entry.org} source: ${url}`,
        license: entry.license,
        slice: entry.slice,
      }
    }
  }
  return undefined
}

/**
 * Resolve the finding, if any, for a tool call.
 */
export function detectCopyleftRead(
  payload: PreToolUsePayload,
): CopyleftReadFinding | undefined {
  const toolName = payload.tool_name ?? ''
  const input = payload.tool_input ?? {}

  if (toolName === 'Bash') {
    const command = typeof input.command === 'string' ? input.command : ''
    return command ? detectBashAccess(command) : undefined
  }
  if (toolName === 'WebFetch') {
    const url = typeof input.url === 'string' ? input.url : ''
    return url ? detectUrlAccess(url) : undefined
  }
  const candidates = [input.file_path, input.path, input.pattern].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  )
  for (let i = 0, { length } = candidates; i < length; i += 1) {
    const finding = detectPathAccess(candidates[i]!)
    if (finding) {
      return finding
    }
  }
  return undefined
}

/**
 * Hook entry point. Returns the process exit code: 2 blocks, 0 allows.
 */
export async function main(): Promise<number> {
  const raw = await readStdin()
  let payload: PreToolUsePayload
  try {
    payload = JSON.parse(raw) as PreToolUsePayload
  } catch {
    return 0
  }

  const finding = detectCopyleftRead(payload)
  if (!finding) {
    return 0
  }
  if (
    bypassPhrasePresent(
      payload.transcript_path,
      BYPASS_PHRASE,
      BYPASS_LOOKBACK_USER_TURNS,
    )
  ) {
    return 0
  }

  process.stderr.write(
    [
      `🚨 no-copyleft-source-read: blocked a read of ${finding.license} implementation.`,
      ``,
      `What:   this package is MIT. ${finding.slice} is ${finding.license}.`,
      `        Reading its implementation contaminates a clean-room derivation —`,
      `        deriving from it would relicense @socketsecurity/scan-patterns.`,
      `Where:  upstream/${finding.slice}`,
      `Saw:    ${finding.detail}`,
      `Wanted: TESTS ONLY — \`*_test.go\` files and \`testdata/\` fixtures. The`,
      `        coverage oracle infers detector families from test FILE PATHS`,
      `        (that \`stripe/stripe_test.go\` exists proves a Stripe detector`,
      `        exists). It never reads implementation, and no generator or table`,
      `        row may cite ${finding.slice} as a source.`,
      `Fix:    for secret detection, derive from ${SANCTIONED_ALTERNATIVE}.`,
      `        For coverage questions, run pnpm run check:coverage-oracle.`,
      ``,
      `This block is the license boundary, not a style rule. If you genuinely`,
      `need it, the user must type \`${BYPASS_PHRASE}\` verbatim in a recent turn.`,
      ``,
    ].join('\n'),
  )
  return 2
}

main().then(
  code => process.exit(code),
  () => process.exit(0),
)
