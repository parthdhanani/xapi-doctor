# Contributing to xapi-doctor

xapi-doctor is small and opinionated. New code should solve a real diagnostic
problem that the existing rules don't already address.

## What's in scope

- New `lint` rules that catch a specific class of LRS-rejection or
  cmi5/xAPI-spec violation.
- New profiles (e.g. `--profile aicc-cmi5-strict`, `--profile xapi-2.0`).
- New `ping` checks for LRS-side conformance gaps that recur in the wild.
- Plain-English explanations for additional non-2xx LRS responses in `send`.
- Bug fixes with a reproducing test case.

## What's out of scope

- New runtime dependencies. Zero-dep is intentional so this is a drop-in CI
  step.
- A statement generator / authoring helper. That's a separate tool.
- A built-in LRS. Run a real one (Veracity, Yet, Learning Locker) for
  development.

## How to propose a change

1. Open an issue first for anything larger than a one-line fix.
2. Fork, branch, submit a PR against `main`.
3. Every new rule needs at least one test in `test/run.js` and a fixture
   under `fixtures/`.
4. The CI matrix (Node 18 / 20 / 22) must stay green.

## Running tests

```bash
npm test
```

No `npm install` required — zero runtime deps.

## Code style

- Plain CommonJS, two-space indent, semicolons, `var` for locals.
- One file per subcommand under `src/`.
- HTTP tests spawn the CLI asynchronously and use a local mock LRS (see
  `test/run.js` — `runAsync` and `startMockLrs`).

## Reporting security issues

See [SECURITY.md](SECURITY.md).

## License

MIT. By contributing you agree your changes are released under the same license.
