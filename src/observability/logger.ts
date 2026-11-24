import { config } from "../config.js";
import { getRequestId } from "./request-context.js";
import { sanitizeLogValue, redactLogText } from "./log-sanitizer.js";

type LogLevel = "debug" | "info" | "warn" | "error";
type LogFields = Record<string, unknown>;

export function createLogger(service: string) {
  function write(level: LogLevel, message: string, fields: LogFields = {}) {
    const payload = {
      ...(sanitizeLogValue(fields, config.NODE_ENV !== "production") as LogFields),
      timestamp: new Date().toISOString(),
      level,
      service,
      message: redactLogText(message),
      requestId: getRequestId(),
    };

    const line = JSON.stringify(payload);
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  }

  return {
    debug(message: string, fields?: LogFields) {
      if (config.NODE_ENV !== "production") write("debug", message, fields);
    },
    info(message: string, fields?: LogFields) {
      write("info", message, fields);
    },
    warn(message: string, fields?: LogFields) {
      write("warn", message, fields);
    },
    error(message: string, fields?: LogFields) {
      write("error", message, fields);
    },
  };
}

export const logger = createLogger("eventify-api");
export const workerLogger = createLogger("eventify-worker");
