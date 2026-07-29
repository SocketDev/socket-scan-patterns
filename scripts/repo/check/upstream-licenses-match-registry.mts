/**
 * @file `check --all` gate: each upstream's RECORDED license still matches what
 *   Socket's API reports for it.
 *   This repo's whole premise is deriving from other people's licensed work.
 *   The recorded SPDX id drives three things — the `NOTICE` attribution, each
 *   row's `provenance.license`, and whether a slice is treated as copyleft and
 *   therefore tests-only. If an upstream relicenses and nobody notices, a
 *   compliant derivation silently becomes a non-compliant one.
 *   That is not hypothetical: **TruffleHog relicensed GPL-2.0 → AGPL-3.0 at
 *   v3.0**. Had this package been deriving from it then, the relicense alone
 *   would have made the derivation non-compliant without a single line
 *   changing here.
 *   Never build license DETECTION. Socket's API already returns authoritative
 *   per-package license data (`LicenseDetails.spdxDisj`), so this check
 *   CONSUMES that rather than sniffing LICENSE files.
 *   Fail-open on connectivity, never fail-closed:
 *
 *   - no token / no network / API error ⇒ SKIP, announced
 *   - `errorData` or a low-confidence read ⇒ UNVERIFIED, announced
 *   - a confident, conflicting `spdxDisj` ⇒ FAIL Because the runner invokes
 *     checks argless it cannot tell tiers apart, so the network gate IS the
 *     tier: with no token configured this exits immediately, keeping the
 *     interactive loop offline.
 */

import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { readSocketApiTokenSync } from '@socketsecurity/lib-stable/secrets/socket-api-token'

import { isJsonObject } from '../read-json.mts'
import { UPSTREAM_SLICE_LICENSES } from '../upstream-config.mts'

const logger = getDefaultLogger()

/**
 * Package URL per upstream slice. gitleaks, Trivy and TruffleHog are Go
 * modules; SkillSpector is a Python distribution; AgentShield is an npm
 * package; zizmor is a crate. codex-security ships from a monorepo subpath
 * with no registry identity of its own, so it has no purl and is reported
 * UNVERIFIED rather than guessed at.
 */
export const UPSTREAM_PURLS: Readonly<Record<string, string | undefined>> = {
  agentshield: 'pkg:npm/agentshield',
  'codex-security': undefined,
  gitleaks: 'pkg:golang/github.com/gitleaks/gitleaks',
  skillspector: 'pkg:pypi/skillspector',
  trivy: 'pkg:golang/github.com/aquasecurity/trivy',
  trufflehog: 'pkg:golang/github.com/trufflesecurity/trufflehog',
  zizmor: 'pkg:cargo/zizmor',
}

/**
 * Minimum confidence before a reported license is treated as authoritative
 * enough to FAIL on. Below this a mismatch is reported UNVERIFIED — a
 * low-confidence read is a reason to look, not a reason to break the build.
 */
export const MIN_LICENSE_CONFIDENCE = 0.8

/**
 * Per-upstream verdict.
 */
export type LicenseVerdict = 'match' | 'mismatch' | 'skipped' | 'unverified'

/**
 * What the check concluded for one upstream.
 */
export interface LicenseFinding {
  readonly detail: string
  readonly recorded: string
  readonly reported: string | undefined
  readonly slice: string
  readonly verdict: LicenseVerdict
}

/**
 * True when the API's SPDX expression still covers the recorded id.
 *
 * `spdxDisj` is a disjunctive-normal-form EXPRESSION (`(MIT OR Apache-2.0)`),
 * not a bare id, so a substring test on the token is the right comparison —
 * an exact string equality would false-alarm on every dual-licensed upstream.
 */
export function spdxExpressionCoversId(
  expression: string,
  recordedId: string,
): boolean {
  const tokens = expression
    .toUpperCase()
    // Splits an SPDX expression into bare license tokens: on brackets and
    // whitespace, and on the OR / AND / WITH operators that join them.
    .split(/[()\s]+|\bOR\b|\bAND\b|\bWITH\b/)
    .map(token => token.trim())
    .filter(token => token.length > 0)
  const recorded = recordedId.toUpperCase()
  // An upstream recorded as `AGPL-3.0` may report `AGPL-3.0-only` /
  // `AGPL-3.0-or-later`; both are the same license family.
  return tokens.some(
    token => token === recorded || token.startsWith(`${recorded}-`),
  )
}

/**
 * One license record from the API, reduced to what this check needs.
 */
export interface ReportedLicense {
  readonly confidence: number
  readonly errorData: string
  readonly spdxDisj: string
}

/**
 * Ask Socket's API for each upstream's license.
 *
 * Returns `undefined` when the lookup could not be performed at all, which the
 * caller reports as SKIPPED. Any thrown error is caught here — an API outage
 * must never turn into a red build in this repo.
 */
export async function fetchReportedLicenses(
  purlsBySlice: ReadonlyMap<string, string>,
): Promise<ReadonlyMap<string, ReportedLicense> | undefined> {
  const token = readSocketApiTokenSync()
  if (!token) {
    return undefined
  }
  try {
    const { SocketSdk } = await import('@socketsecurity/sdk')
    const sdk = new SocketSdk(token)
    const components = [...purlsBySlice.values()].map(purl => ({ purl }))
    const result = await sdk.batchPackageFetch(
      { components },
      { include_license_details: true },
    )
    return reduceBatchResult(result, purlsBySlice)
  } catch {
    return undefined
  }
}

/**
 * Pull `{ purl → license }` out of the batch response, tolerating shape drift.
 *
 * The response is walked defensively rather than cast: this check must degrade
 * to UNVERIFIED if the API shape moves, never crash the whole `check --all`.
 */
export function reduceBatchResult(
  result: unknown,
  purlsBySlice: ReadonlyMap<string, string>,
): ReadonlyMap<string, ReportedLicense> {
  const bySlice = new Map<string, ReportedLicense>()
  const rows = extractBatchRows(result)
  const sliceByPurl = new Map<string, string>()
  for (const [slice, purl] of purlsBySlice) {
    sliceByPurl.set(stripPurlVersion(purl), slice)
  }
  for (let i = 0, { length } = rows; i < length; i += 1) {
    const row = rows[i]!
    const purl = typeof row['purl'] === 'string' ? row['purl'] : undefined
    if (!purl) {
      continue
    }
    const slice = sliceByPurl.get(stripPurlVersion(purl))
    if (!slice) {
      continue
    }
    const details = row['licenseDetails']
    if (!Array.isArray(details) || details.length === 0) {
      continue
    }
    const record: unknown = details[0]
    if (!isJsonObject(record)) {
      continue
    }
    bySlice.set(slice, {
      confidence:
        typeof record['confidence'] === 'number' ? record['confidence'] : 0,
      errorData:
        typeof record['errorData'] === 'string' ? record['errorData'] : '',
      spdxDisj:
        typeof record['spdxDisj'] === 'string' ? record['spdxDisj'] : '',
    })
  }
  return bySlice
}

/**
 * Find the array of package rows in a batch response.
 */
export function extractBatchRows(
  result: unknown,
): ReadonlyArray<Record<string, unknown>> {
  const candidates: unknown[] = [result]
  if (isJsonObject(result)) {
    candidates.push(result['data'], result['results'], result['components'])
  }
  for (let i = 0, { length } = candidates; i < length; i += 1) {
    const candidate = candidates[i]
    if (Array.isArray(candidate)) {
      return candidate.filter(
        (row): row is Record<string, unknown> =>
          typeof row === 'object' && row !== null,
      )
    }
  }
  return []
}

/**
 * Drop a `@version` suffix so a purl matches regardless of the pinned version.
 */
export function stripPurlVersion(purl: string): string {
  const at = purl.lastIndexOf('@')
  return at > purl.indexOf('/') ? purl.slice(0, at) : purl
}

/**
 * Compare recorded to reported for every slice.
 */
export async function checkUpstreamLicenses(): Promise<
  readonly LicenseFinding[]
> {
  const purlsBySlice = new Map<string, string>()
  for (const [slice, purl] of Object.entries(UPSTREAM_PURLS)) {
    if (purl) {
      purlsBySlice.set(slice, purl)
    }
  }

  const reported = await fetchReportedLicenses(purlsBySlice)
  const findings: LicenseFinding[] = []

  for (const [slice, recorded] of Object.entries(UPSTREAM_SLICE_LICENSES)) {
    const purl = UPSTREAM_PURLS[slice]
    if (!purl) {
      findings.push({
        detail:
          'no package-registry identity, so the license cannot be looked up',
        recorded,
        reported: undefined,
        slice,
        verdict: 'unverified',
      })
      continue
    }
    if (!reported) {
      findings.push({
        detail: 'no API token or the lookup failed',
        recorded,
        reported: undefined,
        slice,
        verdict: 'skipped',
      })
      continue
    }
    const record = reported.get(slice)
    if (!record || record.spdxDisj.length === 0) {
      findings.push({
        detail: 'the API returned no license details for this purl',
        recorded,
        reported: undefined,
        slice,
        verdict: 'unverified',
      })
      continue
    }
    if (record.errorData.length > 0) {
      findings.push({
        detail: `the API reported a parse error: ${record.errorData}`,
        recorded,
        reported: record.spdxDisj,
        slice,
        verdict: 'unverified',
      })
      continue
    }
    if (spdxExpressionCoversId(record.spdxDisj, recorded)) {
      findings.push({
        detail: 'recorded license still matches',
        recorded,
        reported: record.spdxDisj,
        slice,
        verdict: 'match',
      })
      continue
    }
    if (record.confidence < MIN_LICENSE_CONFIDENCE) {
      findings.push({
        detail: `reported license differs but confidence is only ${record.confidence}`,
        recorded,
        reported: record.spdxDisj,
        slice,
        verdict: 'unverified',
      })
      continue
    }
    findings.push({
      detail: 'the upstream appears to have RELICENSED',
      recorded,
      reported: record.spdxDisj,
      slice,
      verdict: 'mismatch',
    })
  }

  return findings
}

/**
 * CLI entry point.
 */
export async function main(): Promise<void> {
  const findings = await checkUpstreamLicenses()
  const mismatches = findings.filter(finding => finding.verdict === 'mismatch')
  const unverified = findings.filter(
    finding => finding.verdict === 'unverified',
  )
  const skipped = findings.filter(finding => finding.verdict === 'skipped')
  const matched = findings.filter(finding => finding.verdict === 'match')

  if (skipped.length === findings.length) {
    logger.info(
      'upstream-licenses-match-registry: skipped — no Socket API token configured, so no lookup was attempted. Set SOCKET_API_TOKEN to enable this gate.',
    )
    return
  }

  logger.info(
    `upstream-licenses-match-registry: ${matched.length} verified, ${unverified.length} unverified, ${skipped.length} skipped, ${mismatches.length} mismatched.`,
  )
  for (let i = 0, { length } = unverified; i < length; i += 1) {
    const finding = unverified[i]!
    logger.info(`  UNVERIFIED ${finding.slice} — ${finding.detail}`)
  }

  if (mismatches.length === 0) {
    return
  }
  logger.error(
    `upstream-licenses-match-registry: ${mismatches.length} upstream(s) no longer carry their recorded license.`,
  )
  for (let i = 0, { length } = mismatches; i < length; i += 1) {
    const finding = mismatches[i]!
    logger.error(`  where: upstream/${finding.slice}`)
    logger.error(
      `  saw:   Socket reports ${finding.reported}, this repo records ${finding.recorded}`,
    )
    logger.error(
      `  wanted: the recorded SPDX id to still cover the reported expression`,
    )
    logger.error(
      `  fix:   confirm the relicense, then update UPSTREAM_SLICE_LICENSES in ` +
        `scripts/repo/upstream-config.mts, the NOTICE attribution, and re-run ` +
        `pnpm run gen so every row's provenance.license is corrected. If the new ` +
        `license is copyleft, the slice ALSO becomes tests-only — narrow its ` +
        `sparse-checkout and drop its generator before regenerating.`,
    )
  }
  process.exitCode = 1
}

main().catch((error: unknown) => {
  logger.info(
    `upstream-licenses-match-registry: skipped — ${errorMessage(error)}`,
  )
})
