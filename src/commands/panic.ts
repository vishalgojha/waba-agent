// @ts-nocheck
const { logger } = require("../lib/logger");
const { readConfigRaw, writeConfigRaw, normalizeMultiClient } = require("../lib/config");

const KEEP_KEYS = new Set([
  "activeClient",
  "clients",
  "graphVersion",
  "baseUrl",
  "webhookVerifyToken",
  "appSecret",
  "pricing"
]);

function sanitizeConfigForPanic(raw = {}) {
  const cfg = normalizeMultiClient(raw);
  const out = {};
  for (const k of Object.keys(cfg)) {
    if (KEEP_KEYS.has(k)) out[k] = cfg[k];
  }
  if (!out.activeClient) out.activeClient = "default";
  if (!out.clients || typeof out.clients !== "object") out.clients = { default: {} };
  return out;
}

function summarizePanicDiff(before = {}, after = {}) {
  const removed = Object.keys(before).filter((k) => !(k in after)).sort();
  const kept = Object.keys(after).sort();
  return { removed, kept };
}

function registerPanicCommands(program) {
  program
    .command("panic")
    .description("safe reset: keep client credentials, clear advanced local config noise")
    .action(async (_opts, cmd) => {
      const root = cmd.parent || program;
      const json = !!root.opts()?.json;

      const before = normalizeMultiClient(await readConfigRaw());
      const after = sanitizeConfigForPanic(before);
      let path = null;
      let diff = summarizePanicDiff(before, after);
      try {
        path = await writeConfigRaw(after);
      } catch (err) {
        if (json) {
          // eslint-disable-next-line no-console
          console.log(
            JSON.stringify(
              {
                ok: false,
                error: String(err?.message || err),
                next: "waba start"
              },
              null,
              2
            )
          );
          process.exitCode = 1;
          return;
        }
        logger.warn("Could not apply safe reset automatically.");
        logger.warn(`Reason: ${err?.message || err}`);
        logger.info("Next: waba start");
        process.exitCode = 1;
        return;
      }

      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, path, ...diff, next: "waba start" }, null, 2));
        return;
      }

      logger.ok("Safe reset complete.");
      logger.info(`Config updated: ${path}`);
      logger.info(`Removed advanced keys: ${diff.removed.length ? diff.removed.join(", ") : "(none)"}`);
      logger.info("Next: waba start");
    });
}

module.exports = {
  registerPanicCommands,
  sanitizeConfigForPanic,
  summarizePanicDiff
};
