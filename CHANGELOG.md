# Changelog

All notable changes to xapi-doctor are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-05-24

Initial public release.

### Added
- `xapi-doctor lint <file.json>` — xAPI 1.0.3 statement validation. 25 rules
  across statement shape, actor IFI uniqueness, verb / object IRIs, score
  range, ISO-8601 timestamps and durations, context registration, and
  Agent-vs-Activity context constraints.
- `--profile cmi5` adds the cmi5-specific lints: reserved-verb registration
  requirement, `moveon` category activity for Passed/Failed/Completed, and the
  `mbox`-without-`account` warning.
- `xapi-doctor ping <lrs-url>` — LRS reachability, `GET /about` parsing,
  version advertisement check, CORS visibility, authenticated
  `GET /statements?limit=1` probe, `X-Experience-API-Version` echo check.
- `xapi-doctor send <file.json> <lrs-url>` — lint then POST; refuses to POST
  invalid statements unless `--no-validate`; explains common LRS error codes
  in plain English (400, 401, 403, 404, 409, 413, 415, 5xx).
- `--json` flag on every subcommand for CI pipelines.
- Conventional exit codes: `0` clean, `1` warnings only, `2` errors.
- Test suite: 17 tests, including HTTP tests against a local mock LRS.

### Notes
- Zero runtime dependencies. Pure Node, no `npm install` needed to run.
- Node ≥18.
