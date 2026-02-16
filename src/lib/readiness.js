const { getClientCreds } = require("./creds");
const { resolveAiProviderConfig } = require("./ai/openai");

function buildReadiness(cfg = {}, { client } = {}) {
  const creds = getClientCreds(cfg, client);
  const ai = resolveAiProviderConfig(cfg);
  const metaReady = !!(creds.token && creds.phoneNumberId && creds.wabaId);
  const webhookReady = !!cfg.webhookVerifyToken;
  const aiReady = !!(ai.apiKey && ai.model);
  const missing = [
    ...(metaReady ? [] : ["meta_credentials"]),
    ...(webhookReady ? [] : ["webhook_verify_token"]),
    ...(aiReady ? [] : ["ai_provider"])
  ];
  return {
    client: creds.client,
    activeClient: cfg.activeClient || "default",
    metaReady,
    webhookReady,
    aiReady,
    overallReady: metaReady && webhookReady,
    missing,
    creds: {
      token: creds.token || null,
      phoneNumberId: creds.phoneNumberId || null,
      wabaId: creds.wabaId || null
    },
    ai: {
      provider: ai.provider || null,
      model: ai.model || null,
      baseUrl: ai.baseUrl || null
    }
  };
}

module.exports = { buildReadiness };
