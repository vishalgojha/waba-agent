// src-ts/config.ts
import fs from "fs-extra";
import os from "os";
import path from "path";
import type { AgentConfig } from "./types.js";

export function wabaAgentHome(): string {
  return process.env.WABA_AGENT_HOME || path.join(os.homedir(), ".waba-agent");
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

export async function readConfig(): Promise<AgentConfig> {
  const p = configPath();
  if (!(await fs.pathExists(p))) {
    return {
      token: "",
      businessId: "",
      phoneNumberId: "",
      graphVersion: "v20.0",
      baseUrl: "https://graph.facebook.com"
    };
  }
  const raw = await fs.readJson(p);
  return {
    token: String(raw?.token || ""),
    businessId: String(raw?.businessId || ""),
    phoneNumberId: String(raw?.phoneNumberId || ""),
    webhookVerifyToken: raw?.webhookVerifyToken ? String(raw.webhookVerifyToken) : undefined,
    webhookUrl: raw?.webhookUrl ? String(raw.webhookUrl) : undefined,
    testRecipient: raw?.testRecipient ? String(raw.testRecipient) : undefined,
    testTemplate: raw?.testTemplate ? String(raw.testTemplate) : undefined,
    graphVersion: String(raw?.graphVersion || "v20.0"),
    baseUrl: String(raw?.baseUrl || "https://graph.facebook.com")
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

