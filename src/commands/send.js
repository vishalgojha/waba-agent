const { getConfig } = require("../lib/config");
const { WhatsAppCloudApi } = require("../lib/whatsapp");
const { logger } = require("../lib/logger");

function tryParseJson(s) {
  if (!s) return undefined;
  try {
    return JSON.parse(s);
  } catch (err) {
    throw new Error(`Invalid JSON: ${err?.message || err}`);
  }
}

function registerSendCommands(program) {
  const s = program.command("send").description("send outbound messages (costs money)");

  s.command("template")
    .description("send a pre-approved template message")
    .argument("<to_number>", "E.164 without + (example: 9198xxxxxx)")
    .requiredOption("--template-name <name>", "template name")
    .requiredOption("--language <code>", "language code (example: en)")
    .option("--params <json>", "template params JSON: array for body params OR object for components")
    .action(async (to, opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const cfg = await getConfig();
      const api = new WhatsAppCloudApi({
        token: cfg.token,
        phoneNumberId: cfg.phoneNumberId,
        wabaId: cfg.wabaId,
        graphVersion: cfg.graphVersion || "v20.0",
        baseUrl: cfg.baseUrl
      });
      logger.warn("Costs: per-message billed (India approx: ~₹0.11 utility, ~₹0.78 marketing; verify current rates in Meta).");
      const data = await api.sendTemplate({
        to,
        templateName: opts.templateName,
        language: opts.language,
        params: tryParseJson(opts.params)
      });
      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, data }, null, 2));
        return;
      }
      logger.ok(`Sent template to ${to}`);
      logger.info(JSON.stringify(data, null, 2));
    });

  s.command("text")
    .description("send a text message (session/outbound rules apply)")
    .argument("<to_number>", "E.164 without + (example: 9198xxxxxx)")
    .requiredOption("--body <text>", "text body")
    .option("--preview-url", "enable URL previews", false)
    .action(async (to, opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const cfg = await getConfig();
      const api = new WhatsAppCloudApi({
        token: cfg.token,
        phoneNumberId: cfg.phoneNumberId,
        wabaId: cfg.wabaId,
        graphVersion: cfg.graphVersion || "v20.0",
        baseUrl: cfg.baseUrl
      });
      logger.warn("Costs: per-message billed (India approx: ~₹0.11 utility, ~₹0.78 marketing; verify current rates in Meta).");
      const data = await api.sendText({ to, body: opts.body, previewUrl: !!opts.previewUrl });
      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, data }, null, 2));
        return;
      }
      logger.ok(`Sent text to ${to}`);
      logger.info(JSON.stringify(data, null, 2));
    });
}

module.exports = { registerSendCommands };
