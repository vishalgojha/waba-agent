// src-ts/clients.ts
import fs from "fs-extra";
import os from "os";
import path from "path";
import { configPath } from "./config.js";

export interface ClientCreds {
  token?: string;
  phoneNumberId?: string;
  wabaId?: string;
}

export interface ClientRecord {
  name: string;
  phoneNumberId: string | null;
  wabaId: string | null;
  token: string | null;
}

export interface ClientsListResult {
  activeClient: string;
  clients: ClientRecord[];
}

interface MultiClientConfig {
  activeClient: string;
  clients: Record<string, ClientCreds>;
  [key: string]: unknown;
}

function redactToken(token: string): string {
  const raw = String(token || "");
  if (!raw) return "";
  if (raw.length <= 8) return "****";
  return `${raw.slice(0, 4)}...${raw.slice(-4)}`;
}

function safeClientName(name: string): string {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function readRawConfig(): Promise<Record<string, unknown>> {
  const primary = configPath();
  if (await fs.pathExists(primary)) return await fs.readJson(primary);

  // Backward compatibility with older home path.
  const legacy = path.join(os.homedir(), ".waba-agent", "config.json");
  if (await fs.pathExists(legacy)) return await fs.readJson(legacy);

  return {};
}

async function writeRawConfig(next: Record<string, unknown>): Promise<string> {
  const p = configPath();
  await fs.ensureDir(path.dirname(p));
  await fs.writeJson(p, next, { spaces: 2 });
  return p;
}

function normalizeMultiClient(raw: Record<string, unknown>): MultiClientConfig {
  const cfg: MultiClientConfig = {
    ...(raw || {}),
    activeClient: String(raw?.activeClient || "default"),
    clients: {}
  };

  const rawClients = raw?.clients && typeof raw.clients === "object" ? (raw.clients as Record<string, unknown>) : {};
  for (const [name, value] of Object.entries(rawClients)) {
    if (!value || typeof value !== "object") continue;
    const entry = value as Record<string, unknown>;
    cfg.clients[name] = {
      token: entry.token ? String(entry.token) : undefined,
      phoneNumberId: entry.phoneNumberId ? String(entry.phoneNumberId) : undefined,
      wabaId: entry.wabaId ? String(entry.wabaId) : undefined
    };
  }

  const hasLegacy = !!(raw?.token || raw?.phoneNumberId || raw?.wabaId || raw?.businessId);
  if (hasLegacy && !cfg.clients.default) {
    cfg.clients.default = {
      token: raw?.token ? String(raw.token) : undefined,
      phoneNumberId: raw?.phoneNumberId ? String(raw.phoneNumberId) : undefined,
      wabaId: raw?.wabaId ? String(raw.wabaId) : raw?.businessId ? String(raw.businessId) : undefined
    };
  }

  if (!cfg.clients[cfg.activeClient]) cfg.clients[cfg.activeClient] = {};
  return cfg;
}

function syncLegacyTopLevel(cfg: MultiClientConfig): void {
  const active = cfg.clients[cfg.activeClient] || {};
  cfg.token = active.token || "";
  cfg.phoneNumberId = active.phoneNumberId || "";
  cfg.wabaId = active.wabaId || "";
  cfg.businessId = active.wabaId || "";
}

export async function listClients(): Promise<ClientsListResult> {
  const cfg = normalizeMultiClient(await readRawConfig());
  const names = Object.keys(cfg.clients || {}).sort();
  return {
    activeClient: cfg.activeClient || "default",
    clients: names.map((name) => {
      const c = cfg.clients[name] || {};
      return {
        name,
        phoneNumberId: c.phoneNumberId || null,
        wabaId: c.wabaId || null,
        token: c.token ? redactToken(c.token) : null
      };
    })
  };
}

export async function addOrUpdateClient(
  name: string,
  creds: ClientCreds,
  { makeActive = false }: { makeActive?: boolean } = {}
): Promise<{ path: string; name: string; activeClient: string }> {
  const normalized = safeClientName(name);
  if (!normalized) throw new Error("Invalid client name.");

  const cfg = normalizeMultiClient(await readRawConfig());
  cfg.clients[normalized] = {
    ...(cfg.clients[normalized] || {}),
    ...(creds || {})
  };
  if (makeActive) cfg.activeClient = normalized;
  syncLegacyTopLevel(cfg);
  const p = await writeRawConfig(cfg as unknown as Record<string, unknown>);
  return { path: p, name: normalized, activeClient: cfg.activeClient };
}

export async function switchClient(name: string): Promise<{ path: string; activeClient: string }> {
  const normalized = safeClientName(name);
  const cfg = normalizeMultiClient(await readRawConfig());
  if (!cfg.clients[normalized]) throw new Error(`Client not found: ${normalized}`);
  cfg.activeClient = normalized;
  syncLegacyTopLevel(cfg);
  const p = await writeRawConfig(cfg as unknown as Record<string, unknown>);
  return { path: p, activeClient: normalized };
}

export async function removeClient(
  name: string
): Promise<{ removed: boolean; path?: string; activeClient?: string }> {
  const normalized = safeClientName(name);
  const cfg = normalizeMultiClient(await readRawConfig());
  if (!cfg.clients[normalized]) return { removed: false };
  delete cfg.clients[normalized];
  if (cfg.activeClient === normalized) cfg.activeClient = Object.keys(cfg.clients)[0] || "default";
  if (!cfg.clients[cfg.activeClient]) cfg.clients[cfg.activeClient] = {};
  syncLegacyTopLevel(cfg);
  const p = await writeRawConfig(cfg as unknown as Record<string, unknown>);
  return { removed: true, path: p, activeClient: cfg.activeClient };
}
