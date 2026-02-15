const fs = require("fs-extra");
const path = require("path");

const { contextDir } = require("./paths");

function safeName(name) {
  return String(name || "default")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "default";
}

function clientDir(client) {
  return path.join(contextDir(), safeName(client));
}

function memoryPath(client) {
  return path.join(clientDir(client), "memory.jsonl");
}

async function appendMemory(client, event) {
  const dir = clientDir(client);
  await fs.ensureDir(dir);
  const p = memoryPath(client);
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n";
  await fs.appendFile(p, line, "utf8");
}

async function readMemory(client, { limit = 200 } = {}) {
  const p = memoryPath(client);
  if (!(await fs.pathExists(p))) return [];
  const text = await fs.readFile(p, "utf8");
  const lines = text.split("\n").filter(Boolean);
  const sliced = lines.slice(Math.max(0, lines.length - limit));
  const events = [];
  for (const l of sliced) {
    try {
      events.push(JSON.parse(l));
    } catch {}
  }
  return events;
}

async function listClients() {
  if (!(await fs.pathExists(contextDir()))) return [];
  const entries = await fs.readdir(contextDir(), { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

async function forgetClient(client) {
  const dir = clientDir(client);
  if (await fs.pathExists(dir)) {
    await fs.remove(dir);
    return true;
  }
  return false;
}

function summarizeForPrompt(events, { maxChars = 2000 } = {}) {
  // Deterministic, no-AI summary: last few key events.
  const last = events.slice(-25);
  const parts = [];
  for (const e of last) {
    if (e.type === "lead_classification") {
      parts.push(`Lead: ${JSON.stringify(e.result)}`);
    } else if (e.type === "outbound_sent") {
      parts.push(`Outbound: ${e.channel || "whatsapp"} ${e.to || ""} (${e.kind || ""})`);
    } else if (e.type === "note") {
      parts.push(`Note: ${e.text}`);
    } else if (e.type === "agent_run") {
      parts.push(`Agent: ${e.prompt}`);
    }
  }
  const joined = parts.join("\n");
  return joined.length > maxChars ? joined.slice(-maxChars) : joined;
}

module.exports = {
  safeName,
  clientDir,
  memoryPath,
  appendMemory,
  readMemory,
  listClients,
  forgetClient,
  summarizeForPrompt
};

