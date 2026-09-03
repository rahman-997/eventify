import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../src/app.js";

const seedTestPassword = process.env.SEED_TEST_PASSWORD ?? "";

describe("refresh cookie transport policy", () => {
  it("keeps HttpOnly and SameSite protections without forcing Secure on HTTP test/local development", async () => {
    if (!seedTestPassword) throw new Error("SEED_TEST_PASSWORD is required for seeded integration fixtures");

    const response = await request(app).post("/v1/auth/login").send({
      email: "organizer1@eventify.test",
      password: seedTestPassword,
    });

    expect(response.status).toBe(200);
    const header = response.headers["set-cookie"];
    const cookie = Array.isArray(header) ? header[0] : header;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).not.toContain("Secure");
  });
});
