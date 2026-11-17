import { describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { errorHandler } from "../src/middleware/error-handler.js";
import { logger } from "../src/observability/logger.js";

describe("error logging privacy", () => {
  it("does not log query-string secrets on unexpected errors", () => {
    const spy = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const req = {
      method: "GET",
      path: "/v1/events",
      originalUrl: "/v1/events?access_token=private-secret",
    } as Request;
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const res = {
      getHeader: vi.fn(() => "request-1"),
      status,
    } as unknown as Response;
    try {
      errorHandler(new Error("Unexpected failure"), req, res, (() => {}) as NextFunction);
      expect(spy).toHaveBeenCalled();
      const fields = spy.mock.calls[0]?.[1] as { route?: string };
      expect(fields.route).toBe("/v1/events");
      expect(JSON.stringify(fields)).not.toContain("private-secret");
      expect(status).toHaveBeenCalledWith(500);
    } finally {
      spy.mockRestore();
    }
  });
});
