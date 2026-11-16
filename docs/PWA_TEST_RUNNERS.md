# Eventify v1 — test runner isolation

The existing PWA service-worker cache regression is a Node built-in `node:test` suite. Its former filename (`web/scripts/service-worker.test.mjs`) matched Vitest's default recursive test discovery, despite the file registering no Vitest tests. This caused the API CI to fail after all API tests passed with `No test suite found in file`.

- Rename the Node-only test to `service-worker.node-test.mjs`, keeping its complete code and exact assertions.
- Update the **web** `test:pwa` script to point at the renamed file. The PWA check remains part of the web `verify` chain.
- Leave the root `vitest run` command, all API tests, PostgreSQL/Redis integration checks, dependency audits, and service worker cache behavior unchanged.
- This is a stacked review-only PR; the original service worker fix PR #60 remains unchanged.

Verify: `npm run verify` at repository root and `npm run verify` in `web/`, plus hosted CI. No deployment, cache flush, data or settings changes.
