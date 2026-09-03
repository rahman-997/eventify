import { prisma } from "../db/prisma.js";
import { withSerializationRetry } from "../db/serialization.js";
import { HttpError } from "../errors/http-error.js";
import { authRepository } from "./auth.repository.js";
import { clearLoginFailures, assertLoginAllowed, recordLoginFailure } from "./login-throttle.js";
import { getDummyPasswordHash, hashPassword, needsPasswordRehash, verifyPassword } from "./password.js";
import { createRefreshToken, hashRefreshToken, signAccessToken, type AuthUser } from "./tokens.js";

const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type PublicUser = {
  id: string;
  email: string;
  name: string;
  role: "ATTENDEE" | "ORGANIZER" | "ADMIN";
  createdAt: Date;
};

function toPublicUser(user: { id: string; email: string; name: string; role: PublicUser["role"]; createdAt: Date }): PublicUser {
  return { id: user.id, email: user.email, name: user.name, role: user.role, createdAt: user.createdAt };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002";
}

async function issuePair(user: { id: string; role: PublicUser["role"] }) {
  const accessToken = await signAccessToken({ sub: user.id, role: user.role });
  const refresh = createRefreshToken();
  await prisma.refreshToken.create({
    data: {
      tokenHash: refresh.hash,
      userId: user.id,
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    },
  });
  return { accessToken, refreshToken: refresh.raw };
}

export async function signup(input: { email: string; password: string; name: string }) {
  try {
    const passwordHash = await hashPassword(input.password);
    const user = await authRepository.createUser({
      email: input.email.toLowerCase(),
      passwordHash,
      name: input.name,
    });
    const pair = await issuePair(user);
    return { user: toPublicUser(user), ...pair };
  } catch (error) {
    if (isUniqueViolation(error)) throw new HttpError(409, "Account already exists");
    throw error;
  }
}

export async function login(input: { email: string; password: string }) {
  const email = input.email.toLowerCase();
  await assertLoginAllowed(email);

  const user = await authRepository.findUserByEmail(email);
  const passwordHash = user?.passwordHash ?? (await getDummyPasswordHash());
  const valid = await verifyPassword(input.password, passwordHash);
  if (!user || !valid) {
    await recordLoginFailure(email);
    throw new HttpError(401, "Invalid email or password");
  }

  await clearLoginFailures(email);
  if (needsPasswordRehash(user.passwordHash)) {
    await authRepository.updatePasswordHash(user.id, await hashPassword(input.password));
  }

  const pair = await issuePair(user);
  return { user: toPublicUser(user), ...pair };
}

async function revokeReplacementChain(tx: typeof prisma, replacedById: string | null): Promise<void> {
  const ids: string[] = [];
  let nextId = replacedById;
  for (let depth = 0; nextId && depth < 100; depth += 1) {
    const token = await tx.refreshToken.findUnique({
      where: { id: nextId },
      select: { id: true, replacedById: true },
    });
    if (!token) break;
    ids.push(token.id);
    nextId = token.replacedById;
  }
  if (ids.length > 0) {
    await tx.refreshToken.updateMany({
      where: { id: { in: ids }, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

export async function refresh(rawToken: string | undefined) {
  if (!rawToken) throw new HttpError(401, "Invalid refresh token");
  const oldHash = hashRefreshToken(rawToken);
  const next = createRefreshToken();

  const result = await withSerializationRetry(() =>
    prisma.$transaction(
      async (transactionClient) => {
        const tx = transactionClient as unknown as typeof prisma;
        const current = await tx.refreshToken.findUnique({
          where: { tokenHash: oldHash },
          include: { user: true },
        });
        if (!current || current.expiresAt <= new Date()) return { ok: false as const };

        if (current.revokedAt) {
          await revokeReplacementChain(tx, current.replacedById);
          return { ok: false as const };
        }

        const replacement = await tx.refreshToken.create({
          data: {
            tokenHash: next.hash,
            userId: current.userId,
            expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
          },
        });

        await tx.refreshToken.update({
          where: { id: current.id },
          data: { revokedAt: new Date(), replacedById: replacement.id },
        });

        return { ok: true as const, user: current.user };
      },
      { isolationLevel: "Serializable" },
    ),
  );

  if (!result.ok) throw new HttpError(401, "Invalid refresh token");
  return {
    accessToken: await signAccessToken({ sub: result.user.id, role: result.user.role }),
    refreshToken: next.raw,
  };
}

export async function getMe(actor: AuthUser) {
  const user = await authRepository.findUserById(actor.sub);
  if (!user) throw new HttpError(401, "Account no longer exists");
  return toPublicUser(user);
}

export async function logout(rawToken: string | undefined) {
  if (!rawToken) return;
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashRefreshToken(rawToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
