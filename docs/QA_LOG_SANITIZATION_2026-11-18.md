# Eventify structured log sanitization — QA (2026-11-18)
Base: Draft PR #64, fix/error-log-query-privacy-20261118.
Work branch: fix/eventify-sensitive-structured-logs-20261118.

## Correctness/security changes
- Extracted dependency-free structured log sanitizer with case-insensitive and punctuation-normalized secret field names (e.g. Authorization, X-API-KEY, refresh_token).
- Redacts credentials embedded in Error messages/stack text (Bearer/Basic and common query credential keys).
- Does not remove safe request identifiers, duration, route or status metadata.
- Retains omission of error stacks in production.
- Adds six built-in Node test cases and wires them into the existing verification pipeline.

## Verification
- Node 22 local isolated \`node --experimental-strip-types --test\`: 6/6 tests passed for sanitizer behavior before pushing.
- Local isolated \`tsc --strict --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext\` passed.
- **Not done:** full Eventify integration tests with Postgres/Redis, npm ci, runtime audit, browser build and complete CI on the branch. An existing unpatched picomatch advisory still blocks clean full-tree dependency audits.
- No payments, production changes or merge.

## Existing security audit context
GitHub Actions on dependency-maintenance PRs show an npm audit failure involving picomatch. A verified fixed version was not available at the time of this patch. Do not disable the audit; investigate only a supported upstream patch once published.
