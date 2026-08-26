import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { config } from "../src/config.js";
import { hashPassword } from "../src/auth/password.js";
import { normalizePostgresConnectionString } from "../src/db/connection-url.js";

const adapter = new PrismaPg({ connectionString: normalizePostgresConnectionString(config.DATABASE_URL) });
const prisma = new PrismaClient({ adapter });

const ids = {
  organizer1: "00000000-0000-4000-8000-000000000001",
  attendee: "00000000-0000-4000-8000-000000000002",
  admin: "00000000-0000-4000-8000-000000000003",
  organizer2: "00000000-0000-4000-8000-000000000004",
  parallelEvent: "00000000-0000-4000-8000-000000000100",
};

function seededPassword(): string {
  if (process.env.NODE_ENV === "test") {
    const testPassword = process.env.SEED_TEST_PASSWORD;
    if (!testPassword) {
      throw new Error("SEED_TEST_PASSWORD is required when seeding test fixtures");
    }
    return testPassword;
  }

  // Non-test environments must never derive seeded credentials from public source.
  return randomBytes(32).toString("base64url");
}

async function upsertUser(id: string, email: string, name: string, role: "ATTENDEE" | "ORGANIZER" | "ADMIN") {
  const passwordHash = await hashPassword(seededPassword());
  return prisma.user.upsert({
    where: { email },
    update: { name, role, passwordHash },
    create: { id, email, name, role, passwordHash },
  });
}

async function main() {
  await upsertUser(ids.organizer1, "organizer1@eventify.test", "Organizer One", "ORGANIZER");
  await upsertUser(ids.organizer2, "organizer2@eventify.test", "Organizer Two", "ORGANIZER");
  await upsertUser(ids.attendee, "attendee@eventify.test", "Attendee One", "ATTENDEE");
  await upsertUser(ids.admin, "admin@eventify.test", "Admin One", "ADMIN");

  for (let i = 1; i <= 20; i += 1) {
    const suffix = i.toString().padStart(12, "0");
    await upsertUser(`00000000-0000-4001-8000-${suffix}`, `parallel${i}@eventify.test`, `Parallel User ${i}`, "ATTENDEE");
  }

  const events = [
    { id: ids.parallelEvent, title: "Parallel Capacity Five", capacity: 5, organizerId: ids.organizer1 },
    { id: "00000000-0000-4000-8000-000000000101", title: "TypeScript Days", capacity: 50, organizerId: ids.organizer1 },
    { id: "00000000-0000-4000-8000-000000000102", title: "Postgres Party", capacity: 100, organizerId: ids.organizer2 },
    { id: "00000000-0000-4000-8000-000000000103", title: "API World", capacity: 75, organizerId: ids.organizer1 },
    { id: "00000000-0000-4000-8000-000000000104", title: "Testing Guild", capacity: 20, organizerId: ids.organizer2 },
  ];

  for (const [index, event] of events.entries()) {
    await prisma.event.upsert({
      where: { id: event.id },
      update: { organizerId: event.organizerId },
      create: {
        id: event.id,
        title: event.title,
        description: `Seed event ${index + 1}`,
        venue: index % 2 === 0 ? "Main Hall" : "Riverside Loft",
        startsAt: new Date(Date.now() + (index + 1) * 86_400_000),
        capacity: event.capacity,
        priceCents: index * 1000,
        organizerId: event.organizerId,
      },
    });
  }

  await prisma.booking.deleteMany({ where: { eventId: ids.parallelEvent } });
  await prisma.booking.upsert({
    where: { userId_eventId: { userId: ids.attendee, eventId: events[1]!.id } },
    update: { status: "CONFIRMED" },
    create: { userId: ids.attendee, eventId: events[1]!.id, status: "CONFIRMED" },
  });
}

main().finally(async () => prisma.$disconnect());