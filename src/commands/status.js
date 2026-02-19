const fs = require("fs-extra");
const path = require("path");
const { pathToFileURL } = require("url");
const { getConfig } = require("../lib/config");
const { redactToken } = require("../lib/redact");
const { logger } = require("../lib/logger");
const { buildReadiness } = require("../lib/readiness");

async function loadTsConfigBridge() {
  const root = path.resolve(__dirname, "..", "..");
  const configJs = path.join(root, ".tmp-ts", "src-ts", "config.js");
  if (!(await fs.pathExists(configJs))) return null;
  const mod = await import(pathToFileURL(configJs).href);
  if (!mod?.readConfig) return null;
  return { readConfig: mod.readConfig };
}

function registerStatusCommands(program) {
  program
    .command("status")
    .description("show setup readiness for a client")
    .option("--client <name>", "client name (default: active client)")
    .action(async (opts, cmd) => {
      const root = cmd.parent || program;
      const { json } = root.opts();
      let cfg = await getConfig();
      if (!opts.client) {
        // Prefer TS config resolution during migration.
        try {
          const ts = await loadTsConfigBridge();
          if (ts) {
            const tsCfg = await ts.readConfig();
            cfg = {
              ...cfg,
              token: tsCfg.token || cfg.token,
              phoneNumberId: tsCfg.phoneNumberId || cfg.phoneNumberId,
              wabaId: tsCfg.businessId || cfg.wabaId,
              graphVersion: tsCfg.graphVersion || cfg.graphVersion,
              baseUrl: tsCfg.baseUrl || cfg.baseUrl,
              webhookUrl: tsCfg.webhookUrl || cfg.webhookUrl,
              webhookVerifyToken: tsCfg.webhookVerifyToken || cfg.webhookVerifyToken
            };
          }
        } catch (err) {
          logger.warn(`TS status bridge unavailable, falling back to legacy config: ${err?.message || err}`);
        }
      }
      const out = buildReadiness(cfg, { client: opts.client });
      const payload = {
        ...out,
        creds: {
          token: out.creds.token ? redactToken(out.creds.token) : null,
          phoneNumberId: out.creds.phoneNumberId,
          wabaId: out.creds.wabaId,
          businessId: out.creds.wabaId
        },
        webhookVerifyToken: cfg.webhookVerifyToken ? "***set***" : null
      };

      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, status: payload }, null, 2));
        return;
      }

      logger.info(`Client: ${payload.client}${payload.client === payload.activeClient ? " (active)" : ""}`);
      logger.info(`Meta credentials: ${payload.metaReady ? "ready" : "missing"}`);
      logger.info(`Webhook verify token: ${payload.webhookVerifyToken ? "set" : "missing"}`);
      logger.info(`AI provider: ${payload.ai.provider || "(none)"}${payload.aiReady ? "" : " (missing key/model)"}`);
      logger.info(`Overall: ${payload.overallReady ? "ready" : "needs setup"}`);

      if (payload.missing.length) {
        logger.warn(`Missing: ${payload.missing.join(", ")}`);
      } else {
        logger.ok("All required setup checks are green.");
      }
    });
}

module.exports = { registerStatusCommands };
