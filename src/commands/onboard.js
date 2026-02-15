const crypto = require("crypto");

const { getConfig, setConfig } = require("../lib/config");
const { addOrUpdateClient } = require("../lib/clients");
const { createAgentContext } = require("../lib/agent/agent");
const { askInput, askYesNo } = require("../lib/prompt");
const { logger } = require("../lib/logger");

function base64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function registerOnboardCommands(program) {
  program
    .command("onboard")
    .description("client onboarding wizard (prints next steps and writes safe local config)")
    .option("--client <name>", "client name", "default")
    .option("--non-interactive", "do not prompt; only print required steps", false)
    .action(async (opts, cmd) => {
      const root = cmd.parent || program;
      const { json, memory } = root.opts();
      if (json) throw new Error("--json not supported for onboarding wizard.");

      const cfg = await getConfig();
      const client = opts.client || cfg.activeClient || "default";

      logger.info(`Onboarding client: ${client}`);

      let token = null;
      let phoneId = null;
      let businessId = null;
      let publicUrl = null;

      if (!opts.nonInteractive) {
        token = await askInput("Permanent access token:");
        phoneId = await askInput("Phone number ID:");
        businessId = await askInput("WABA ID (business account id):");
        publicUrl = await askInput("Public URL for webhooks (ngrok or server). Example: https://xxxx.ngrok-free.app");
      }

      if (token && phoneId && businessId) {
        await addOrUpdateClient(client, { token, phoneNumberId: phoneId, wabaId: businessId }, { makeActive: true });
        logger.ok("Saved client credentials (active client updated).");
      } else {
        logger.warn("Credentials not captured. You can set them later:");
        logger.info(`waba clients add ${client} --token <TOKEN> --phone-id <PHONE_ID> --business-id <WABA_ID> --switch`);
      }

      // Ensure per-client scaffold exists.
      const ctx = await createAgentContext({ client, memoryEnabled: memory !== false });
      try {
        const tool = ctx.registry.get("client.init");
        if (tool) await tool.execute(ctx, { client });
        logger.ok("Created/verified client config scaffold (~/.waba/context/<client>/client.json).");
      } catch (err) {
        logger.warn(`client.init failed: ${err?.message || err}`);
      }

      // Verify token for webhooks.
      let verifyToken = cfg.webhookVerifyToken;
      if (!verifyToken) {
        verifyToken = base64url(crypto.randomBytes(24));
        await setConfig({ webhookVerifyToken: verifyToken });
        logger.ok("Generated webhook verify token and saved to config.");
      }

      if (publicUrl) {
        const normalized = String(publicUrl).replace(/\/+$/, "");
        logger.info("Meta webhook setup values:");
        logger.info(`Callback URL: ${normalized}/webhook`);
        logger.info(`Verify token: ${verifyToken}`);
      } else {
        logger.info("Webhook setup next step:");
        logger.info("waba webhook setup --url <PUBLIC_URL>");
      }

      logger.info("Start receiver:");
      logger.info("waba webhook start --port 3000 --ngrok --verbose");

      const wantsSheets = opts.nonInteractive ? false : await askYesNo("Configure Google Sheets lead sync now?", { defaultYes: false });
      if (wantsSheets) {
        logger.info("1) waba integrate google-sheets --print-apps-script");
        logger.info("2) Deploy as Web App, then:");
        logger.info(`   waba integrate google-sheets --client ${client} --apps-script-url "<URL>" --test`);
        logger.info(`   waba sync leads --to sheets --client ${client} --days 30`);
      }
    });
}

module.exports = { registerOnboardCommands };

