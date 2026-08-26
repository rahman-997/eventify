import { spawn } from "node:child_process";
import { migrationRetryDelay } from "./migration-backoff.mjs";

const MAX_MIGRATION_ATTEMPTS = Number(process.env.MIGRATION_MAX_ATTEMPTS ?? 6);
const RETRY_DELAY_MS = Number(process.env.MIGRATION_RETRY_DELAY_MS ?? 5000);
const RETRY_MAX_DELAY_MS = Number(process.env.MIGRATION_RETRY_MAX_DELAY_MS ?? 30000);
const RETRY_JITTER_RATIO = Number(process.env.MIGRATION_RETRY_JITTER_RATIO ?? 0.2);
const PRISMA_CLI = "node_modules/prisma/build/index.js";

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env: process.env,
      shell: false,
    });
    child.on("exit", (code, signal) => resolve({ code, signal }));
    child.on("error", () => resolve({ code: 1, signal: null }));
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let migrated = false;
for (let attempt = 1; attempt <= MAX_MIGRATION_ATTEMPTS; attempt += 1) {
  console.log(`[startup] Applying Prisma migrations (attempt ${attempt}/${MAX_MIGRATION_ATTEMPTS})`);
  const result = await run(process.execPath, [PRISMA_CLI, "migrate", "deploy"]);
  if (result.code === 0) {
    migrated = true;
    break;
  }

  if (attempt < MAX_MIGRATION_ATTEMPTS) {
    const retryDelayMs = migrationRetryDelay({
      attempt,
      baseDelayMs: RETRY_DELAY_MS,
      maxDelayMs: RETRY_MAX_DELAY_MS,
      jitterRatio: RETRY_JITTER_RATIO,
    });
    console.warn(`[startup] Migration attempt failed; retrying in ${retryDelayMs}ms`);
    await sleep(retryDelayMs);
  }
}

if (!migrated) {
  console.error("[startup] Prisma migrations failed after all retry attempts");
  process.exit(1);
}

const shouldSeedDemoData = ["1", "true", "yes"].includes(
  String(process.env.SEED_DEMO_DATA_ON_START ?? "").toLowerCase(),
);

if (shouldSeedDemoData) {
  console.log("[startup] SEED_DEMO_DATA_ON_START enabled; applying idempotent demo seed");
  const seedResult = await run(process.execPath, [PRISMA_CLI, "db", "seed"]);
  if (seedResult.code !== 0) {
    console.error("[startup] Demo seed failed; refusing to start with a partially prepared demo dataset");
    process.exit(seedResult.code ?? 1);
  }
  console.log("[startup] Demo seed completed successfully");
}

console.log("[startup] Migrations ready; starting Eventify API");
const children = [];
let shuttingDown = false;

function startProcess(name, args, env = process.env) {
  const child = spawn(process.execPath, args, {
    stdio: "inherit",
    env,
    shell: false,
  });
  children.push({ name, child });
  return child;
}

startProcess("api", ["dist/server.js"]);

if (["1", "true", "yes"].includes(String(process.env.RUN_WORKER_IN_WEB_SERVICE ?? "").toLowerCase())) {
  console.log("[startup] Free-hosting mode enabled; starting the BullMQ worker beside the API");
  startProcess("worker", ["dist/jobs/worker.js"], {
    ...process.env,
    WORKER_PORT: process.env.WORKER_PORT ?? "3001",
  });
}

function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[startup] ${signal} received; stopping ${children.length} process(es)`);
  for (const { child } of children) child.kill("SIGTERM");
  const timer = setTimeout(() => process.exit(exitCode || 1), 10_000);
  timer.unref();
}

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => shutdown(signal));
}

for (const { name, child } of children) {
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    console.error(`[startup] ${name} exited unexpectedly: code=${code ?? "null"} signal=${signal ?? "none"}`);
    shutdown(`${name}_EXIT`, code ?? 1);
    process.exitCode = code ?? 1;
  });
}
