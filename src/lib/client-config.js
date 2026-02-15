const fs = require("fs-extra");
const path = require("path");

const { contextDir } = require("./paths");
const { safeName } = require("./memory");

function clientConfigPath(client) {
  return path.join(contextDir(), safeName(client), "client.json");
}

async function getClientConfig(client) {
  const p = clientConfigPath(client);
  if (!(await fs.pathExists(p))) return null;
  try {
    const cfg = await fs.readJson(p);
    return cfg && typeof cfg === "object" ? cfg : null;
  } catch {
    return null;
  }
}

function deepMerge(a, b) {
  if (!b || typeof b !== "object" || Array.isArray(b)) return b;
  const out = { ...(a && typeof a === "object" ? a : {}) };
  for (const [k, v] of Object.entries(b)) {
    if (v && typeof v === "object" && !Array.isArray(v)) out[k] = deepMerge(out[k], v);
    else out[k] = v;
  }
  return out;
}

async function setClientConfig(client, patch) {
  const p = clientConfigPath(client);
  await fs.ensureDir(path.dirname(p));
  const prev = (await getClientConfig(client)) || {};
  const next = deepMerge(prev, patch || {});
  await fs.writeJson(p, next, { spaces: 2 });
  try {
    await fs.chmod(p, 0o600);
  } catch {}
  return { path: p, config: next };
}

module.exports = {
  clientConfigPath,
  getClientConfig,
  setClientConfig
};

