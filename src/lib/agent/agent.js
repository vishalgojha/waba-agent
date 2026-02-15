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
  const whatsapp = new WhatsAppCloudApi({
    token: config.token,
    phoneNumberId: config.phoneNumberId,
    wabaId: config.wabaId,
    graphVersion: config.graphVersion || "v20.0",
    baseUrl: config.baseUrl,
    timeoutMs: 30_000
  });

  const ctx = {
    config,
    registry,
    whatsapp,
    client: client || "default",
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
