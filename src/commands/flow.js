const { getConfig } = require("../lib/config");
const { logger } = require("../lib/logger");
const { loadFlow, saveFlow, listFlows, newStepId, presetLeadQualification, ensurePresetFlow } = require("../lib/flow-store");
const { handleInboundWithFlow } = require("../lib/flow-engine");

function registerFlowCommands(program) {
  const f = program.command("flow").description("conversation flow builder (lead qualification)");

  f.command("list")
    .description("list flows for a client")
    .option("--client <name>", "client name (default: active client)")
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const cfg = await getConfig();
      const client = opts.client || cfg.activeClient || "default";
      const flows = await listFlows(client);
      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, client, flows }, null, 2));
        return;
      }
      logger.info(`Flows (${client}): ${flows.length}`);
      for (const x of flows) logger.info(x);
    });

  f.command("create")
    .description("create a new flow (optionally from preset)")
    .argument("<name>", "flow name")
    .option("--client <name>", "client name (default: active client)")
    .option("--preset <name>", "preset: lead-qualification", "lead-qualification")
    .action(async (name, opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const cfg = await getConfig();
      const client = opts.client || cfg.activeClient || "default";

      let flow;
      if (opts.preset === "lead-qualification") flow = presetLeadQualification(name);
      else flow = { id: name, name, version: 1, createdAt: new Date().toISOString(), steps: [] };

      const p = await saveFlow(client, flow);
      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, client, path: p, flow }, null, 2));
        return;
      }
      logger.ok(`Flow saved: ${p}`);
    });

  f.command("add-step")
    .description("add a step to a flow")
    .requiredOption("--flow <name>", "flow name")
    .requiredOption("--type <question|reply|end>", "step type")
    .option("--text <text>", "text body")
    .option("--field <name>", "field name (for question step)")
    .option("--client <name>", "client name (default: active client)")
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const cfg = await getConfig();
      const client = opts.client || cfg.activeClient || "default";

      let flow = await loadFlow(client, opts.flow);
      if (!flow) {
        await ensurePresetFlow(client, opts.flow);
        flow = await loadFlow(client, opts.flow);
      }
      if (!flow) throw new Error("Flow not found.");

      const step = { id: newStepId(), type: opts.type };
      if (opts.text) step.text = opts.text;
      if (opts.type === "question") {
        if (!opts.field) throw new Error("--field is required for question steps.");
        step.field = opts.field;
        if (!opts.text) step.text = `Please share ${opts.field}.`;
      }
      if (opts.type === "reply" || opts.type === "end") {
        if (!opts.text) throw new Error("--text is required for reply/end steps.");
      }

      flow.steps = Array.isArray(flow.steps) ? flow.steps : [];
      flow.steps.push(step);
      flow.version = Number(flow.version || 1) + 1;
      flow.updatedAt = new Date().toISOString();
      const p = await saveFlow(client, flow);

      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, client, path: p, step }, null, 2));
        return;
      }
      logger.ok(`Added step to ${opts.flow}: ${step.type} (${step.id})`);
      logger.info(`Flow: ${p}`);
    });

  f.command("show")
    .description("show a flow JSON")
    .requiredOption("--flow <name>", "flow name")
    .option("--client <name>", "client name (default: active client)")
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const cfg = await getConfig();
      const client = opts.client || cfg.activeClient || "default";
      const flow = await loadFlow(client, opts.flow);
      if (!flow) throw new Error("Flow not found.");
      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, client, flow }, null, 2));
        return;
      }
      logger.info(JSON.stringify(flow, null, 2));
    });

  f.command("test")
    .description("simulate an inbound message through a flow (no WhatsApp send)")
    .requiredOption("--flow <name>", "flow name")
    .requiredOption("--from <number>", "sender number")
    .requiredOption("--text <text>", "inbound text")
    .option("--client <name>", "client name (default: active client)")
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const cfg = await getConfig();
      const client = opts.client || cfg.activeClient || "default";

      const out = await handleInboundWithFlow({
        client,
        from: opts.from,
        inboundText: opts.text,
        flowName: opts.flow,
        nowIso: new Date().toISOString()
      });

      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, out }, null, 2));
        return;
      }
      logger.info(JSON.stringify(out, null, 2));
      if (out.message?.body) logger.ok(`Next outbound: ${out.message.body}`);
    });
}

module.exports = { registerFlowCommands };

