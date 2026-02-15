const { readConfigRaw, writeConfigRaw, normalizeMultiClient } = require("./config");
const { redactToken } = require("./redact");

function safeClientName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function listClients() {
  const cfg = normalizeMultiClient(await readConfigRaw());
  const names = Object.keys(cfg.clients || {}).sort();
  return {
    activeClient: cfg.activeClient || "default",
    clients: names.map((n) => {
      const c = cfg.clients[n] || {};
      return {
        name: n,
        phoneNumberId: c.phoneNumberId || null,
        wabaId: c.wabaId || null,
        token: c.token ? redactToken(c.token) : null
      };
    })
  };
}

async function addOrUpdateClient(name, creds, { makeActive = false } = {}) {
  const n = safeClientName(name);
  if (!n) throw new Error("Invalid client name.");

  const cfg = normalizeMultiClient(await readConfigRaw());
  cfg.clients[n] = {
    ...(cfg.clients[n] || {}),
    ...(creds || {})
  };
  if (makeActive) cfg.activeClient = n;

  const p = await writeConfigRaw(cfg);
  return { path: p, name: n, activeClient: cfg.activeClient };
}

async function switchClient(name) {
  const n = safeClientName(name);
  const cfg = normalizeMultiClient(await readConfigRaw());
  if (!cfg.clients[n]) throw new Error(`Client not found: ${n}`);
  cfg.activeClient = n;
  const p = await writeConfigRaw(cfg);
  return { path: p, activeClient: n };
}

async function removeClient(name) {
  const n = safeClientName(name);
  const cfg = normalizeMultiClient(await readConfigRaw());
  if (!cfg.clients[n]) return { removed: false };
  delete cfg.clients[n];
  if (cfg.activeClient === n) cfg.activeClient = Object.keys(cfg.clients)[0] || "default";
  const p = await writeConfigRaw(cfg);
  return { removed: true, path: p, activeClient: cfg.activeClient };
}

module.exports = {
  safeClientName,
  listClients,
  addOrUpdateClient,
  switchClient,
  removeClient
};

