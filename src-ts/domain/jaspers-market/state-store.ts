// src-ts/domain/jaspers-market/state-store.ts
import fs from "fs-extra";
import path from "path";
import { wabaAgentHome } from "../../config.js";
import type { MarketSession } from "./types.js";

type SessionsMap = Record<string, MarketSession>;

function storePath(): string {
  return path.join(wabaAgentHome(), "domains", "jaspers-market", "sessions.json");
}

async function readAll(): Promise<SessionsMap> {
  const p = storePath();
  if (!(await fs.pathExists(p))) return {};
  const data = await fs.readJson(p);
  if (!data || typeof data !== "object") return {};
  return data as SessionsMap;
}

async function writeAll(next: SessionsMap): Promise<void> {
  const p = storePath();
  await fs.ensureDir(path.dirname(p));
  await fs.writeJson(p, next, { spaces: 2 });
}

export async function getMarketSession(phone: string): Promise<MarketSession | null> {
  const all = await readAll();
  return all[phone] || null;
}

export async function saveMarketSession(session: MarketSession): Promise<void> {
  const all = await readAll();
  all[session.phone] = session;
  await writeAll(all);
}
