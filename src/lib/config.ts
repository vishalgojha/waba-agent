// @ts-nocheck
const fs = require("fs-extra");
const os = require("os");
const path = require("path");

const { configPath, wabaHome } = require("./paths");
const { logger } = require("./logger");

async function readConfigRaw() {
  const p = configPath();
  try {
    if (!(await fs.pathExists(p))) {
      // Backward compatibility: older default home was ~/.waba-agent
      const legacy = path.join(os.homedir(), ".waba-agent", "config.json");
      if (await fs.pathExists(legacy)) return await fs.readJson(legacy);
      return {};
    }
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

function normalizeMultiClient(raw) {
  const cfg = raw && typeof raw === "object" ? { ...raw } : {};
  cfg.clients = cfg.clients && typeof cfg.clients === "object" ? { ...cfg.clients } : {};

  // Backward compatibility: single-tenant fields stored at top-level.
  const hasLegacyCreds = !!(cfg.token || cfg.phoneNumberId || cfg.wabaId);
  if (hasLegacyCreds && !cfg.clients.default) {
    cfg.clients.default = {
      token: cfg.token,
      phoneNumberId: cfg.phoneNumberId,
      wabaId: cfg.wabaId
    };
  }

  if (!cfg.activeClient) cfg.activeClient = "default";
  if (!cfg.clients[cfg.activeClient]) cfg.clients[cfg.activeClient] = {};

  return cfg;
}

async function getConfig() {
  const raw = await readConfigRaw();
  const cfg = normalizeMultiClient(raw);

  const activeName = cfg.activeClient || "default";
  const active = cfg.clients?.[activeName] || {};

  // Expose active client fields at top-level for convenience.
  cfg.token = active.token || cfg.token;
  cfg.phoneNumberId = active.phoneNumberId || cfg.phoneNumberId;
  cfg.wabaId = active.wabaId || cfg.wabaId;

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
  cfg.aiProvider = envOr(cfg.aiProvider, ["WABA_AI_PROVIDER"]);
  if (!cfg.aiProvider) cfg.aiProvider = "ollama";

  cfg.anthropicApiKey = envOr(cfg.anthropicApiKey, ["ANTHROPIC_API_KEY"]);
  cfg.anthropicBaseUrl = envOr(cfg.anthropicBaseUrl, ["ANTHROPIC_BASE_URL"]);
  cfg.anthropicModel = envOr(cfg.anthropicModel, ["WABA_ANTHROPIC_MODEL", "ANTHROPIC_MODEL"]);

  cfg.xaiApiKey = envOr(cfg.xaiApiKey, ["XAI_API_KEY"]);
  cfg.xaiBaseUrl = envOr(cfg.xaiBaseUrl, ["XAI_BASE_URL"]);
  cfg.xaiModel = envOr(cfg.xaiModel, ["WABA_XAI_MODEL", "XAI_MODEL"]);

  cfg.openrouterApiKey = envOr(cfg.openrouterApiKey, ["OPENROUTER_API_KEY"]);
  cfg.openrouterBaseUrl = envOr(cfg.openrouterBaseUrl, ["OPENROUTER_BASE_URL"]);
  cfg.openrouterModel = envOr(cfg.openrouterModel, ["WABA_OPENROUTER_MODEL", "OPENROUTER_MODEL"]);
  cfg.openrouterSiteUrl = envOr(cfg.openrouterSiteUrl, ["WABA_OPENROUTER_SITE_URL", "OPENROUTER_SITE_URL"]);
  cfg.openrouterAppName = envOr(cfg.openrouterAppName, ["WABA_OPENROUTER_APP_NAME", "OPENROUTER_APP_NAME"]);

  cfg.pricing = cfg.pricing && typeof cfg.pricing === "object" ? cfg.pricing : {};
  // Rough ballpark defaults (verify current Meta rates).
  cfg.pricing.inrPerUtility = Number(cfg.pricing.inrPerUtility ?? 0.11);
  cfg.pricing.inrPerMarketing = Number(cfg.pricing.inrPerMarketing ?? 0.78);

  return cfg;
}

async function setConfig(patch) {
  const prev = normalizeMultiClient(await readConfigRaw());
  const next = { ...prev, ...patch };
  const p = await writeConfigRaw(next);
  return { path: p, config: next };
}

async function clearConfig(keys) {
  const prev = normalizeMultiClient(await readConfigRaw());
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
  getDefaultGraphVersion,
  readConfigRaw,
  writeConfigRaw,
  normalizeMultiClient
};
