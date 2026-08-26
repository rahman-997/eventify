import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { hashRefreshToken } from "../src/auth/tokens.js";
import { prisma } from "../src/db/prisma.js";
import { redis } from "../src/redis/client.js";

const seedTestPassword = process.env.SEED_TEST_PASSWORD ?? "";
let organizerToken = "";

beforeAll(async () => {
  if (!seedTestPassword) {
    throw new Error("SEED_TEST_PASSWORD is required for seeded integration fixtures");
  }

  const organizer = await request(app).post("/v1/auth/login").send({
    email: "organizer1@eventify.test",
    password: seedTestPassword,
  });
  expect(organizer.status).toBe(200);
  organizerToken = organizer.body.accessToken;
});

function cookiePair(response: request.Response): string {
  const header = response.headers["set-cookie"];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) throw new Error("Expected refresh cookie");
  return value.split(";")[0]!;
}

describe("Sessions 4–5 production behaviors", () => {
  it("rejects role smuggling and stores new passwords as Argon2id", async () => {
    const smuggled = await request(app).post("/v1/auth/signup").send({
      email: `smuggle-${Date.now()}@eventify.test`,
      password: "Password123!",
      name: "Smuggled Role",
      role: "ORGANIZER",
    });
    expect(smuggled.status).toBe(400);

    const email = `argon-${Date.now()}@eventify.test`;
    const created = await request(app).post("/v1/auth/signup").send({ email, password: "Password123!", name: "Argon User" });
    expect(created.status).toBe(201);
    expect(created.body.user.role).toBe("ATTENDEE");
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.passwordHash.startsWith("$argon2id$")).toBe(true);
  });

  it("revokes the replacement chain when a rotated refresh token is replayed", async () => {
    const signup = await request(app).post("/v1/auth/signup").send({
      email: `rotation-${Date.now()}@eventify.test`,
      password: "Password123!",
      name: "Rotation User",
    });
    const originalCookie = cookiePair(signup);
    const raw = originalCookie.slice("refresh_token=".length);

    const rotated = await request(app).post("/v1/auth/refresh").set("Cookie", originalCookie).send({});
    expect(rotated.status).toBe(200);

    const replay = await request(app).post("/v1/auth/refresh").set("Cookie", originalCookie).send({});
    expect(replay.status).toBe(401);

    const original = await prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: hashRefreshToken(raw) } });
    expect(original.replacedById).toBeTruthy();
    const replacement = await prisma.refreshToken.findUniqueOrThrow({ where: { id: original.replacedById! } });
    expect(replacement.revokedAt).not.toBeNull();
  });

  it("caches event details with TTL and invalidates the cache on write", async () => {
    const create = await request(app)
      .post("/v1/events")
      .set("authorization", `Bearer ${organizerToken}`)
      .send({
        title: "Cache Test Event",
        description: "Before invalidation",
        venue: "Cache Lab",
        startsAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        capacity: 10,
        priceCents: 0,
      });
    expect(create.status).toBe(201);
    const id = create.body.id as string;

    const first = await request(app).get(`/v1/events/${id}`);
    expect(first.status).toBe(200);
    expect(await redis.ttl(`eventify:cache:event:${id}`)).toBeGreaterThan(0);

    const update = await request(app)
      .patch(`/v1/events/${id}`)
      .set("authorization", `Bearer ${organizerToken}`)
      .send({ title: "Cache Test Event Updated" });
    expect(update.status).toBe(200);

    const second = await request(app).get(`/v1/events/${id}`);
    expect(second.body.title).toBe("Cache Test Event Updated");
  });

  it("never oversells a capacity-five event and waitlists overflow", async () => {
    const eventId = "00000000-0000-4000-8000-000000000100";
    const logins = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        request(app)
          .post("/v1/auth/login")
          .send({ email: `parallel${index + 1}@eventify.test`, password: seedTestPassword }),
      ),
    );
    expect(logins.every((login) => login.status === 200)).toBe(true);

    const responses = await Promise.all(
      logins.map((login) =>
        request(app).post("/v1/bookings").set("authorization", `Bearer ${login.body.accessToken}`).send({ eventId }),
      ),
    );
    expect(responses.every((response) => response.status === 201)).toBe(true);
    const states = responses.map((response) => response.body.status);
    expect(states.filter((status) => status === "CONFIRMED")).toHaveLength(5);
    expect(states.filter((status) => status === "WAITLISTED")).toHaveLength(1);

    const confirmedOutbox = await prisma.notificationOutbox.count({ where: { type: "BOOKING_CONFIRMATION" } });
    expect(confirmedOutbox).toBeGreaterThanOrEqual(5);
  });
});
