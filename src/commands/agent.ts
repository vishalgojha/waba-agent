// @ts-nocheck
const { runAgent } = require("../lib/agent/agent");
const { logger } = require("../lib/logger");
const { getConfig } = require("../lib/config");

function inferClient(prompt) {
  const p = String(prompt || "");
  // e.g. "handle leads for real estate client acme" or "for acme-realty"
  const m1 = p.match(/\bfor\s+([a-z0-9._-]{2,})\b/i);
  if (m1) return m1[1];
  const m2 = p.match(/\bclient\s+([a-z0-9._-]{2,})\b/i);
  if (m2) return m2[1];
  return null;
}

function registerAgentCommands(program) {
  const a = program.command("agent").description("safe agent mode (plan, confirm, execute via registered tools only)");

  a.command("run")
    .description("generate a tool-only plan for a client and execute it with confirmations")
    .argument("<prompt...>", "goal prompt in quotes")
    .option("--client <name>", "client name (default: inferred or 'default')")
    .option("--webhook-url <url>", "if provided, include webhook setup hints in plan")
    .option("--example-inbound <text>", "classify a sample inbound message and suggest replies")
    .option("--yes", "skip the initial plan confirmation (high-risk steps still prompt unless --allow-high-risk)", false)
    .option("--allow-high-risk", "allow high-risk tools (outbound/scheduling) without extra prompts", false)
    .action(async (promptParts, opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json, memory } = root.opts();
      const prompt = Array.isArray(promptParts) ? promptParts.join(" ") : String(promptParts);
      const cfg = await getConfig();
      const client = opts.client || inferClient(prompt) || cfg.activeClient || "default";

      const res = await runAgent(
        {
          prompt,
          client,
          webhookUrl: opts.webhookUrl,
          exampleInboundText: opts.exampleInbound
        },
        { yes: !!opts.yes, allowHighRisk: !!opts.allowHighRisk, json, memoryEnabled: memory !== false }
      );

      if (!json) {
        if (res.executed === false) logger.warn("No changes made.");
      }
    });
}

module.exports = { registerAgentCommands };
