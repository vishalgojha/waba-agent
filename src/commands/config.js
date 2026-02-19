const { getConfig, readConfigRaw, writeConfigRaw, normalizeMultiClient } = require("../lib/config");
const { configPath } = require("../lib/paths");
const { logger } = require("../lib/logger");
const { safeClientName } = require("../lib/clients");
const { redactToken } = require("../lib/redact");
const { loadTsConfigBridge } = require("../lib/ts-bridge");

function parseConfigValue(raw) {
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

function toPathArray(keyPath) {
  return String(keyPath || "")
    .split(".")
    .map((x) => x.trim())
    .filter(Boolean);
}

function setByPath(target, keyPath, value) {
  const parts = toPathArray(keyPath);
  if (!parts.length) throw new Error("Invalid key path.");
  let cur = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const k = parts[i];
    if (!cur[k] || typeof cur[k] !== "object" || Array.isArray(cur[k])) cur[k] = {};
    cur = cur[k];
  }
  cur[parts[parts.length - 1]] = value;
}

function unsetByPath(target, keyPath) {
  const parts = toPathArray(keyPath);
  if (!parts.length) throw new Error("Invalid key path.");
  let cur = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    cur = cur?.[parts[i]];
    if (!cur || typeof cur !== "object") return false;
  }
  const leaf = parts[parts.length - 1];
  if (!Object.prototype.hasOwnProperty.call(cur, leaf)) return false;
  delete cur[leaf];
  return true;
}

function redactConfigForDisplay(cfg) {
  if (!cfg || typeof cfg !== "object") return cfg;
  const out = JSON.parse(JSON.stringify(cfg));
  if (out.token) out.token = redactToken(out.token);
  if (out.clients && typeof out.clients === "object") {
    for (const name of Object.keys(out.clients)) {
      const c = out.clients[name];
      if (c && c.token) c.token = redactToken(c.token);
    }
  }
  return out;
}

function registerConfigCommands(program) {
  const c = program.command("config").description("inspect and update global/per-client config");

  c.command("show")
    .description("show effective config (env overrides included)")
    .action(async (_opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      let effective = await getConfig();
      try {
        const ts = await loadTsConfigBridge();
        if (ts) {
          const tcfg = await ts.readConfig();
          effective = {
            ...effective,
            token: tcfg.token || effective.token,
            phoneNumberId: tcfg.phoneNumberId || effective.phoneNumberId,
            wabaId: tcfg.businessId || effective.wabaId,
            businessId: tcfg.businessId || effective.businessId,
            graphVersion: tcfg.graphVersion || effective.graphVersion,
            baseUrl: tcfg.baseUrl || effective.baseUrl,
            webhookVerifyToken: tcfg.webhookVerifyToken || effective.webhookVerifyToken,
            webhookUrl: tcfg.webhookUrl || effective.webhookUrl
          };
        }
      } catch (err) {
        logger.warn(`TS config bridge unavailable, falling back to legacy config: ${err?.message || err}`);
      }
      const redacted = redactConfigForDisplay(effective);
      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, path: configPath(), config: redacted }, null, 2));
        return;
      }
      logger.info(`Config path: ${configPath()}`);
      logger.info(`Active client: ${redacted.activeClient || "default"}`);
      logger.info(`Graph: ${redacted.baseUrl || "https://graph.facebook.com"}/${redacted.graphVersion || "v20.0"}`);
      logger.info(`Token: ${redacted.token || "(missing)"}`);
      logger.info(`Phone ID: ${redacted.phoneNumberId || "(missing)"}`);
      logger.info(`WABA ID: ${redacted.wabaId || "(missing)"}`);
      logger.info(`Clients: ${Object.keys(redacted.clients || {}).sort().join(", ") || "(none)"}`);
    });

  c.command("set")
    .description("set a config value (supports dot-path keys)")
    .argument("<key>", "key path, e.g. pricing.inrPerMarketing")
    .argument("<value>", "value (supports true/false/null/number/JSON)")
    .option("--client <name>", "set on a specific client under clients.<name>.*")
    .action(async (key, value, opts) => {
      const raw = normalizeMultiClient(await readConfigRaw());
      const parsed = parseConfigValue(value);
      if (opts.client) {
        const n = safeClientName(opts.client);
        if (!n) throw new Error("Invalid client name.");
        raw.clients = raw.clients || {};
        raw.clients[n] = raw.clients[n] || {};
        setByPath(raw.clients[n], key, parsed);
      } else {
        setByPath(raw, key, parsed);
      }
      const p = await writeConfigRaw(raw);
      logger.ok(`Updated ${opts.client ? `client ${safeClientName(opts.client)}.` : ""}${key} in ${p}`);
    });

  c.command("unset")
    .description("remove a config value (supports dot-path keys)")
    .argument("<key>", "key path")
    .option("--client <name>", "unset on a specific client under clients.<name>.*")
    .action(async (key, opts) => {
      const raw = normalizeMultiClient(await readConfigRaw());
      let removed = false;
      if (opts.client) {
        const n = safeClientName(opts.client);
        if (!n) throw new Error("Invalid client name.");
        raw.clients = raw.clients || {};
        raw.clients[n] = raw.clients[n] || {};
        removed = unsetByPath(raw.clients[n], key);
      } else {
        removed = unsetByPath(raw, key);
      }
      const p = await writeConfigRaw(raw);
      if (!removed) {
        logger.warn("Key not found. No change made.");
        return;
      }
      logger.ok(`Removed ${opts.client ? `client ${safeClientName(opts.client)}.` : ""}${key} from ${p}`);
    });
}

module.exports = {
  registerConfigCommands,
  parseConfigValue,
  setByPath,
  unsetByPath
};
