const { chatCompletionJson } = require("../../ai/openai");

function heuristic(text) {
  const t = String(text || "").toLowerCase();
  const tags = [];
  if (/(price|cost|rate|quotation|quote|charges|fees)/.test(t)) tags.push("pricing");
  if (/(visit|site|inspection|demo|appointment|call)/.test(t)) tags.push("appointment");
  if (/(brochure|catalog|details|info|information)/.test(t)) tags.push("info");
  if (/(urgent|today|asap)/.test(t)) tags.push("hot");
  return {
    intent: tags.includes("pricing") ? "pricing_inquiry" : tags.includes("appointment") ? "appointment_request" : "general_inquiry",
    temperature: tags.includes("hot") ? "hot" : "warm",
    tags
  };
}

function toolLeadClassify() {
  return {
    name: "lead.classify",
    description: "Classify an inbound message into lead intent + extract fields (uses AI if configured).",
    risk: "medium",
    async execute(ctx, args) {
      const client = args?.client || ctx.client || "default";
      const text = args?.text || "";
      const from = args?.from || null;
      const useAi = !!ctx.config?.openaiApiKey;

      let result;
      if (!useAi) {
        result = heuristic(text);
      } else {
        result = await chatCompletionJson(ctx.config, {
          system:
            "You are a WhatsApp lead-qualification assistant for India SMBs. Return strict JSON only.\n" +
            "Schema: {intent, temperature, fields, nextReplyHindi, nextReplyEnglish, handoffRecommended, notes}.\n" +
            "intent examples: pricing_inquiry, appointment_request, order_status, general_inquiry.\n" +
            "temperature: cold|warm|hot.\n" +
            "fields: {name, phone, location, budget, timeline, productOrService} (null if unknown).",
          user: `Inbound message:\n${text}`
        });
      }

      await ctx.appendMemory(client, { type: "lead_classification", from, text, result });
      return { ok: true, result };
    }
  };
}

module.exports = { toolLeadClassify };
