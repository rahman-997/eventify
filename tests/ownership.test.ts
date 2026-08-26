import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";

const seedTestPassword = process.env.SEED_TEST_PASSWORD ?? "";
let organizer1Token = "";
let organizer2Token = "";

beforeAll(async () => {
  const [one, two] = await Promise.all([
    request(app).post("/v1/auth/login").send({ email: "organizer1@eventify.test", password: seedTestPassword }),
    request(app).post("/v1/auth/login").send({ email: "organizer2@eventify.test", password: seedTestPassword }),
  ]);
  organizer1Token = one.body.accessToken;
  organizer2Token = two.body.accessToken;
});

describe("event ownership", () => {
  it("returns 403 when one organizer edits another organizer's event", async () => {
    const eventId = "00000000-0000-4000-8000-000000000102";
    const response = await request(app)
      .patch(`/v1/events/${eventId}`)
      .set("authorization", `Bearer ${organizer1Token}`)
      .send({ title: "Not allowed" });

    expect(response.status).toBe(403);
  });

  it("allows the owning organizer", async () => {
    const eventId = "00000000-0000-4000-8000-000000000102";
    const response = await request(app)
      .patch(`/v1/events/${eventId}`)
      .set("authorization", `Bearer ${organizer2Token}`)
      .send({ title: "Owned update" });

    expect(response.status).toBe(200);
  });
});
