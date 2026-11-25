import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { authRouter } from "./auth/auth.routes.js";
import { bookingsRouter } from "./bookings/bookings.routes.js";
import { config } from "./config.js";
import { databaseHealth } from "./db/health.js";
import { eventsRouter } from "./events/events.routes.js";
import { HttpError } from "./errors/http-error.js";
import { errorHandler } from "./middleware/error-handler.js";
import { requestObservability } from "./middleware/request-observability.js";
import { renderMetrics } from "./observability/metrics.js";
import { timedProbe } from "./observability/timed-probe.js";
import { redisHealth, workerHeartbeatHealth } from "./redis/client.js";

export const app = express();

app.disable("x-powered-by");
app.set("trust proxy", config.TRUST_PROXY_HOPS);
app.use(requestObservability);
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "same-site" },
  }),
);

const allowedOrigins = new Set(config.WEB_ORIGINS);
app.use(
  cors({
    credentials: true,
    maxAge: 86_400,
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) return callback(null, true);
      return callback(new HttpError(403, "Origin is not allowed"));
    },
  }),
);
app.use(express.json({ limit: "256kb", strict: true }));
app.use(cookieParser());

app.get("/", (_req, res) => {
  res.setHeader("cache-control", "no-store");
  res.json({
    service: "eventify-api",
    status: "ok",
    health: "/health",
    readiness: "/ready",
  });
});

app.get("/health", (_req, res) => {
  res.setHeader("cache-control", "no-store");
  res.json({ status: "ok", uptime: Math.round(process.uptime()) });
});

app.get("/ready", async (_req, res) => {
  res.setHeader("cache-control", "no-store");
  const [databaseCheck, redisCheck, workerCheck] = await Promise.all([
    timedProbe(databaseHealth),
    timedProbe(redisHealth),
    timedProbe(workerHeartbeatHealth),
  ]);
  const ready = databaseCheck.ok && redisCheck.ok;
  res.status(ready ? 200 : 503).json({
    status: ready ? "ready" : "degraded",
    database: databaseCheck.ok,
    redis: redisCheck.ok,
    worker: workerCheck.ok,
    checks: {
      database: databaseCheck,
      redis: redisCheck,
      backgroundWorker: workerCheck,
    },
  });
});

if (config.METRICS_ENABLED) {
  app.get("/metrics", (_req, res) => {
    res.setHeader("cache-control", "no-store");
    res.type("text/plain; version=0.0.4; charset=utf-8").send(renderMetrics());
  });
}

app.use("/v1/auth", (_req, res, next) => {
  res.setHeader("cache-control", "no-store");
  next();
}, authRouter);
app.use("/v1/events", eventsRouter);
app.use("/v1/bookings", bookingsRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "Route not found" });
});
app.use(errorHandler);
