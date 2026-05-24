# xapi-doctor

[![tests](https://github.com/parthdhanani/xapi-doctor/actions/workflows/test.yml/badge.svg)](https://github.com/parthdhanani/xapi-doctor/actions/workflows/test.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg)](https://nodejs.org)
[![tests](https://img.shields.io/badge/tests-17%2F17-brightgreen.svg)](test/run.js)
[![runtime deps](https://img.shields.io/badge/runtime%20deps-0-brightgreen.svg)](package.json)

**Diagnose xAPI statements and LRS connectivity.** Three subcommands. Zero runtime dependencies. Built because the most common xAPI failures — a malformed statement, a missing `X-Experience-API-Version` header, an LRS that 401s for reasons the dashboard doesn't explain — should be findable in seconds, not in an LRS log dive.

```bash
npm install -g xapi-doctor

xapi-doctor lint  statement.json --profile cmi5
xapi-doctor ping  https://lrs.example.com/data/xAPI/ --auth user:pass
xapi-doctor send  statements.json https://lrs.example.com/data/xAPI/ --auth user:pass
```

Exit codes: `0` clean, `1` warnings only, `2` errors. Every command supports `--json` for CI pipelines.

## Why this exists

cmi5 and xAPI are the spec stack most enterprise LMS RFPs ask for in 2026. The toolchain around them is thin:

- The ADL conformance tester exists but is a complete-spec test rig, not a developer's tool.
- LRS vendors offer "send a statement" debug UIs, but those don't tell you which field of your existing statement is wrong.
- The first signal that something is broken is usually a 400 from the LRS with a body like `{"message":"Invalid request"}` and nothing else.

`xapi-doctor` is the small CLI for the moments when you have a statement file or an LRS endpoint and you need a fast, specific answer. It's the diagnostic counterpart to [scorm-kit](https://github.com/parthdhanani/scorm-kit), which handles SCORM / cmi5 packaging.

## Commands

### `xapi-doctor lint <file.json> [--profile cmi5]`

Validates an xAPI statement (or an array of them) against the [xAPI 1.0.3 spec](https://github.com/adlnet/xAPI-Spec). Catches:

- Missing required fields (`actor`, `verb`, `object`)
- Non-UUID statement ids and registrations
- ISO-8601 timestamp and duration violations
- IRI shape on `verb.id`, `object.id`, `object.definition.type`
- Actor IFI rules: exactly one of `mbox` / `mbox_sha1sum` / `openid` / `account`
- `mailto:` shape on `actor.mbox`; full account shape on `actor.account`
- Score range: `scaled` in `[-1, 1]`, `raw` between `min` and `max`
- Context misuse: `revision`/`platform` on Agent objects, non-UUID `registration`
- `verb.display` language map presence and `en` entry

With `--profile cmi5`, adds the cmi5-specific constraints:

- cmi5 reserved verbs (Launched / Initialized / Completed / Passed / Failed / Abandoned / Waived / Terminated / Satisfied) require `context.registration`
- `Passed` / `Failed` / `Completed` require the `https://w3id.org/xapi/cmi5/context/categories/moveon` category activity
- `actor.mbox` without `actor.account` is flagged — cmi5 LMSs always launch with the `account` IFI, and an `mbox`-only statement will likely not match the LMS-assigned learner

### `xapi-doctor ping <lrs-url> [--auth user:pass]`

Verifies that an LRS is reachable and behaving like a 1.0.3-compliant LRS:

- DNS, TCP, TLS reachability of the base URL
- `GET /about` returns a version array
- `1.0.3` is among the advertised versions
- `Access-Control-Allow-Origin` is present (browser-based clients fail silently without it)
- With `--auth`, performs an authenticated `GET /statements?limit=1` and reports 200 / 401 / 403 distinctly
- LRS echoes `X-Experience-API-Version` per §6.2 of the spec

### `xapi-doctor send <file.json> <lrs-url> [--auth user:pass] [--profile cmi5]`

Lints the statement(s) locally, then POSTs them to the LRS and reports the result. Refuses to POST a statement that would fail `lint` (use `--no-validate` to override). On non-2xx, decodes the most common LRS responses into human-readable explanations — 400 / 401 / 403 / 404 / 409 / 413 / 415 / 5xx.

The `--profile cmi5` flag is forwarded to the lint pass.

## Pairs with

- **[scorm-kit](https://github.com/parthdhanani/scorm-kit)** — the SCORM / cmi5 build pipeline. `scorm-kit cmi5 convert` produces a cmi5 package; once it's launched and statements are flowing, `xapi-doctor` is what tells you whether the statements are well-formed and whether the LRS is healthy.

## What xapi-doctor is not

- A full LRS conformance suite. The ADL test rig exists for that.
- A statement generator. It validates and forwards; it does not produce statements.
- An LRS. For development you want a real one — Veracity, Yet, or Learning Locker — running locally in Docker.

## Building from source

```bash
git clone https://github.com/parthdhanani/xapi-doctor
cd xapi-doctor
npm test
```

Zero runtime deps; `npm install` is not required to run.

## Tests

17 tests in `test/run.js`. The HTTP tests spin up a mock LRS on a random local port and exercise `ping` / `send` against it.

```bash
npm test
```

## License

MIT. See `LICENSE`.
