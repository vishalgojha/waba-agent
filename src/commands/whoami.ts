// @ts-nocheck
const { getConfig } = require("../lib/config");
const { buildReadiness } = require("../lib/readiness");
const { logger } = require("../lib/logger");

function buildWhoamiView(cfg = {}) {
  const readiness = buildReadiness(cfg, {});
  const next = readiness.overallReady ? "waba go" : "waba fix";
  return {
    client: readiness.client || cfg.activeClient || "default",
    metaConnected: !!readiness.metaReady,
    webhookReady: !!readiness.webhookReady,
    aiReady: !!readiness.aiReady,
    ready: !!readiness.overallReady,
    next
  };
}

function registerWhoamiCommands(program) {
  program
    .command("whoami")
    .description("show current setup identity and the one next command to run")
    .action(async (_opts, cmd) => {
      const root = cmd.parent || program;
      const json = !!root.opts()?.json;
      const cfg = await getConfig();
      const out = buildWhoamiView(cfg);

      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, ...out }, null, 2));
        return;
      }

      logger.info(`Client: ${out.client}`);
      logger.info(`Meta connected: ${out.metaConnected ? "yes" : "no"}`);
      logger.info(`Webhook ready: ${out.webhookReady ? "yes" : "no"}`);
      logger.info(`AI ready: ${out.aiReady ? "yes" : "no"}`);
      logger.info(`Ready: ${out.ready ? "yes" : "no"}`);
      logger.info(`Next: ${out.next}`);
    });
}

module.exports = {
  registerWhoamiCommands,
  buildWhoamiView
};
