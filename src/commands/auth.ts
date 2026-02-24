// @ts-nocheck
const chalkImport = require("chalk");
const chalk = chalkImport.default || chalkImport;

const { getConfig, setConfig, clearConfig, getDefaultGraphVersion } = require("../lib/config");
const { redactToken } = require("../lib/redact");
const { logger } = require("../lib/logger");
const { loadTsConfigBridge } = require("../lib/ts-bridge");

function registerAuthCommands(program) {
  const auth = program.command("auth").description("configure WhatsApp Cloud API auth");

  auth
    .command("login")
    .description("store token + IDs locally (file-based; prefer env vars for stricter security)")
    .requiredOption("--token <token>", "permanent access token")
    .requiredOption("--phone-id <id>", "phone number ID")
    .requiredOption("--business-id <id>", "WABA (WhatsApp Business Account) ID")
    .option("--client <name>", "client name (default: active client or 'default')")
    .option("--graph-version <ver>", `Graph API version (default: ${getDefaultGraphVersion()})`)
    .option("--base-url <url>", "Graph base URL (default: https://graph.facebook.com)")
    .action(async (opts) => {
      const prev = await getConfig();
      const client = opts.client || prev.activeClient || "default";
      const patch = {
        graphVersion: opts.graphVersion || getDefaultGraphVersion(),
        baseUrl: opts.baseUrl,
        activeClient: client,
        clients: {
          ...(prev.clients || {}),
          [client]: {
            ...(prev.clients?.[client] || {}),
            token: opts.token,
            phoneNumberId: opts.phoneId,
            wabaId: opts.businessId
          }
        }
      };
      const { path } = await setConfig(patch); // Legacy JS runtime path.

      // TS migration bridge: mirror canonical fields for TS runtime if available.
      try {
        const ts = await loadTsConfigBridge();
        if (ts) {
          await ts.writeConfig({
            token: String(opts.token),
            phoneNumberId: String(opts.phoneId),
            businessId: String(opts.businessId),
            graphVersion: opts.graphVersion || getDefaultGraphVersion(),
            baseUrl: opts.baseUrl ? String(opts.baseUrl) : undefined
          });
        }
      } catch (err) {
        logger.warn(`TS auth bridge unavailable, continuing with legacy config: ${err?.message || err}`);
      }

      logger.ok(`Saved auth to ${path}`);
      logger.warn("Security: token is stored in a local config file. For stricter security, set WABA_TOKEN env var instead.");
      logger.info(`Token: ${redactToken(opts.token)}`);
      logger.info(`Phone number ID: ${opts.phoneId}`);
      logger.info(`WABA ID: ${opts.businessId}`);
    });

  auth
    .command("status")
    .description("show current auth config (redacted)")
    .action(async (_opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const cfg = await getConfig();
      let merged = { ...cfg, businessId: cfg.wabaId || null };
      try {
        const ts = await loadTsConfigBridge();
        if (ts) {
          const tcfg = await ts.readConfig();
          merged = {
            ...merged,
            token: tcfg.token || merged.token,
            phoneNumberId: tcfg.phoneNumberId || merged.phoneNumberId,
            businessId: tcfg.businessId || merged.businessId,
            graphVersion: tcfg.graphVersion || merged.graphVersion,
            baseUrl: tcfg.baseUrl || merged.baseUrl
          };
        }
      } catch (err) {
        logger.warn(`TS auth status bridge unavailable, falling back to legacy config: ${err?.message || err}`);
      }

      const token = merged.token ? redactToken(merged.token) : "(missing)";
      const phone = merged.phoneNumberId || "(missing)";
      const businessId = merged.businessId || "(missing)";
      const graph = `${merged.baseUrl || "https://graph.facebook.com"}/${merged.graphVersion || getDefaultGraphVersion()}`;
      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, auth: { graph, token, phoneNumberId: phone, businessId } }, null, 2));
        return;
      }
      logger.info(`Graph: ${graph}`);
      logger.info(`Token: ${chalk.gray(token)}`);
      logger.info(`Phone number ID: ${phone}`);
      logger.info(`Business ID: ${businessId}`);
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
