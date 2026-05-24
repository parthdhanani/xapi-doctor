# Security policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | ✅        |
| < 0.1   | ❌        |

## Reporting a vulnerability

Email: **parth1707ster@gmail.com**

Include:

- xapi-doctor version
- A minimal statement or LRS configuration that reproduces the issue
- Your assessment of impact

I aim to acknowledge within 72 hours and to ship a fix within 14 days.

## Threat model

xapi-doctor reads user-supplied JSON statements locally and makes outbound
HTTP requests to LRS endpoints supplied on the command line.

Relevant threats:

- **ReDoS via crafted statement input** — regex rules should bound work on
  pathological inputs.
- **SSRF amplification** — `ping` and `send` accept URLs from the command
  line. Treat them as a developer tool, not a service to expose.
- **Credentials in process arguments** — `--auth user:pass` is visible in
  process listings on shared hosts. For production use, prefer running
  xapi-doctor in CI where the environment is short-lived and not shared.
