// @ts-nocheck
const { startAnalyticsServer } = require("../server/analytics");
const { computeMetrics } = require("../lib/analytics");
const { getConfig } = require("../lib/config");
const { logger } = require("../lib/logger");

function registerAnalyticsCommands(program) {
  const a = program.command("analytics").description("local analytics (reads ~/.waba/context memory)");

  a.command("start")
    .description("start a simple local web dashboard")
    .option("--host <host>", "bind host", "127.0.0.1")
    .option("--port <n>", "port", (v) => Number(v), 3001)
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      if (json) throw new Error("--json not supported for long-running server.");
      await startAnalyticsServer({ host: opts.host, port: opts.port });
      logger.info("Ctrl+C to stop.");
    });

  program
    .command("metrics")
    .description("print key metrics")
    .option("--client <name>", "client name (default: active client)")
    .option("--days <n>", "lookback window", (v) => Number(v), 30)
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const cfg = await getConfig();
      const client = opts.client || cfg.activeClient || "default";
      const metrics = await computeMetrics({ client, days: opts.days, pricing: cfg.pricing });
      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, metrics }, null, 2));
        return;
      }
      logger.info(`Client: ${client} (last ${opts.days} days)`);
      logger.info(`Leads: ${metrics.leads.inboundMessages} inbound, ${metrics.leads.uniqueSenders} unique`);
      logger.info(`Response: avg=${metrics.responses.avgMinutes?.toFixed?.(1) ?? "-"}m p50=${metrics.responses.p50Minutes?.toFixed?.(1) ?? "-"}m p90=${metrics.responses.p90Minutes?.toFixed?.(1) ?? "-"}m (n=${metrics.responses.samples})`);
      logger.info(`Costs: INR ${metrics.costs.inr.totalKnown.toFixed(2)} (utility=${metrics.costs.messages.utility}, marketing=${metrics.costs.messages.marketing}, unknown=${metrics.costs.messages.unknown})`);
    });
}

module.exports = { registerAnalyticsCommands };

