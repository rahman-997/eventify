import { describe, expect, it, vi } from "vitest";

const { transactionMock } = vi.hoisted(() => ({
  transactionMock: vi.fn(),
}));

vi.mock("../src/db/prisma.js", () => ({
  prisma: {
    $transaction: transactionMock,
    refreshToken: {
      create: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

import { refresh } from "../src/auth/auth.service.js";

describe("refresh-token serialization retry", () => {
  it("retries a Prisma serialization conflict before evaluating the refresh result", async () => {
    transactionMock.mockReset();
    transactionMock
      .mockRejectedValueOnce({ code: "P2034" })
      .mockResolvedValueOnce({ ok: false });

    await expect(refresh("test-refresh-token")).rejects.toMatchObject({ status: 401 });
    expect(transactionMock).toHaveBeenCalledTimes(2);
  });
});
