import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { redisHealth } from "../src/redis/client.js";

describe("production operational contract", () => {
  it("serves a lightweight root probe for platform routing checks", async () => {
    const response = await request(app).get("/").expect(200);
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.body).toEqual({
      service: "eventify-api",
      status: "ok",
      health: "/health",
      readiness: "/ready",
    });
  });

  it("returns liveness and echoes a safe request id", async () => {
    const response = await request(app)
      .get("/health")
      .set("x-request-id", "ops-contract-123")
      .expect(200);

    expect(response.headers["x-request-id"]).toBe("ops-contract-123");
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.body.status).toBe("ok");
    expect(response.body.uptime).toEqual(expect.any(Number));
  });

  it("reports database, Redis, and background worker readiness independently", async () => {
    // The Redis client has no offline queue, so a probe made before the connection is up fails.
    // Wait for the connection like a started service would, instead of racing it.
    for (let attempt = 0; attempt < 50 && !(await redisHealth()); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const response = await request(app).get("/ready").expect(200);
    expect(response.body.status).toBe("ready");
    expect(response.body.database).toBe(true);
    expect(response.body.redis).toBe(true);
    expect(response.body.checks.database.latencyMs).toEqual(expect.any(Number));
    expect(response.body.checks.redis.latencyMs).toEqual(expect.any(Number));
    expect(response.body.checks.backgroundWorker.ok).toEqual(expect.any(Boolean));
  });

  it("exposes low-cardinality Prometheus metrics", async () => {
    await request(app).get("/health").expect(200);
    const response = await request(app).get("/metrics").expect(200);
    expect(response.text).toContain("eventify_process_uptime_seconds");
    expect(response.text).toContain("eventify_http_requests_total");
    expect(response.text).toContain("eventify_cache_operations_total");
  });

  it("correlates not-found responses without leaking internals", async () => {
    const response = await request(app).get("/missing-route").expect(404);
    expect(response.body.error).toBe("Route not found");
    expect(response.headers["x-request-id"]).toMatch(/^[A-Za-z0-9._:-]+$/);
  });

  it("rejects browser origins outside the configured allowlist", async () => {
    const response = await request(app)
      .get("/health")
      .set("origin", "https://untrusted.example")
      .expect(403);
    expect(response.body.error).toBe("Origin is not allowed");
    expect(response.body.requestId).toEqual(expect.any(String));
  });
});
