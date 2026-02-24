// @ts-nocheck
const fs = require("fs-extra");
const path = require("path");

const { wabaHome } = require("./paths");
const { safeName } = require("./memory");

function stateDir() {
  return path.join(wabaHome(), "state");
}

function statePath(client) {
  return path.join(stateDir(), `${safeName(client || "default")}.json`);
}

async function readState(client) {
  const p = statePath(client);
  if (!(await fs.pathExists(p))) return {};
  try {
    const data = await fs.readJson(p);
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

async function writeState(client, state) {
  await fs.ensureDir(stateDir());
  const p = statePath(client);
  await fs.writeJson(p, state, { spaces: 2 });
  try {
    await fs.chmod(p, 0o600);
  } catch {}
  return p;
}

function normalizeNumber(x) {
  const t = String(x || "").trim().replace(/^\+/, "");
  return t.replace(/[^0-9]/g, "");
}

async function getConversation(client, from) {
  const s = await readState(client);
  return s[normalizeNumber(from)] || null;
}

async function setConversation(client, from, convo) {
  const s = await readState(client);
  s[normalizeNumber(from)] = convo;
  await writeState(client, s);
}

async function clearConversation(client, from) {
  const s = await readState(client);
  delete s[normalizeNumber(from)];
  await writeState(client, s);
}

module.exports = {
  stateDir,
  statePath,
  normalizeNumber,
  readState,
  writeState,
  getConversation,
  setConversation,
  clearConversation
};

