const { getConfig } = require("../lib/config");
const { addOrUpdateClient, listClients, switchClient, removeClient } = require("../lib/clients");
const { logger } = require("../lib/logger");
const { redactToken } = require("../lib/redact");
const { computeMetrics } = require("../lib/analytics");

function registerClientsCommands(program) {
  const c = program.command("clients").description("multi-client management (agencies)");

  c.command("list")
    .description("list configured clients")
    .action(async (_opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const out = await listClients();
      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, ...out }, null, 2));
        return;
      }
      logger.info(`Active: ${out.activeClient}`);
      for (const x of out.clients) {
        const mark = x.name === out.activeClient ? "*" : " ";
        logger.info(`${mark} ${x.name} phoneId=${x.phoneNumberId || "-"} wabaId=${x.wabaId || "-"} token=${x.token || "-"}`);
      }
    });

  c.command("add")
    .description("add or update a client credentials set")
    .argument("<name>", "client name (example: acme)")
    .requiredOption("--token <token>", "permanent token")
    .requiredOption("--phone-id <id>", "phone number id")
    .requiredOption("--business-id <id>", "WABA id")
    .option("--switch", "make this client active", false)
    .action(async (name, opts) => {
      const creds = { token: opts.token, phoneNumberId: opts.phoneId, wabaId: opts.businessId };
      const r = await addOrUpdateClient(name, creds, { makeActive: !!opts.switch });
      logger.ok(`Saved client '${r.name}' (${r.path})`);
      logger.info(`Token: ${redactToken(opts.token)}`);
      if (opts.switch) logger.info(`Active client: ${r.activeClient}`);
    });

  c.command("switch")
    .description("switch active client")
    .argument("<name>", "client name")
    .action(async (name) => {
      const r = await switchClient(name);
      logger.ok(`Active client: ${r.activeClient}`);
      logger.info(`Config: ${r.path}`);
    });

  c.command("remove")
    .description("remove a client from config (does not delete memory files)")
    .argument("<name>", "client name")
    .action(async (name) => {
      const r = await removeClient(name);
      if (!r.removed) {
        logger.warn("Client not found.");
        return;
      }
      logger.ok(`Removed client. Active: ${r.activeClient}`);
      logger.info(`Config: ${r.path}`);
    });

  c.command("billing")
    .description("estimate billing from local outbound counts (best-effort)")
    .argument("<name>", "client name")
    .option("--days <n>", "lookback window", (v) => Number(v), 30)
    .action(async (name, opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const cfg = await getConfig();
      const metrics = await computeMetrics({ client: name, days: opts.days, pricing: cfg.pricing });
      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, metrics }, null, 2));
        return;
      }
      logger.info(`Client: ${name} (last ${opts.days} days)`);
      logger.info(`Outbound msgs: ${metrics.costs.messages.total} (utility=${metrics.costs.messages.utility}, marketing=${metrics.costs.messages.marketing}, unknown=${metrics.costs.messages.unknown})`);
      logger.info(`Estimated INR (known categories): ${metrics.costs.inr.totalKnown.toFixed(2)}`);
    });
}

module.exports = { registerClientsCommands };

