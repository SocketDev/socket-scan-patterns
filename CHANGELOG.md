# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Added

- Typed `PatternTable` API with per-rule provenance covering the `secrets`,
  `workflows`, `agentConfigs`, `skills`, and `manifests` scanner tables.
- Generators deriving each table from a pinned upstream slice under `upstream/`.
- A drift check that regenerates into a temp dir and fails when `data/` differs.
- A TruffleHog coverage-comparison oracle that reports detector-family gaps
  without ever gating on them.
