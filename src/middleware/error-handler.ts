import type { ErrorRequestHandler } from "express";
import { HttpError } from "../errors/http-error.js";
import { logger } from "../observability/logger.js";
import { getRequestId } from "../observability/request-context.js";

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const requestId = getRequestId() ?? String(res.getHeader("x-request-id") ?? "");

  if (error instanceof HttpError) {
    if (error.status >= 500) {
      logger.error("http.error", { method: req.method, route: req.path, status: error.status, error });
    }
    res.status(error.status).json({ error: error.message, details: error.details, requestId });
    return;
  }

  if (error instanceof SyntaxError && "status" in error && error.status === 400) {
    res.status(400).json({ error: "Invalid JSON", requestId });
    return;
  }

  logger.error("http.unhandled_error", {
    method: req.method,
    route: req.path,
    error,
  });
  res.status(500).json({ error: "Internal server error", requestId });
};
