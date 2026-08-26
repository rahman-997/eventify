import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";

const seedTestPassword = process.env.SEED_TEST_PASSWORD ?? "";
let attendeeToken = "";
let organizerToken = "";

beforeAll(async () => {
  const [attendee, organizer] = await Promise.all([
    request(app).post("/v1/auth/login").send({ email: "attendee@eventify.test", password: seedTestPassword }),
    request(app).post("/v1/auth/login").send({ email: "organizer1@eventify.test", password: seedTestPassword }),
  ]);
  attendeeToken = attendee.body.accessToken;
  organizerToken = organizer.body.accessToken;
});

describe("Eventify product experience APIs", () => {
  it("returns the authenticated user's real profile", async () => {
    const response = await request(app).get("/v1/auth/me").set("authorization", `Bearer ${attendeeToken}`);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ email: "attendee@eventify.test", role: "ATTENDEE" });
  });

  it("returns booking history with event details", async () => {
    const response = await request(app).get("/v1/bookings/mine").set("authorization", `Bearer ${attendeeToken}`);
    expect(response.status).toBe(200);
    expect(response.body.length).toBeGreaterThan(0);
    expect(response.body[0].event).toEqual(expect.objectContaining({ title: expect.any(String), venue: expect.any(String) }));
  });

  it("searches across event title, description, and venue", async () => {
    const response = await request(app).get("/v1/events").query({ q: "TypeScript", page: 1, limit: 20 });
    expect(response.status).toBe(200);
    expect(response.body.data.some((event: { title: string }) => event.title === "TypeScript Days")).toBe(true);
    expect(response.body.data[0]).toEqual(expect.objectContaining({ remainingSeats: expect.any(Number), soldOut: expect.any(Boolean) }));
  });

  it("returns organizer-owned events with live availability", async () => {
    const response = await request(app).get("/v1/events/mine").set("authorization", `Bearer ${organizerToken}`);
    expect(response.status).toBe(200);
    expect(response.body.length).toBeGreaterThan(0);
    expect(response.body.every((event: { organizerId: string }) => event.organizerId === "00000000-0000-4000-8000-000000000001")).toBe(true);
    expect(response.body[0]).toEqual(expect.objectContaining({ confirmedBookings: expect.any(Number), remainingSeats: expect.any(Number) }));
  });

  it("returns protected organizer analytics", async () => {
    const owned = await request(app)
      .get("/v1/events/00000000-0000-4000-8000-000000000101/stats")
      .set("authorization", `Bearer ${organizerToken}`);
    expect(owned.status).toBe(200);
    expect(owned.body).toEqual(expect.objectContaining({ confirmed: 1, grossRevenueCents: 1000, occupancyRate: expect.any(Number) }));

    const foreign = await request(app)
      .get("/v1/events/00000000-0000-4000-8000-000000000102/stats")
      .set("authorization", `Bearer ${organizerToken}`);
    expect(foreign.status).toBe(403);
  });
});
