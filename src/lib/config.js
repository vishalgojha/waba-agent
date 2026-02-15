const fs = require("fs-extra");
const path = require("path");

const { configPath, wabaHome } = require("./paths");
const { logger } = require("./logger");

async function readConfigRaw() {
  const p = configPath();
  try {
    if (!(await fs.pathExists(p))) return {};
    const data = await fs.readJson(p);
    return data && typeof data === "object" ? data : {};
  } catch (err) {
    logger.warn(`failed reading config at ${p}: ${err?.message || err}`);
    return {};
  }
}

async function writeConfigRaw(next) {
  const home = wabaHome();
  await fs.ensureDir(home);
  const p = configPath();
  await fs.writeJson(p, next, { spaces: 2 });
  // Best-effort file permission hardening (limited on Windows).
  try {
    await fs.chmod(p, 0o600);
  } catch {}
  return p;
}

function envOr(current, envKeys) {
  for (const k of envKeys) {
    const v = process.env[k];
    if (v !== undefined && v !== "") return v;
  }
  return current;
}

async function getConfig() {
  const cfg = await readConfigRaw();
  cfg.graphVersion = envOr(cfg.graphVersion, ["WABA_GRAPH_VERSION"]);
  cfg.baseUrl = envOr(cfg.baseUrl, ["WABA_BASE_URL"]); // e.g. https://graph.facebook.com

  cfg.token = envOr(cfg.token, ["WABA_TOKEN", "WHATSAPP_TOKEN"]);
  cfg.phoneNumberId = envOr(cfg.phoneNumberId, ["WABA_PHONE_ID", "WHATSAPP_PHONE_ID"]);
  cfg.wabaId = envOr(cfg.wabaId, ["WABA_BUSINESS_ID", "WHATSAPP_BUSINESS_ID", "WABA_WABA_ID"]);

  cfg.webhookVerifyToken = envOr(cfg.webhookVerifyToken, ["WABA_VERIFY_TOKEN", "WHATSAPP_VERIFY_TOKEN"]);
  cfg.appSecret = envOr(cfg.appSecret, ["WABA_APP_SECRET", "WHATSAPP_APP_SECRET"]);

  cfg.openaiApiKey = envOr(cfg.openaiApiKey, ["OPENAI_API_KEY"]);
  cfg.openaiBaseUrl = envOr(cfg.openaiBaseUrl, ["OPENAI_BASE_URL"]);
  cfg.openaiModel = envOr(cfg.openaiModel, ["WABA_OPENAI_MODEL", "OPENAI_MODEL"]);
  cfg.openaiVisionModel = envOr(cfg.openaiVisionModel, ["WABA_OPENAI_VISION_MODEL"]);
  cfg.openaiTranscribeModel = envOr(cfg.openaiTranscribeModel, ["WABA_OPENAI_TRANSCRIBE_MODEL"]);

  return cfg;
}

async function setConfig(patch) {
  const prev = await readConfigRaw();
  const next = { ...prev, ...patch };
  const p = await writeConfigRaw(next);
  return { path: p, config: next };
}

async function clearConfig(keys) {
  const prev = await readConfigRaw();
  const next = { ...prev };
  for (const k of keys) delete next[k];
  const p = await writeConfigRaw(next);
  return { path: p, config: next };
}

function getDefaultGraphVersion() {
  return "v20.0";
}

module.exports = {
  getConfig,
  setConfig,
  clearConfig,
  getDefaultGraphVersion
};

