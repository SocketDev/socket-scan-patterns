# CLAUDE.md

**MANDATORY**: Act as principal-level engineer. Follow these guidelines exactly.

## 🏗️ scan-patterns-Specific

- 🚨 TruffleHog is AGPL-3.0 — CONFORMANCE-ONLY. Never copy, derive, transform, or
  emit a TruffleHog regex, rule datum, or source line into `data/`, `src/`, or any
  published artifact; it is a coverage-comparison oracle read at check time only.
- 🚨 `data/*.json` is generated — never hand-edit a table; fix the generator under
  `scripts/gen/` and re-run `pnpm run gen`.
- 🚨 Every generated row carries `provenance: { source, ruleId, license }`; a row
  without provenance is a defect, not an omission.
- 🚨 A generator reads ONLY its own pinned `upstream/<name>` slice, is idempotent,
  and fails loud (What / Where / Saw-vs-wanted / Fix) rather than emitting a
  partial table.
- Apache-2.0 derivations (Trivy, codex-security) require the `NOTICE` attribution
  to stay in sync with the tables they feed.
