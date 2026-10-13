# API and Data Reference

`@socketsecurity/scan-patterns` publishes five scanner tables through the root API and as raw JSON. Consumers can load and validate a table at runtime or import a specific JSON file at build time. The package export map is in [`package.json`](../package.json).

## Scanner tables

| Scanner        | JSON file                                               | Rules | Primary use                                                        |
| -------------- | ------------------------------------------------------- | ----: | ------------------------------------------------------------------ |
| `agentConfigs` | [`data/agent-configs.json`](../data/agent-configs.json) |   235 | Agent configuration files.                                         |
| `manifests`    | [`data/manifests.json`](../data/manifests.json)         |     4 | Secret rules scoped to package manifests and configuration paths.  |
| `secrets`      | [`data/secrets.json`](../data/secrets.json)             |   317 | Secret-detection patterns derived from the table's pinned sources. |
| `skills`       | [`data/skills.json`](../data/skills.json)               |   418 | Agent-skill scanning patterns.                                     |
| `workflows`    | [`data/workflows.json`](../data/workflows.json)         |    41 | GitHub Actions workflow audits.                                    |

Rule counts are recorded from the checked-in tables. Each table includes `scanner`, `schemaVersion`, `sources`, and `rules`. Table shape changes require a schema-version change; source/rule updates do not by themselves change the schema version.

## Runtime accessors

The root module exports `getAgentConfigsTable()`, `getManifestsTable()`, `getSecretsTable()`, `getSkillsTable()`, and `getWorkflowsTable()`. `getPatternTable(scanner)` accepts a `ScannerName` and memoizes the parsed table after the first load. `loadPatternTable(scanner)` loads a table by scanner name and validates its shape.

```ts
import { findRuleById, getSecretsTable } from '@socketsecurity/scan-patterns'

const rule = findRuleById(getSecretsTable(), 'trivy:aws-access-key-id')
```

The root also exports `isPatternTable(value)`, `TABLE_FILE_BY_SCANNER`, `PATTERN_SEVERITY_ORDER`, and `PATTERN_TABLE_SCHEMA_VERSION`. Their exact signatures are in [`src/index.mts`](../src/index.mts) and [`src/load-table.mts`](../src/load-table.mts).

## Rule schema

`PatternTable` is the common container type. Each `PatternRule` records its id, title, description, category, severity, kind, engine dialect, regex flags, keyword prefilters, provenance, and optional regex/path-regex source and entropy threshold.

| Field                              | Meaning                                                                     |
| ---------------------------------- | --------------------------------------------------------------------------- |
| `id`                               | Stable rule identifier, unique within the table.                            |
| `title`, `description`, `category` | Human-readable rule metadata.                                               |
| `severity`                         | `critical`, `high`, `medium`, `low`, or `info`.                             |
| `kind`                             | `secret`, `audit`, `capability`, or `path`.                                 |
| `dialect`                          | `js` or `re2`, identifying the regex engine contract.                       |
| `regexSource`, `regexFlags`        | Content pattern and flags. A rule can omit a content pattern.               |
| `pathRegexSource`                  | Optional path-matching regex for path-scoped rules.                         |
| `keywords`                         | Literal substrings that must occur before the regex is tried.               |
| `entropy`                          | Optional Shannon-entropy floor.                                             |
| `provenance`                       | Upstream license, rule identifier, pinned source tag, and source-file path. |

See [`src/types.mts`](../src/types.mts) for `PatternRule`, `PatternTable`, `PatternProvenance`, `PatternKind`, `PatternDialect`, `PatternSeverity`, and `ScannerName` definitions.

## Pattern compilation and matching

`compileRuleRegex(rule)` creates a JavaScript `RegExp` only when the rule has a content pattern and `dialect: 'js'`. It returns `undefined` for `re2` rules and for rules without content patterns. `compileRulePathRegex(rule)` compiles a path expression only when the rule uses the JavaScript dialect and provides `pathRegexSource`.

Consumers must route `re2` rules to an RE2-compatible engine. Treating `undefined` from `compileRuleRegex` as “there is no rule” would omit RE2 rules and non-content audit/capability rows. See [`src/load-table.mts`](../src/load-table.mts) for loader validation and compilation behavior.

## Direct JSON imports

Each published table is available through a data subpath. Import only the file a consumer needs:

```js
import secretsTable from '@socketsecurity/scan-patterns/data/secrets.json' with { type: 'json' }

for (const rule of secretsTable.rules) {
  console.log(rule.id, rule.provenance.source)
}
```

Raw JSON imports support consumers that inline data during build. The runtime accessor API uses package files and memoizes loaded tables. Both forms use the same `PatternTable` data shape.

## Provenance and support boundaries

The `sources` field lists pinned upstream source tags for a table. Every rule has `provenance` with the upstream source, license, upstream rule id, and source file. See [`NOTICE`](../NOTICE) for attribution and license records.

This package publishes detector patterns and contracts. It does not decide whether a build-tool invocation is trusted and does not provide license detection. The root README records these boundaries and the sources from which each scanner family is derived.
