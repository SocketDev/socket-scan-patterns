# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`tables`** — add the generated detector pattern tables
- **`build`** — add the bundle, declarations, fuzz targets, and unit tests
- **`tables`** — add the generators, typed API, and derivation gates
- **`copyleft`** — make AGPL upstream implementation unreadable by construction
- **`upstream`** — pin the skillspector agent-skill scanner slice
- **`upstream`** — pin the six detector-source slices

### Fixed

- **`copyleft`** — root-anchor the metadata globs so nested detectors stay off disk

## Unreleased

### Added

- Typed `PatternTable` API with per-rule provenance covering the `secrets`,
  `workflows`, `agentConfigs`, `skills`, and `manifests` scanner tables.
- Generators deriving each table from a pinned upstream slice under `upstream/`.
- A drift check that regenerates into a temp dir and fails when `data/` differs.
- A TruffleHog coverage-comparison oracle that reports detector-family gaps
  without ever gating on them.
