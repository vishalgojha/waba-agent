// @ts-nocheck
const { getConfig } = require("../lib/config");
const { logger } = require("../lib/logger");
const { createWizardPrompter } = require("../lib/wizard/prompter");
const { WizardCancelledError } = require("../lib/wizard/prompts");
const { buildWhoamiView } = require("./whoami");
const { runGuidedDemo } = require("./demo");

function buildTourSnapshot(whoami, check) {
  return {
    whoami: {
      client: whoami.client,
      metaConnected: !!whoami.metaConnected,
      webhookReady: !!whoami.webhookReady,
      ready: !!whoami.ready
    },
    check: {
      ok: !!check.ok,
      passCount: Number(check.smoke?.passCount || 0),
      total: Number(check.smoke?.total || 0)
    },
    next: check.ok ? "waba go" : "waba fix"
  };
}

function registerTourCommands(program) {
  program
    .command("tour")
    .alias("walkthrough")
    .description("30-second beginner walkthrough: whoami -> check -> next")
    .action(async (_opts, cmd) => {
      const root = cmd.parent || program;
      const json = !!root.opts()?.json;

      const cfg = await getConfig();
      const whoami = buildWhoamiView(cfg);
      const check = await runGuidedDemo({ autoFix: true, scopeCheckMode: "best-effort" });
      const snap = buildTourSnapshot(whoami, check);

      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, ...snap }, null, 2));
        return;
      }

      logger.info("WABA Tour");
      logger.info("Step 1/3 - Identity");
      logger.info(`Client: ${snap.whoami.client}`);
      logger.info(`Meta connected: ${snap.whoami.metaConnected ? "yes" : "no"}`);
      logger.info(`Webhook ready: ${snap.whoami.webhookReady ? "yes" : "no"}`);

      logger.info("Step 2/3 - Health");
      logger.info(`Checks passed: ${snap.check.passCount}/${snap.check.total}`);
      logger.info(`Ready: ${snap.check.ok ? "yes" : "no"}`);

      logger.info("Step 3/3 - Next action");
      logger.info(`Run: ${snap.next}`);

      if (process.stdin.isTTY && process.stdout.isTTY) {
        const prompter = createWizardPrompter();
        try {
          const proceed = await prompter.confirm({
            message: `Open next flow now (${snap.next})?`,
            initialValue: true
          });
          if (proceed) logger.info(`Please run now: ${snap.next}`);
        } catch (err) {
          if (err instanceof WizardCancelledError) return;
          throw err;
        }
      }
    });
}

module.exports = {
  registerTourCommands,
  buildTourSnapshot
};
