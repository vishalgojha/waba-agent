const { createRegistry } = require("../tools/registry");
const { getConfig } = require("../config");
const { WhatsAppCloudApi } = require("../whatsapp");
const { appendMemory } = require("../memory");
const { isOptedOut, addOptout } = require("../optout-store");

const { planSteps } = require("./planner");
const { executePlan } = require("./executor");

async function createAgentContext({ client, memoryEnabled = true } = {}) {
  const config = await getConfig();
  const registry = createRegistry();

  const clientName = client || config.activeClient || "default";
  const creds = (config.clients && typeof config.clients === "object" ? config.clients[clientName] : null) ||
    (config.clients && typeof config.clients === "object" ? config.clients[config.activeClient || "default"] : null) ||
    {};

  // Use per-client creds when present. Env vars still override via getConfig() for single-tenant deployments.
  const token = creds.token || config.token;
  const phoneNumberId = creds.phoneNumberId || config.phoneNumberId;
  const wabaId = creds.wabaId || config.wabaId;

  const whatsapp = new WhatsAppCloudApi({
    token,
    phoneNumberId,
    wabaId,
    graphVersion: config.graphVersion || "v20.0",
    baseUrl: config.baseUrl,
    timeoutMs: 30_000
  });

  const ctx = {
    config: { ...config, token, phoneNumberId, wabaId },
    registry,
    whatsapp,
    client: clientName,
    memoryEnabled: !!memoryEnabled,
    optout: {
      async isOptedOut(number) {
        return isOptedOut(ctx.client, number);
      },
      async add(number, meta) {
        return addOptout(ctx.client, number, meta);
      }
    },
    async appendMemory(c, event) {
      if (!ctx.memoryEnabled) return;
      await appendMemory(c, event);
    }
  };

  return ctx;
}

async function runAgent({ prompt, client, webhookUrl, exampleInboundText }, opts) {
  const ctx = await createAgentContext({ client, memoryEnabled: opts?.memoryEnabled !== false });
  const { steps, risk } = await planSteps(ctx, { prompt, client: ctx.client, webhookUrl, exampleInboundText });
  return executePlan(ctx, { steps, risk }, opts);
}

module.exports = { runAgent, createAgentContext };
