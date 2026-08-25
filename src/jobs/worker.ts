import http from "node:http";
import { Queue, Worker, type Job } from "bullmq";
import { z } from "zod";
import { invalidateEventCache } from "../cache/event-cache-invalidation.js";
import { config } from "../config.js";
import { databaseHealth } from "../db/health.js";
import { prisma } from "../db/prisma.js";
import { withSerializationRetry } from "../db/serialization.js";
import { workerLogger as logger } from "../observability/logger.js";
import { createQueueRedis, createWorkerRedis, writeWorkerHeartbeat } from "../redis/worker-client.js";
import { sendBookingConfirmation } from "./email.js";
import { dispatchOutbox, markOutboxFailed, markOutboxSent, purgeDeliveredOutbox } from "./outbox.js";
import { nextOutboxPollDelay } from "./polling.js";

const QUEUE_NAME = "eventify-background";
const producerConnection = createQueueRedis();
const workerConnection = createWorkerRedis();
const queue = new Queue(QUEUE_NAME, { connection: producerConnection });

const bookingConfirmationSchema = z.strictObject({ bookingId: z.uuid() });
const waitlistPromotionSchema = z.strictObject({ eventId: z.uuid() });

async function confirmBooking(job: Job): Promise<void> {
  const { bookingId } = bookingConfirmationSchema.parse(job.data);
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { user: true, event: true },
  });
  if (!booking || booking.status !== "CONFIRMED") return;
  await sendBookingConfirmation({
    bookingId: booking.id,
    email: booking.user.email,
    name: booking.user.name,
    title: booking.event.title,
    venue: booking.event.venue,
    startsAt: booking.event.startsAt,
  });
}

async function promoteWaitlist(job: Job): Promise<void> {
  const { eventId } = waitlistPromotionSchema.parse(job.data);
  const promoted = await withSerializationRetry(() =>
    prisma.$transaction(
      async (transactionClient) => {
        const tx = transactionClient as unknown as typeof prisma;
        const event = await tx.event.findUnique({ where: { id: eventId } });
        if (!event) return 0;
        const confirmed = await tx.booking.count({ where: { eventId, status: "CONFIRMED" } });
        const openSeats = Math.max(0, event.capacity - confirmed);
        if (openSeats === 0) return 0;

        const waiting = await tx.booking.findMany({
          where: { eventId, status: "WAITLISTED" },
          orderBy: { createdAt: "asc" },
          take: openSeats,
        });
        for (const booking of waiting) {
          const next = await tx.booking.update({ where: { id: booking.id }, data: { status: "CONFIRMED" } });
          await tx.notificationOutbox.create({
            data: { type: "BOOKING_CONFIRMATION", payload: { bookingId: next.id } },
          });
        }
        return waiting.length;
      },
      { isolationLevel: "Serializable" },
    ),
  );
  if (promoted > 0) {
    logger.info("worker.waitlist_promoted", { component: "worker", eventId, promoted });
    try {
      await invalidateEventCache(producerConnection, eventId);
    } catch (error) {
      logger.warn("cache.event_invalidation_failed", { component: "worker", eventId, error });
    }
  }
}

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    if (job.name === "BOOKING_CONFIRMATION") return confirmBooking(job);
    if (job.name === "WAITLIST_PROMOTION") return promoteWaitlist(job);
    throw new Error(`Unknown Eventify job type: ${job.name}`);
  },
  { connection: workerConnection, concurrency: 5 },
);

worker.on("completed", (job) => {
  logger.info("worker.job_completed", { component: "worker", jobId: job.id, name: job.name, attemptsMade: job.attemptsMade });
  if (job.id) void markOutboxSent(job.id).catch((error) => logger.error("outbox.mark_sent_failed", { component: "worker", error }));
});
worker.on("failed", (job, error) => {
  logger.error("worker.job_failed", {
    component: "worker",
    jobId: job?.id ?? "unknown",
    name: job?.name,
    attemptsMade: job?.attemptsMade,
    error,
  });
  const attempts = job?.opts.attempts ?? 1;
  if (job?.id && job.attemptsMade >= attempts) {
    void markOutboxFailed(job.id, error).catch((markError) => logger.error("outbox.mark_failed_failed", { component: "worker", error: markError }));
  }
});
worker.on("error", (error) => logger.error("worker.runtime_error", { component: "worker", error }));

let dispatching = false;
async function tick(): Promise<number | null> {
  if (dispatching) return null;
  dispatching = true;
  try {
    const dispatched = await dispatchOutbox(queue);
    if (dispatched > 0) logger.info("outbox.dispatched", { component: "worker", dispatched });
    return dispatched;
  } catch (error) {
    logger.error("outbox.dispatch_failed", { component: "worker", error });
    return null;
  } finally {
    dispatching = false;
  }
}

async function heartbeat() {
  try {
    await writeWorkerHeartbeat(workerConnection);
  } catch (error) {
    logger.warn("worker.heartbeat_failed", { component: "worker", error });
  }
}

async function maintenance() {
  try {
    const purged = await purgeDeliveredOutbox();
    if (purged > 0) logger.info("outbox.retention_purged", { component: "worker", purged });
  } catch (error) {
    logger.warn("outbox.retention_failed", { component: "worker", error });
  }
}

const [initialDispatched] = await Promise.all([tick(), heartbeat(), maintenance()]);
let currentPollMs = nextOutboxPollDelay({
  baseMs: config.OUTBOX_POLL_MS,
  maxIdleMs: config.OUTBOX_IDLE_MAX_POLL_MS,
  currentMs: config.OUTBOX_POLL_MS,
  dispatched: initialDispatched,
});
let pollTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleNextPoll() {
  pollTimer = setTimeout(async () => {
    const dispatched = await tick();
    currentPollMs = nextOutboxPollDelay({
      baseMs: config.OUTBOX_POLL_MS,
      maxIdleMs: config.OUTBOX_IDLE_MAX_POLL_MS,
      currentMs: currentPollMs,
      dispatched,
    });
    scheduleNextPoll();
  }, currentPollMs);
  pollTimer.unref();
}
scheduleNextPoll();

const heartbeatEveryMs = Math.max(5_000, Math.floor((config.WORKER_HEARTBEAT_TTL_SECONDS * 1_000) / 3));
const heartbeatTimer = setInterval(() => void heartbeat(), heartbeatEveryMs);
heartbeatTimer.unref();
const maintenanceTimer = setInterval(() => void maintenance(), 60 * 60 * 1_000);
maintenanceTimer.unref();

const port = Number(process.env.WORKER_PORT ?? process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";
const healthServer = http.createServer(async (req, res) => {
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-type", "application/json; charset=utf-8");

  if (req.url === "/ready") {
    const [database, redisReady] = await Promise.all([
      databaseHealth(),
      workerConnection.ping().then((value) => value === "PONG").catch(() => false),
    ]);
    const ready = database && redisReady;
    res.writeHead(ready ? 200 : 503);
    res.end(JSON.stringify({ status: ready ? "ready" : "degraded", database, redis: redisReady }));
    return;
  }

  if (req.url === "/metrics") {
    const counts = await queue.getJobCounts("waiting", "active", "delayed", "failed", "completed");
    res.setHeader("content-type", "text/plain; version=0.0.4; charset=utf-8");
    res.writeHead(200);
    res.end(
      [
        "# HELP eventify_worker_up Worker process status.",
        "# TYPE eventify_worker_up gauge",
        "eventify_worker_up 1",
        "# HELP eventify_worker_outbox_poll_interval_ms Current outbox poll interval in milliseconds.",
        "# TYPE eventify_worker_outbox_poll_interval_ms gauge",
        `eventify_worker_outbox_poll_interval_ms ${currentPollMs}`,
        ...Object.entries(counts).map(([state, count]) => `eventify_worker_jobs{state="${state}"} ${count}`),
        "",
      ].join("\n"),
    );
    return;
  }

  res.writeHead(200);
  res.end(JSON.stringify({ status: "ok", worker: QUEUE_NAME, uptime: Math.round(process.uptime()) }));
});
healthServer.listen(port, host, () => logger.info("worker.started", { component: "worker", host, port, queue: QUEUE_NAME }));

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  logger.info("worker.shutdown_started", { component: "worker", signal });
  if (pollTimer) clearTimeout(pollTimer);
  clearInterval(heartbeatTimer);
  clearInterval(maintenanceTimer);
  healthServer.close();

  const timeout = setTimeout(() => {
    logger.error("worker.shutdown_forced", { component: "worker", signal });
    process.exit(1);
  }, config.SHUTDOWN_GRACE_MS);
  timeout.unref();

  await worker.close();
  await queue.close();
  await Promise.allSettled([producerConnection.quit(), workerConnection.quit(), prisma.$disconnect()]);
  clearTimeout(timeout);
  logger.info("worker.shutdown_complete", { component: "worker", signal });
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => {
  logger.error("worker.unhandled_rejection", { component: "worker", reason });
  void shutdown("unhandledRejection");
});
process.on("uncaughtException", (error) => {
  logger.error("worker.uncaught_exception", { component: "worker", error });
  void shutdown("uncaughtException");
});
