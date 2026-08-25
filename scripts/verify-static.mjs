import { spawnSync } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const env = {
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://eventify:eventify@localhost:5432/eventify",
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET ?? "static-verification-secret-at-least-32-characters",
  WEB_ORIGIN: process.env.WEB_ORIGIN ?? "http://localhost:5173",
};

const checks = [
  ["run", "prisma:generate"],
  ["run", "typecheck"],
  ["run", "arch"],
  ["run", "verify", "--prefix", "web"],
];

for (const args of checks) {
  const result = spawnSync(npmCommand, args, { env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
