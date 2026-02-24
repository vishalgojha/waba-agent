// @ts-nocheck
const { getConfig } = require("../lib/config");
const { computeMetrics } = require("../lib/analytics");
const { logger } = require("../lib/logger");

function registerCostCommands(program) {
  const c = program.command("cost").description("pricing calculator (estimates; verify Meta billing)");

  c.command("estimate")
    .description("estimate spend from message volumes")
    .requiredOption("--utility <n>", "utility messages count", (v) => Number(v))
    .requiredOption("--marketing <n>", "marketing messages count", (v) => Number(v))
    .option("--utility-rate <inr>", "INR per utility msg (default: config or 0.11)", (v) => Number(v))
    .option("--marketing-rate <inr>", "INR per marketing msg (default: config or 0.78)", (v) => Number(v))
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const cfg = await getConfig();
      const uRate = Number.isFinite(opts.utilityRate) ? opts.utilityRate : cfg.pricing?.inrPerUtility ?? 0.11;
      const mRate = Number.isFinite(opts.marketingRate) ? opts.marketingRate : cfg.pricing?.inrPerMarketing ?? 0.78;
      const utility = opts.utility;
      const marketing = opts.marketing;
      const total = utility * uRate + marketing * mRate;
      const out = { utility, marketing, rates: { uRate, mRate }, inr: { total, utility: utility * uRate, marketing: marketing * mRate } };
      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, out }, null, 2));
        return;
      }
      logger.info(`Utility: ${utility} x INR ${uRate} = INR ${(utility * uRate).toFixed(2)}`);
      logger.info(`Marketing: ${marketing} x INR ${mRate} = INR ${(marketing * mRate).toFixed(2)}`);
      logger.ok(`Total estimate: INR ${total.toFixed(2)}`);
      logger.warn("This is an estimate. WhatsApp billing depends on category/conversation rules and current Meta rates.");
    });

  c.command("actual")
    .description("estimate actual spend from local logs (requires outbound category tagging)")
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
      logger.info(`Utility msgs: ${metrics.costs.messages.utility}, marketing msgs: ${metrics.costs.messages.marketing}, unknown: ${metrics.costs.messages.unknown}`);
      logger.ok(`Known-category estimate: INR ${metrics.costs.inr.totalKnown.toFixed(2)}`);
      if (metrics.costs.messages.unknown) {
        logger.warn("Unknown category messages exist. Tag outbound sends with --category utility|marketing for accurate estimates.");
      }
    });
}

module.exports = { registerCostCommands };

