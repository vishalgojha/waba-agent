const chalk = require("chalk");

const { getConfig, setConfig, clearConfig, getDefaultGraphVersion } = require("../lib/config");
const { redactToken } = require("../lib/redact");
const { logger } = require("../lib/logger");

function registerAuthCommands(program) {
  const auth = program.command("auth").description("configure WhatsApp Cloud API auth");

  auth
    .command("login")
    .description("store token + IDs locally (file-based; prefer env vars for stricter security)")
    .requiredOption("--token <token>", "permanent access token")
    .requiredOption("--phone-id <id>", "phone number ID")
    .requiredOption("--business-id <id>", "WABA (WhatsApp Business Account) ID")
    .option("--graph-version <ver>", `Graph API version (default: ${getDefaultGraphVersion()})`)
    .option("--base-url <url>", "Graph base URL (default: https://graph.facebook.com)")
    .action(async (opts) => {
      const patch = {
        token: opts.token,
        phoneNumberId: opts.phoneId,
        wabaId: opts.businessId,
        graphVersion: opts.graphVersion || getDefaultGraphVersion(),
        baseUrl: opts.baseUrl
      };
      const { path } = await setConfig(patch);
      logger.ok(`Saved auth to ${path}`);
      logger.warn("Security: token is stored in a local config file. For stricter security, set WABA_TOKEN env var instead.");
      logger.info(`Token: ${redactToken(opts.token)}`);
      logger.info(`Phone number ID: ${opts.phoneId}`);
      logger.info(`WABA ID: ${opts.businessId}`);
    });

  auth
    .command("status")
    .description("show current auth config (redacted)")
    .action(async () => {
      const cfg = await getConfig();
      const token = cfg.token ? redactToken(cfg.token) : "(missing)";
      const phone = cfg.phoneNumberId || "(missing)";
      const wabaId = cfg.wabaId || "(missing)";
      const graph = `${cfg.baseUrl || "https://graph.facebook.com"}/${cfg.graphVersion || getDefaultGraphVersion()}`;
      logger.info(`Graph: ${graph}`);
      logger.info(`Token: ${chalk.gray(token)}`);
      logger.info(`Phone number ID: ${phone}`);
      logger.info(`WABA ID: ${wabaId}`);
    });

  auth
    .command("logout")
    .description("remove stored token from local config")
    .action(async () => {
      const { path } = await clearConfig(["token"]);
      logger.ok(`Cleared token from ${path}`);
      logger.warn("If you also exported WABA_TOKEN in your shell, unset it separately.");
    });
}

module.exports = { registerAuthCommands };

