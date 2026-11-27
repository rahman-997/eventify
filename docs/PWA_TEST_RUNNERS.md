# Eventify test runner isolation

The Node-only service-worker tests are named `service-worker.node-test.mjs` so Vitest does not discover them. Run root `npm run verify` and `npm run verify` in `web/` independently. The additional PWA browser workflow uses a pinned Playwright version and a disposable localhost static build to verify cache isolation. No deployment or live data is involved.
