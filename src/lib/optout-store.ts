// @ts-nocheck
const fs = require("fs-extra");
const path = require("path");

const { optoutDir } = require("./paths");
const { safeName } = require("./memory");

function normalizeWaNumber(x) {
  // Store as digits-only E.164 without '+'.
  const t = String(x || "").trim().replace(/^\+/, "");
  const digits = t.replace(/[^0-9]/g, "");
  return digits;
}

function optoutPath(client) {
  return path.join(optoutDir(), `${safeName(client || "default")}.json`);
}

async function readOptouts(client) {
  const p = optoutPath(client);
  if (!(await fs.pathExists(p))) return [];
  const data = await fs.readJson(p);
  return Array.isArray(data) ? data : [];
}

async function writeOptouts(client, list) {
  await fs.ensureDir(optoutDir());
  const p = optoutPath(client);
  await fs.writeJson(p, list, { spaces: 2 });
  try {
    await fs.chmod(p, 0o600);
  } catch {}
  return p;
}

async function isOptedOut(client, number) {
  const n = normalizeWaNumber(number);
  if (!n) return false;
  const list = await readOptouts(client);
  return list.some((x) => normalizeWaNumber(x.number) === n);
}

async function addOptout(client, number, { reason = "user-request", source = "manual" } = {}) {
  const n = normalizeWaNumber(number);
  if (!n) throw new Error("Invalid number.");

  const list = await readOptouts(client);
  const exists = list.find((x) => normalizeWaNumber(x.number) === n);
  if (exists) return { added: false, record: exists, path: optoutPath(client) };

  const record = {
    number: n,
    reason,
    source,
    addedAt: new Date().toISOString()
  };
  list.push(record);
  const p = await writeOptouts(client, list);
  return { added: true, record, path: p };
}

async function removeOptout(client, number) {
  const n = normalizeWaNumber(number);
  const list = await readOptouts(client);
  const next = list.filter((x) => normalizeWaNumber(x.number) !== n);
  if (next.length === list.length) return { removed: false };
  const p = await writeOptouts(client, next);
  return { removed: true, path: p };
}

module.exports = {
  normalizeWaNumber,
  optoutPath,
  readOptouts,
  writeOptouts,
  isOptedOut,
  addOptout,
  removeOptout
};

