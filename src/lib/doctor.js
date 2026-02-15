const fs = require("fs-extra");

const { getConfig } = require("./config");
const { configPath, wabaHome } = require("./paths");
const { redactToken } = require("./redact");
const { logger } = require("./logger");

async function doctor({ json = false } = {}) {
  const cfg = await getConfig();
  const result = {
    home: wabaHome(),
    configPath: configPath(),
    configExists: await fs.pathExists(configPath()),
    graphVersion: cfg.graphVersion || "v20.0",
    baseUrl: cfg.baseUrl || "https://graph.facebook.com",
    token: cfg.token ? redactToken(cfg.token) : null,
    phoneNumberId: cfg.phoneNumberId || null,
    wabaId: cfg.wabaId || null,
    webhookVerifyToken: cfg.webhookVerifyToken ? "***set***" : null,
    appSecret: cfg.appSecret ? "***set***" : null,
    openaiApiKey: cfg.openaiApiKey ? "***set***" : null,
    openaiBaseUrl: cfg.openaiBaseUrl || null,
    openaiModel: cfg.openaiModel || null
  };

  if (json) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ok: true, result }, null, 2));
    return;
  }

  logger.info(`WABA_HOME: ${result.home}`);
  logger.info(`Config: ${result.configExists ? "found" : "missing"} (${result.configPath})`);
  logger.info(`Graph: ${result.baseUrl}/${result.graphVersion}`);
  logger.info(`Token: ${result.token || "(missing)"}`);
  logger.info(`Phone number ID: ${result.phoneNumberId || "(missing)"}`);
  logger.info(`Business (WABA) ID: ${result.wabaId || "(missing)"}`);
  logger.info(`Webhook verify token: ${result.webhookVerifyToken || "(missing)"}`);
  logger.info(`App secret (signature verify): ${result.appSecret || "(missing)"}`);
  logger.info(`OpenAI key: ${result.openaiApiKey || "(missing)"} (optional)`);
}

module.exports = { doctor };

