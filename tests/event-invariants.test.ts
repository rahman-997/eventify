import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBooking } from "../src/bookings/bookings.service.js";
import { prisma } from "../src/db/prisma.js";
import { updateEvent } from "../src/events/events.service.js";
import { app } from "../src/app.js";

const eventId = "00000000-0000-4000-8000-000000000901";
const concurrencyEventId = "00000000-0000-4000-8000-000000000902";
const organizerId = "00000000-0000-4000-8000-000000000001";
const attendeeId = "00000000-0000-4000-8000-000000000002";
const secondAttendeeId = "00000000-0000-4001-8000-000000000001";
const seedTestPassword = process.env.SEED_TEST_PASSWORD ?? "";
let organizerToken = "";

beforeAll(async () => {
  const login = await request(app)
    .post("/v1/auth/login")
    .send({ email: "organizer1@eventify.test", password: seedTestPassword });
  organizerToken = login.body.accessToken;

  await prisma.booking.deleteMany({ where: { eventId: { in: [eventId, concurrencyEventId] } } });
  await prisma.event.deleteMany({ where: { id: { in: [eventId, concurrencyEventId] } } });
  await prisma.event.create({
    data: {
      id: eventId,
      title: "Invariant Test Event",
      description: "Protect production event rules",
      venue: "Invariant Hall",
      startsAt: new Date(Date.now() + 86_400_000),
      capacity: 4,
      priceCents: 1000,
      organizerId,
    },
  });
  await prisma.booking.createMany({
    data: [
      { userId: attendeeId, eventId, status: "CONFIRMED" },
      { userId: secondAttendeeId, eventId, status: "CONFIRMED" },
    ],
  });
});

afterAll(async () => {
  await prisma.booking.deleteMany({ where: { eventId: { in: [eventId, concurrencyEventId] } } });
  await prisma.event.deleteMany({ where: { id: { in: [eventId, concurrencyEventId] } } });
});

describe("event lifecycle invariants", () => {
  it("rejects reducing capacity below confirmed bookings", async () => {
    const response = await request(app)
      .patch(`/v1/events/${eventId}`)
      .set("authorization", `Bearer ${organizerToken}`)
      .send({ capacity: 1 });

    expect(response.status).toBe(409);
    expect(response.body.error).toContain("confirmed bookings");
  });

  it("keeps confirmed bookings within capacity during a concurrent capacity reduction", async () => {
    await prisma.event.create({
      data: {
        id: concurrencyEventId,
        title: "Concurrent Capacity Event",
        description: "Exercise booking and capacity serialization",
        venue: "Invariant Hall",
        startsAt: new Date(Date.now() + 86_400_000),
        capacity: 2,
        priceCents: 1000,
        organizerId,
      },
    });
    await prisma.booking.create({
      data: { userId: attendeeId, eventId: concurrencyEventId, status: "CONFIRMED" },
    });

    await Promise.allSettled([
      updateEvent(concurrencyEventId, { capacity: 1 }, { sub: organizerId, role: "ORGANIZER" }),
      createBooking({ sub: secondAttendeeId, role: "ATTENDEE" }, concurrencyEventId),
    ]);

    const [event, confirmed] = await Promise.all([
      prisma.event.findUniqueOrThrow({ where: { id: concurrencyEventId } }),
      prisma.booking.count({ where: { eventId: concurrencyEventId, status: "CONFIRMED" } }),
    ]);
    expect(confirmed).toBeLessThanOrEqual(event.capacity);
  });

  it("refuses destructive deletion while active bookings exist", async () => {
    const response = await request(app)
      .delete(`/v1/events/${eventId}`)
      .set("authorization", `Bearer ${organizerToken}`);

    expect(response.status).toBe(409);
    expect(response.body.error).toContain("cannot be deleted");
  });

  it("rejects creating events in the past", async () => {
    const response = await request(app)
      .post("/v1/events")
      .set("authorization", `Bearer ${organizerToken}`)
      .send({
        title: "Past Event",
        description: "This should never be accepted",
        venue: "Old Hall",
        startsAt: new Date(Date.now() - 60_000).toISOString(),
        capacity: 10,
        priceCents: 0,
      });

    expect(response.status).toBe(409);
    expect(response.body.error).toContain("future");
  });
});
