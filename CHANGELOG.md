# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0](https://github.com/SocketDev/socket-scan-patterns/releases/tag/v0.1.0) - 2026-09-13

### Added

- **`brand`** — regenerate the logomark
- **`brand`** — regenerate the logomark
- **`brand`** — regenerate the logomark
- **`brand`** — regenerate the logomark
- **`brand`** — regenerate the logomark
- **`brand`** — regenerate the logomark
- **`brand`** — regenerate the logomark
- **`brand`** — regenerate the logomark with solid, unclipped dots
- **`brand`** — regenerate the logomark with solid dots
- **`brand`** — add the repo logomark
- **`brand`** — regenerate the logomark with the flowing sweep
- **`brand`** — regenerate the logomark
- **`brand`** — regenerate the logomark with the drifting-wave animation
- **`brand`** — regenerate the logomark
- **`brand`** — add the repo logomark
- **`tables`** — add the generated detector pattern tables
- **`build`** — add the bundle, declarations, fuzz targets, and unit tests
- **`tables`** — add the generators, typed API, and derivation gates
- **`copyleft`** — make AGPL upstream implementation unreadable by construction
- **`upstream`** — pin the skillspector agent-skill scanner slice
- **`upstream`** — pin the six detector-source slices

### Fixed

- **`build`** — share table generator path
- **`test`** — build package before artifact inspection
- match Socket coverage badge styling
- **`tooling`** — align importer lines and hook options
- **`workspace`** — drop pnpm settings current pnpm rejects
- **`catalog`** — sync the sdk -stable alias to its base version
- **`catalog`** — sync the sdk -stable alias to the held base version
- **`soak`** — drop the unpublishable bare stuie exclude
- **`copyleft`** — root-anchor the metadata globs so nested detectors stay off disk

### Internal

- **`ci`** — align workflow contract
- **`deps`** — restore the yaml catalog entry and drop the orphaned pnpm pin
- **`check`** — conform the repo surface to the fleet gate
- **`fleet`** — resync -stable aliases, drop scripts with missing targets

## Unreleased

### Added

- Typed `PatternTable` API with per-rule provenance covering the `secrets`,
  `workflows`, `agentConfigs`, `skills`, and `manifests` scanner tables.
- Generators deriving each table from a pinned upstream slice under `upstream/`.
- A drift check that regenerates into a temp dir and fails when `data/` differs.
- A TruffleHog coverage-comparison oracle that reports detector-family gaps
  without ever gating on them.
