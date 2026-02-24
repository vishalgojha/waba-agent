// @ts-nocheck
const fs = require("fs-extra");

const { getConfig } = require("./config");
const { resolveAiProviderConfig } = require("./ai/openai");
const { configPath, wabaHome } = require("./paths");
const { redactToken } = require("./redact");
const { logger } = require("./logger");
const { loadTsDoctorBridge } = require("./ts-bridge");

function printDoctorReport(report, gateFail, json) {
  if (json) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  logger.info(`Doctor overall: ${report.overall}${gateFail ? " (gate-fail)" : ""}`);
  logger.info(`- token_validity: ${report.tokenValidity.ok ? "OK" : "FAIL"} | ${report.tokenValidity.detail}`);
  logger.info(`- required_scopes: ${report.requiredScopes.ok ? "OK" : "FAIL"} | ${report.requiredScopes.detail}`);
  logger.info(`- phone_access: ${report.phoneAccess.ok ? "OK" : "FAIL"} | ${report.phoneAccess.detail}`);
  logger.info(`- webhook_connectivity: ${report.webhookConnectivity.ok ? "OK" : "FAIL"} | ${report.webhookConnectivity.detail}`);
  logger.info(`- test_send_capability: ${report.testSendCapability.ok ? "OK" : "FAIL"} | ${report.testSendCapability.detail}`);
  logger.info(`- rate_limits: ${report.rateLimits.ok ? "OK" : "FAIL"} | ${report.rateLimits.detail}`);
}

async function doctor({ json = false, scopeCheckMode = "best-effort", failOnWarn = false } = {}) {

  // Preferred path during migration: use TypeScript doctor engine in-process.
  try {
    const ts = await loadTsDoctorBridge();
    if (ts) {
      const cfg = await ts.readConfig();
      const report = await ts.runDoctor(cfg, { scopeCheckMode });
      const gateFail = failOnWarn ? ts.shouldFailDoctorGate(report, true) : false;
      printDoctorReport(report, gateFail, json);
      if (gateFail) throw new Error(`Doctor gate failed: overall=${report.overall}`);
      return;
    }
  } catch (err) {
    logger.warn(`TS doctor bridge unavailable, falling back to legacy doctor: ${err?.message || err}`);
  }

  // Legacy fallback path.
  const cfg = await getConfig();
  const ai = resolveAiProviderConfig(cfg);
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
    aiProvider: ai.provider,
    openaiApiKey: cfg.openaiApiKey ? "***set***" : null,
    openaiBaseUrl: cfg.openaiBaseUrl || null,
    openaiModel: cfg.openaiModel || null,
    anthropicApiKey: cfg.anthropicApiKey ? "***set***" : null,
    anthropicModel: cfg.anthropicModel || null,
    xaiApiKey: cfg.xaiApiKey ? "***set***" : null,
    xaiModel: cfg.xaiModel || null,
    openrouterApiKey: cfg.openrouterApiKey ? "***set***" : null,
    openrouterModel: cfg.openrouterModel || null
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
  logger.info(`AI provider: ${result.aiProvider || "(none)"}`);
  logger.info(`OpenAI key: ${result.openaiApiKey || "(missing)"} (optional)`);
  logger.info(`Anthropic key: ${result.anthropicApiKey || "(missing)"} (optional)`);
  logger.info(`xAI key: ${result.xaiApiKey || "(missing)"} (optional)`);
  logger.info(`OpenRouter key: ${result.openrouterApiKey || "(missing)"} (optional)`);
}

module.exports = { doctor };
