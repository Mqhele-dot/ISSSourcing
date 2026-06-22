import { redactValue } from "./redaction";
import { defaultLogVerbosity } from "./deployment-behavior";

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function minLevelAllows(level: LogLevel): boolean {
  const floor = defaultLogVerbosity();
  return LEVEL_RANK[level] >= LEVEL_RANK[floor];
}

function write(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(meta ? { meta: redactValue(meta) } : {}),
  };

  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
}

export const logger = {
  debug(message: string, meta?: Record<string, unknown>) {
    if (!minLevelAllows("debug")) return;
    write("debug", message, meta);
  },
  info(message: string, meta?: Record<string, unknown>) {
    if (!minLevelAllows("info")) return;
    write("info", message, meta);
  },
  warn(message: string, meta?: Record<string, unknown>) {
    if (!minLevelAllows("warn")) return;
    write("warn", message, meta);
  },
  error(message: string, meta?: Record<string, unknown>) {
    write("error", message, meta);
  },
};
