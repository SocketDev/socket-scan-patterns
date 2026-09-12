/**
 * @file Vitiate coverage-guided fuzz target (Tier 2) for the upstream parsers —
 *   this package's untrusted-input boundary.
 *   "Untrusted" is the right word even though the inputs are pinned: a parser
 *   here consumes SOMEONE ELSE'S source tree, and that tree changes shape on
 *   every upstream release. The failure that matters is not a crash in
 *   production (there is no production; these run at build time) — it is a
 *   parser that silently returns nothing when an upstream reformats, because
 *   that ships a half-empty detector table and quietly disables a scanner.
 *   That exact bug already happened once: black-formatted multi-line tuples in
 *   SkillSpector were dropped, costing 148 of 416 patterns with no error.
 *   So each target asserts the two contracts that keep a generator honest on
 *   arbitrary bytes: it must never throw an unexpected type, and it must never
 *   invent a row out of malformed input.
 *   Run via `pnpm run test:fuzz`.
 */

import { fuzz } from '@vitiate/core'

import {
  readGitleaksKeywords,
  readGitleaksNumber,
  readGitleaksScalar,
  splitGitleaksRuleBlocks,
} from '../../scripts/repo/gen/import-gitleaks.mts'
import { parseSkillSpectorPatterns } from '../../scripts/repo/gen/import-skillspector.mts'
import { parseCodexCapabilities } from '../../scripts/repo/gen/import-codex-security.mts'
import { translateRegexForJs } from '../../scripts/repo/gen/_shared/regex-dialect.mts'
import { parseZizmorAuditDocs } from '../../scripts/repo/gen/port-zizmor-audits.mts'

fuzz('gitleaks TOML block splitter never throws on arbitrary bytes', data => {
  const blocks = splitGitleaksRuleBlocks(data.toString('utf8'))
  for (const block of blocks) {
    readGitleaksScalar(block, 'id')
    readGitleaksScalar(block, 'regex')
    readGitleaksKeywords(block)
    readGitleaksNumber(block, 'entropy')
  }
})

fuzz('SkillSpector pattern parser never throws on arbitrary bytes', data => {
  const patterns = parseSkillSpectorPatterns(data.toString('utf8'))
  for (const pattern of patterns) {
    // A parsed tuple must be well-formed or it should not have been emitted:
    // a NaN confidence silently becomes severity `low` and buries a critical.
    if (Number.isNaN(pattern.confidence)) {
      throw new Error(
        `SkillSpector parser emitted a NaN confidence for code ${pattern.code}`,
      )
    }
    if (pattern.source.length === 0) {
      throw new Error(
        `SkillSpector parser emitted an empty pattern for code ${pattern.code}`,
      )
    }
  }
})

fuzz('zizmor audit-doc parser never throws on arbitrary bytes', data => {
  const docs = parseZizmorAuditDocs(data.toString('utf8'))
  for (const doc of docs) {
    if (doc.id.length === 0) {
      throw new Error('zizmor parser emitted an audit with an empty id')
    }
  }
})

fuzz('codex capability parser never throws on arbitrary bytes', data => {
  const capabilities = parseCodexCapabilities(data.toString('utf8'))
  for (const capability of capabilities) {
    if (capability.name.length === 0) {
      throw new Error('codex parser emitted a capability with an empty name')
    }
  }
})

fuzz('regex translator never mislabels an uncompilable pattern', data => {
  const result = translateRegexForJs(data.toString('utf8'))
  // The `js` label is a promise to the consumer that `new RegExp(source, flags)`
  // works. If that promise can be broken by any input, the label is worthless.
  if (result.dialect === 'js') {
    // Throws on a broken promise, which is exactly the crash we want reported.
    void new RegExp(result.source, result.flags)
  }
})
