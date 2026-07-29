/**
 * @file Ports zizmor's workflow audits into the `workflows` table. MIT. Reads
 *   only `upstream/zizmor/docs/audits.md`.
 *   This port is DOCUMENTATION-driven on purpose. zizmor's audits are Rust
 *   implementations, not a pattern table, so there is no regex to lift —
 *   scraping the crate would produce rows that only look like data. What the
 *   docs DO give, per audit, is a stable id, a capability table (type,
 *   offline, auto-fix, configurable) and prose. So the generator emits a
 *   CHECKLIST: one `kind: 'audit'` row per upstream audit, carrying its
 *   implemented status from `.config/repo/zizmor-audit-status.json`.
 *   The status file is separate from this generator so the two can disagree
 *   loudly: a newly published upstream audit is an unlisted id and fails the
 *   run, rather than quietly never being considered.
 */

import path from 'node:path'

import type { PatternRule, PatternSeverity } from './_shared/table-types.mts'
import type { DerivedRowSet } from './_shared/emit-table.mts'
import type { UpstreamSlice } from './_shared/upstream-slice.mts'

import { assertRowsPresent, writeSourceRowSet } from './_shared/emit-table.mts'
import { CONFIG_REPO_DIR } from '../paths.mts'
import {
  isJsonObject,
  readJsonObjectFile,
  readStringProp,
} from '../read-json.mts'
import {
  readSliceFile,
  resolveUpstreamSlice,
  sliceFilePath,
} from './_shared/upstream-slice.mts'

/**
 * Path of the derivation source inside the pinned slice.
 */
export const ZIZMOR_AUDITS_REL_PATH = 'docs/audits.md'

/**
 * Repo-owned implementation status, kept out of this generator by design.
 */
export const ZIZMOR_STATUS_FILE = path.join(
  CONFIG_REPO_DIR,
  'zizmor-audit-status.json',
)

/**
 * Accepted values of an audit's `status`.
 */
export type ZizmorAuditStatus = 'declined' | 'implemented' | 'planned'

/**
 * One entry in the status file.
 */
export interface ZizmorAuditStatusEntry {
  readonly reason?: string | undefined
  readonly status: ZizmorAuditStatus
}

/**
 * One audit as described by the pinned docs.
 */
export interface ZizmorAuditDoc {
  readonly id: string
  /**
   * First prose paragraph after the capability table.
   */
  readonly summary: string
}

/**
 * A ported audit's severity is its Socket posture, not a zizmor field —
 * zizmor assigns severity per finding at scan time, not per audit. A declined
 * audit is informational; everything the fleet runs or intends to run is a
 * medium-or-better workflow finding.
 */
export function zizmorStatusToSeverity(
  status: ZizmorAuditStatus,
): PatternSeverity {
  switch (status) {
    case 'declined':
      return 'info'
    case 'implemented':
      return 'medium'
    default:
      return 'low'
  }
}

/**
 * Read the repo-owned status map.
 */
export function readZizmorAuditStatus(): ReadonlyMap<
  string,
  ZizmorAuditStatusEntry
> {
  const root = readJsonObjectFile(ZIZMOR_STATUS_FILE)
  const audits = root['audits']
  if (!isJsonObject(audits)) {
    throw new Error(
      `Zizmor status file has no "audits" object.\n` +
        `  where: ${ZIZMOR_STATUS_FILE}\n` +
        `  saw:   audits = ${audits === undefined ? 'absent' : typeof audits}\n` +
        `  wanted: an object mapping audit id to { status, reason? }\n` +
        `  fix:   restore the "audits" key; see the file's own $comment`,
    )
  }
  const entries = new Map<string, ZizmorAuditStatusEntry>()
  for (const [id, raw] of Object.entries(audits)) {
    if (!isJsonObject(raw)) {
      continue
    }
    const status = readStringProp(raw, 'status')
    if (
      status !== 'declined' &&
      status !== 'implemented' &&
      status !== 'planned'
    ) {
      throw new Error(
        `Unknown audit status.\n` +
          `  where: ${ZIZMOR_STATUS_FILE} → audits["${id}"]\n` +
          `  saw:   status = ${JSON.stringify(status)}\n` +
          `  wanted: "implemented", "planned", or "declined"\n` +
          `  fix:   set one of the three accepted values`,
      )
    }
    entries.set(id, { reason: readStringProp(raw, 'reason'), status })
  }
  return entries
}

/**
 * Pull every `## \`audit-id`` section out of the docs with its lead prose.
 */
export function parseZizmorAuditDocs(
  markdown: string,
): readonly ZizmorAuditDoc[] {
  const docs: ZizmorAuditDoc[] = []
  const sectionPattern = /^## `([a-z0-9-]+)`\s*$/gm
  const starts: Array<{ id: string; index: number }> = []
  let matched = sectionPattern.exec(markdown)
  while (matched) {
    starts.push({ id: matched[1]!, index: matched.index })
    matched = sectionPattern.exec(markdown)
  }
  for (let i = 0, { length } = starts; i < length; i += 1) {
    const { id, index } = starts[i]!
    const end = i + 1 < length ? starts[i + 1]!.index : markdown.length
    const body = markdown.slice(index, end)
    docs.push({ id, summary: extractZizmorSummary(body) })
  }
  return docs
}

/**
 * First real prose paragraph of a section — skipping the heading, the
 * capability table, and the reference-link definitions that follow it.
 */
export function extractZizmorSummary(sectionBody: string): string {
  const lines = sectionBody.split('\n')
  const paragraph: string[] = []
  for (let i = 1, { length } = lines; i < length; i += 1) {
    const line = lines[i]!.trim()
    if (line.length === 0) {
      if (paragraph.length > 0) {
        break
      }
      continue
    }
    if (
      line.startsWith('|') ||
      line.startsWith('###') ||
      line.startsWith('!!!') ||
      /^\[[^\]]+\]:\s/.test(line)
    ) {
      if (paragraph.length > 0) {
        break
      }
      continue
    }
    paragraph.push(line)
  }
  return paragraph.join(' ').replace(/\s+/g, ' ').trim()
}

/**
 * Build the checklist rows, failing loud on any drift between the pinned docs
 * and the repo-owned status map.
 */
export function deriveZizmorAudits(slice: UpstreamSlice): DerivedRowSet {
  const markdown = readSliceFile(slice, ZIZMOR_AUDITS_REL_PATH)
  const sourceFile = sliceFilePath(slice, ZIZMOR_AUDITS_REL_PATH)
  const docs = parseZizmorAuditDocs(markdown)
  const statuses = readZizmorAuditStatus()

  const documented = new Set(docs.map(doc => doc.id))
  const unlisted = docs.filter(doc => !statuses.has(doc.id)).map(doc => doc.id)
  if (unlisted.length > 0) {
    throw new Error(
      `zizmor published audits this repo has not triaged.\n` +
        `  where: ${ZIZMOR_STATUS_FILE}\n` +
        `  saw:   ${unlisted.join(', ')} documented in ${slice.source} but absent from the status map\n` +
        `  wanted: every upstream audit carries an explicit implemented/planned/declined status\n` +
        `  fix:   add each id to .config/repo/zizmor-audit-status.json with a status ` +
        `(a "declined" entry also needs a "reason"), then re-run pnpm run gen`,
    )
  }
  const stale = [...statuses.keys()].filter(id => !documented.has(id))
  if (stale.length > 0) {
    throw new Error(
      `Status map lists audits the pinned zizmor no longer documents.\n` +
        `  where: ${ZIZMOR_STATUS_FILE}\n` +
        `  saw:   ${stale.join(', ')} listed but not in ${sourceFile}\n` +
        `  wanted: the status map to mirror the pinned docs exactly\n` +
        `  fix:   drop the removed ids, or re-pin zizmor if the removal was unintended`,
    )
  }

  const rules: PatternRule[] = []
  for (let i = 0, { length } = docs; i < length; i += 1) {
    const doc = docs[i]!
    const entry = statuses.get(doc.id)!
    if (entry.status === 'declined' && !entry.reason) {
      throw new Error(
        `A declined audit needs a reason.\n` +
          `  where: ${ZIZMOR_STATUS_FILE} → audits["${doc.id}"]\n` +
          `  saw:   status "declined" with no "reason"\n` +
          `  wanted: every deliberate exclusion states why\n` +
          `  fix:   add a "reason" explaining why ${doc.id} is out of scope`,
      )
    }
    rules.push({
      category: entry.status,
      description: entry.reason
        ? `${doc.summary} Declined: ${entry.reason}`
        : doc.summary,
      entropy: undefined,
      id: `zizmor:${doc.id}`,
      keywords: [],
      kind: 'audit',
      pathRegexSource: undefined,
      provenance: {
        license: slice.license,
        ruleId: doc.id,
        source: slice.source,
        sourceFile,
      },
      regexFlags: '',
      regexSource: undefined,
      severity: zizmorStatusToSeverity(entry.status),
      title: doc.id,
    })
  }

  assertRowsPresent(rules, {
    generator: 'scripts/repo/gen/port-zizmor-audits.mts',
    sourceFile,
  })
  return { rules, sources: [slice.source] }
}

/**
 * Generator entry point: derive and write `data/sources/zizmor.json`.
 */
export function generateZizmorSource(): DerivedRowSet {
  const slice = resolveUpstreamSlice('zizmor')
  const rowSet = deriveZizmorAudits(slice)
  writeSourceRowSet('zizmor', rowSet)
  return rowSet
}
