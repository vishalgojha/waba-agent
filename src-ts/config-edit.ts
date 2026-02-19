// src-ts/config-edit.ts
import fs from "fs-extra";
import os from "os";
import path from "path";
import { configPath, readConfig } from "./config.js";

type JsonObject = Record<string, unknown>;

export function parseConfigValue(raw: unknown): unknown {
  const s = String(raw ?? "").trim();
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if ((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"))) {
    try {
      return JSON.parse(s);
    } catch {}
  }
  return raw;
}

function toPathArray(keyPath: string): string[] {
  return String(keyPath || "")
    .split(".")
    .map((x) => x.trim())
    .filter(Boolean);
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

async function readRawConfig(): Promise<JsonObject> {
  const primary = configPath();
  if (await fs.pathExists(primary)) return await fs.readJson(primary);
  const legacy = path.join(os.homedir(), ".waba-agent", "config.json");
  if (await fs.pathExists(legacy)) return await fs.readJson(legacy);
  return {};
}

async function writeRawConfig(next: JsonObject): Promise<string> {
  const p = configPath();
  await fs.ensureDir(path.dirname(p));
  await fs.writeJson(p, next, { spaces: 2 });
  return p;
}

function normalizeMultiClient(raw: JsonObject): JsonObject {
  const cfg: JsonObject = { ...(raw || {}) };
  const clients = cfg.clients && typeof cfg.clients === "object" ? ({ ...(cfg.clients as JsonObject) } as JsonObject) : {};
  cfg.clients = clients;
  if (!cfg.activeClient) cfg.activeClient = "default";
  const active = String(cfg.activeClient || "default");
  if (!(clients as JsonObject)[active]) (clients as JsonObject)[active] = {};
  return cfg;
}

function setByPath(target: JsonObject, keyPath: string, value: unknown): void {
  const parts = toPathArray(keyPath);
  if (!parts.length) throw new Error("Invalid key path.");
  let cur: JsonObject = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const k = parts[i];
    const existing = cur[k];
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
      cur[k] = {};
    }
    cur = cur[k] as JsonObject;
  }
  cur[parts[parts.length - 1]] = value;
}

function unsetByPath(target: JsonObject, keyPath: string): boolean {
  const parts = toPathArray(keyPath);
  if (!parts.length) throw new Error("Invalid key path.");
  let cur: JsonObject = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const next = cur?.[parts[i]];
    if (!next || typeof next !== "object") return false;
    cur = next as JsonObject;
  }
  const leaf = parts[parts.length - 1];
  if (!Object.prototype.hasOwnProperty.call(cur, leaf)) return false;
  delete cur[leaf];
  return true;
}

function redactConfigForDisplay(cfg: JsonObject): JsonObject {
  const out = JSON.parse(JSON.stringify(cfg || {})) as JsonObject;
  if (out.token) out.token = redactToken(String(out.token));
  if (out.clients && typeof out.clients === "object") {
    for (const [name, value] of Object.entries(out.clients as JsonObject)) {
      if (!value || typeof value !== "object") continue;
      const client = value as JsonObject;
      if (client.token) client.token = redactToken(String(client.token));
      (out.clients as JsonObject)[name] = client;
    }
  }
  return out;
}

export async function showConfig(): Promise<{ path: string; config: JsonObject }> {
  const raw = normalizeMultiClient(await readRawConfig());
  const effective = await readConfig();
  const merged: JsonObject = {
    ...raw,
    token: effective.token || raw.token || "",
    phoneNumberId: effective.phoneNumberId || raw.phoneNumberId || "",
    wabaId: effective.businessId || raw.wabaId || "",
    businessId: effective.businessId || raw.businessId || "",
    graphVersion: effective.graphVersion || raw.graphVersion || "v20.0",
    baseUrl: effective.baseUrl || raw.baseUrl || "https://graph.facebook.com",
    webhookVerifyToken: effective.webhookVerifyToken || raw.webhookVerifyToken || "",
    webhookUrl: effective.webhookUrl || raw.webhookUrl || ""
  };
  return { path: configPath(), config: redactConfigForDisplay(merged) };
}

export async function setConfigValue(
  key: string,
  rawValue: unknown,
  client?: string
): Promise<{ path: string; scopedKey: string }> {
  const raw = normalizeMultiClient(await readRawConfig());
  const parsed = parseConfigValue(rawValue);
  if (client) {
    const normalized = safeClientName(client);
    if (!normalized) throw new Error("Invalid client name.");
    if (!raw.clients || typeof raw.clients !== "object") raw.clients = {};
    const clients = raw.clients as JsonObject;
    if (!clients[normalized] || typeof clients[normalized] !== "object") clients[normalized] = {};
    setByPath(clients[normalized] as JsonObject, key, parsed);
    const p = await writeRawConfig(raw);
    return { path: p, scopedKey: `client ${normalized}.${key}` };
  }
  setByPath(raw, key, parsed);
  const p = await writeRawConfig(raw);
  return { path: p, scopedKey: key };
}

export async function unsetConfigValue(
  key: string,
  client?: string
): Promise<{ path: string; scopedKey: string; removed: boolean }> {
  const raw = normalizeMultiClient(await readRawConfig());
  let removed = false;
  if (client) {
    const normalized = safeClientName(client);
    if (!normalized) throw new Error("Invalid client name.");
    if (!raw.clients || typeof raw.clients !== "object") raw.clients = {};
    const clients = raw.clients as JsonObject;
    if (!clients[normalized] || typeof clients[normalized] !== "object") clients[normalized] = {};
    removed = unsetByPath(clients[normalized] as JsonObject, key);
    const p = await writeRawConfig(raw);
    return { path: p, scopedKey: `client ${normalized}.${key}`, removed };
  }
  removed = unsetByPath(raw, key);
  const p = await writeRawConfig(raw);
  return { path: p, scopedKey: key, removed };
}
