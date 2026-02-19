// src-ts/config.ts
import fs from "fs-extra";
import os from "os";
import path from "path";
import type { AgentConfig } from "./types.js";

function envOr(current: string | undefined, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key];
    if (value !== undefined && value !== "") return value;
  }
  return current;
}

export function wabaAgentHome(): string {
  return process.env.WABA_AGENT_HOME || process.env.WABA_HOME || path.join(os.homedir(), ".waba-agent");
}

export function configPath(): string {
  return path.join(wabaAgentHome(), "config.json");
}

export function logsPath(): string {
  return path.join(wabaAgentHome(), "logs", "events.jsonl");
}

export function replayPath(): string {
  return path.join(wabaAgentHome(), "replay.jsonl");
}

function resolveLegacyBusinessId(raw: Record<string, unknown>): string {
  return String(raw?.businessId || raw?.wabaId || "");
}

function resolveLegacyPhoneId(raw: Record<string, unknown>): string {
  return String(raw?.phoneNumberId || raw?.phoneId || "");
}

function activeClientConfig(raw: Record<string, unknown>): Record<string, unknown> {
  const activeName = String(raw?.activeClient || "default");
  const clients = raw?.clients && typeof raw.clients === "object" ? (raw.clients as Record<string, unknown>) : {};
  const active = clients?.[activeName];
  return active && typeof active === "object" ? (active as Record<string, unknown>) : {};
}

async function readRawConfig(): Promise<Record<string, unknown>> {
  const primary = configPath();
  if (await fs.pathExists(primary)) return await fs.readJson(primary);

  // Backward compatibility with JS runtime default (~/.waba/config.json).
  const legacy = path.join(os.homedir(), ".waba", "config.json");
  if (await fs.pathExists(legacy)) return await fs.readJson(legacy);

  return {};
}

export async function readConfig(): Promise<AgentConfig> {
  const raw = await readRawConfig();
  const active = activeClientConfig(raw);

  const token = envOr(String(active?.token || raw?.token || ""), ["WABA_TOKEN", "WHATSAPP_TOKEN"]) || "";
  const businessId =
    envOr(resolveLegacyBusinessId(active), ["WABA_BUSINESS_ID", "WHATSAPP_BUSINESS_ID", "WABA_WABA_ID"]) ||
    envOr(resolveLegacyBusinessId(raw), ["WABA_BUSINESS_ID", "WHATSAPP_BUSINESS_ID", "WABA_WABA_ID"]) ||
    "";
  const phoneNumberId =
    envOr(resolveLegacyPhoneId(active), ["WABA_PHONE_ID", "WHATSAPP_PHONE_ID"]) ||
    envOr(resolveLegacyPhoneId(raw), ["WABA_PHONE_ID", "WHATSAPP_PHONE_ID"]) ||
    "";

  return {
    token,
    businessId,
    phoneNumberId,
    webhookVerifyToken: (envOr(String(raw?.webhookVerifyToken || ""), ["WABA_VERIFY_TOKEN", "WHATSAPP_VERIFY_TOKEN"]) || undefined),
    webhookUrl: String(raw?.webhookUrl || "") || undefined,
    testRecipient: String(raw?.testRecipient || "") || undefined,
    testTemplate: String(raw?.testTemplate || "") || undefined,
    graphVersion: envOr(String(raw?.graphVersion || "v20.0"), ["WABA_GRAPH_VERSION"]) || "v20.0",
    baseUrl: envOr(String(raw?.baseUrl || "https://graph.facebook.com"), ["WABA_BASE_URL"]) || "https://graph.facebook.com"
  };
}

export async function writeConfig(next: Partial<AgentConfig>): Promise<string> {
  const prev = await readConfig();
  const merged = { ...prev, ...next };
  const p = configPath();
  await fs.ensureDir(path.dirname(p));
  await fs.writeJson(p, merged, { spaces: 2 });
  return p;
}
