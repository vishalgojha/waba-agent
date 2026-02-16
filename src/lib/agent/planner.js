const { chatCompletionJson, hasAiProviderConfigured } = require("../ai/openai");
const { readMemory, summarizeForPrompt } = require("../memory");

function maxRisk(risks) {
  const order = { low: 1, medium: 2, high: 3 };
  let m = "low";
  for (const r of risks) {
    if ((order[r] || 0) > (order[m] || 0)) m = r;
  }
  return m;
}

function localPlan({ prompt, client, webhookUrl, exampleInboundText }) {
  const steps = [];

  // Always scaffold the client.
  let businessType = "generic";
  if (/real\s*estate|property|broker|flat|villa|plot/.test(prompt.toLowerCase())) businessType = "real_estate";
  if (/salon|spa|beauty/.test(prompt.toLowerCase())) businessType = "salon";
  if (/restaurant|cafe|food/.test(prompt.toLowerCase())) businessType = "restaurant";
  if (/clinic|doctor|dentist/.test(prompt.toLowerCase())) businessType = "clinic";

  steps.push({
    tool: "client.init",
    args: { client, businessType },
    reason: "Create per-client config scaffold (timezone, questions, auto replies)."
  });

  steps.push({
    tool: "memory.note",
    args: { client, text: `Agent run: ${prompt}` },
    reason: "Record the requested automation goal for this client."
  });

  if (webhookUrl) {
    steps.push({
      tool: "webhook.setup_hint",
      args: { url: webhookUrl },
      reason: "Provide exact Meta webhook setup values (callback URL + verify token)."
    });
  }

  if (exampleInboundText) {
    steps.push({
      tool: "lead.classify",
      args: { client, text: exampleInboundText },
      reason: "Qualify a sample inbound message and generate next best replies."
    });
  }

  return steps;
}

async function aiPlan({ prompt, client, webhookUrl, exampleInboundText, tools, config, memoryEnabled }) {
  const toolList = tools
    .map((t) => `- ${t.name} (risk:${t.risk}): ${t.description}`)
    .join("\n");

  const memorySummary = memoryEnabled === false
    ? ""
    : summarizeForPrompt(await readMemory(client, { limit: 200 }), { maxChars: 1500 });

  const user = [
    `Goal: ${prompt}`,
    `Client: ${client}`,
    memorySummary ? `Client memory (recent summary):\n${memorySummary}` : "",
    webhookUrl ? `Webhook URL: ${webhookUrl}` : "",
    exampleInboundText ? `Example inbound text: ${exampleInboundText}` : ""
  ]
    .filter(Boolean)
    .join("\n");

  const plan = await chatCompletionJson(config, {
    system:
      "You are a WhatsApp Business Cloud API automation agent.\n" +
      "Return strict JSON only: an array of steps.\n" +
      "Each step schema: {tool: string, args: object, reason: string}.\n" +
      "Only use tools listed below.\n" +
      "Prefer low risk steps. Only include high risk steps (sending outbound) if clearly requested.\n" +
      "Tools:\n" +
      toolList,
    user
  });

  if (!Array.isArray(plan)) throw new Error("AI plan is not an array.");
  return plan;
}

async function planSteps(ctx, { prompt, client, webhookUrl, exampleInboundText }) {
  const tools = ctx.registry.list();
  const hasAi = hasAiProviderConfigured(ctx.config || {});

  const raw = hasAi
    ? await aiPlan({ prompt, client, webhookUrl, exampleInboundText, tools, config: ctx.config, memoryEnabled: ctx.memoryEnabled })
    : localPlan({ prompt, client, webhookUrl, exampleInboundText });

  // Validate against registry, and decorate risk.
  const steps = [];
  for (const s of raw) {
    if (!s?.tool || typeof s.tool !== "string") continue;
    const t = ctx.registry.get(s.tool);
    if (!t) continue;
    steps.push({
      tool: s.tool,
      risk: t.risk,
      args: s.args || {},
      reason: s.reason || ""
    });
  }

  return { steps, risk: maxRisk(steps.map((s) => s.risk)) };
}

module.exports = { planSteps };
