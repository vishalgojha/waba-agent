// src-ts/replay.ts
import fs from "fs-extra";
import path from "path";
import { replayPath } from "./config.js";
import type { ActionResult } from "./types.js";

export async function appendReplay(entry: ActionResult): Promise<void> {
  const p = replayPath();
  await fs.ensureDir(path.dirname(p));
  await fs.appendFile(p, `${JSON.stringify(entry)}\n`, "utf8");
}

export async function listReplay(limit = 100): Promise<ActionResult[]> {
  const p = replayPath();
  if (!(await fs.pathExists(p))) return [];
  const raw = await fs.readFile(p, "utf8");
  const rows = raw
    .split("\n")
    .map((line: string) => line.trim())
    .filter(Boolean)
    .map((line: string) => JSON.parse(line) as ActionResult);
  return rows.slice(-Math.max(1, limit)).reverse();
}

export async function getReplayById(id: string): Promise<ActionResult | null> {
  const rows = await listReplay(10_000);
  return rows.find((x) => x.id === id) || null;
}
