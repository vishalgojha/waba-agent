// src-ts/logger.ts
import fs from "fs-extra";
import path from "path";
import { logsPath } from "./config.js";

export type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG";

export interface LogEvent {
  ts: string;
  level: LogLevel;
  event: string;
  data?: Record<string, unknown>;
}

export async function appendLog(level: LogLevel, event: string, data?: Record<string, unknown>): Promise<void> {
  const item: LogEvent = {
    ts: new Date().toISOString(),
    level,
    event,
    data
  };
  const p = logsPath();
  try {
    await fs.ensureDir(path.dirname(p));
    await fs.appendFile(p, `${JSON.stringify(item)}\n`, "utf8");
  } catch (err) {
    const msg = String((err as Error).message || err);
    console.warn(`[WARN] log write skipped: ${msg}`);
  }
}

export function logConsole(level: LogLevel, msg: string): void {
  const prefix = `[${level}]`;
  if (level === "ERROR") console.error(`${prefix} ${msg}`);
  else if (level === "WARN") console.warn(`${prefix} ${msg}`);
  else console.log(`${prefix} ${msg}`);
}
