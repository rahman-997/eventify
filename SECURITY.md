# Security Policy

## Supported version

The current `main` branch is the supported version of Eventify. Older snapshots, experimental branches, and historical releases may not receive security fixes.

## Reporting a vulnerability

Please do **not** publish exploit details, credentials, tokens, or sensitive reproduction data in a public GitHub issue.

If you discover a security issue:

1. Contact the repository owner through the GitHub profile and request a private channel for the report.
2. Share the affected component, impact, reproduction steps, and the minimum evidence required to understand the issue.
3. Remove or redact real credentials, personal data, and third-party secrets from all evidence.
4. Allow time for triage and remediation before public disclosure.

A public issue is appropriate only for non-sensitive hardening suggestions that do not expose an exploitable vulnerability.

## Scope

Useful reports include issues involving authentication or session handling, authorization boundaries, injection, request validation, sensitive-data exposure, dependency vulnerabilities with a practical impact, rate-limit bypasses, queue/background-worker abuse, and production configuration that creates a concrete security risk.

Reports about intentionally public demo data, expected free-tier cold starts, or vulnerabilities that require already-compromised administrator access without increasing impact may be treated as out of scope.

## Security baseline

Eventify uses automated dependency checks and security scanning in CI, but automated tooling is not a substitute for responsible manual review. Security fixes should include a regression test or verification step whenever practical.
