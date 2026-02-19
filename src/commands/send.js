const { getConfig } = require("../lib/config");
const { WhatsAppCloudApi } = require("../lib/whatsapp");
const { logger } = require("../lib/logger");
const { isOptedOut } = require("../lib/optout-store");
const { requireClientCreds } = require("../lib/creds");
const fs = require("fs-extra");
const path = require("path");
const { pathToFileURL } = require("url");

async function loadTsSendBridge() {
  const root = path.resolve(__dirname, "..", "..");
  const executorJs = path.join(root, ".tmp-ts", "src-ts", "engine", "executor.js");
  const schemaJs = path.join(root, ".tmp-ts", "src-ts", "engine", "schema.js");
  if (!(await fs.pathExists(executorJs)) || !(await fs.pathExists(schemaJs))) return null;

  const execMod = await import(pathToFileURL(executorJs).href);
  const schemaMod = await import(pathToFileURL(schemaJs).href);
  if (!execMod?.executeIntent || !schemaMod?.validateIntent) return null;
  return {
    executeIntent: execMod.executeIntent,
    validateIntent: schemaMod.validateIntent
  };
}

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
    .option("--category <utility|marketing>", "category tag for local analytics (does not affect Meta)", "utility")
    .option("--params <json>", "template params JSON: array for body params OR object for components")
    .option("--client <name>", "client name (default: active client)")
    .action(async (to, opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const cfg = await getConfig();
      const creds = requireClientCreds(cfg, opts.client);
      if (await isOptedOut(creds.client, to)) {
        throw new Error("Recipient is opted out. Use `waba optout check <number>` to verify.");
      }
      logger.warn("Costs: per-message billed (India approx: ~INR 0.11 utility, ~INR 0.78 marketing; verify current rates in Meta).");
      let data;
      const params = tryParseJson(opts.params);
      try {
        const ts = await loadTsSendBridge();
        if (ts) {
          const intent = ts.validateIntent({
            action: "send_template",
            business_id: String(creds.wabaId || ""),
            phone_number_id: String(creds.phoneNumberId || ""),
            payload: {
              to,
              templateName: opts.templateName,
              language: opts.language,
              ...(params !== undefined ? { params } : {})
            },
            risk: "HIGH"
          });
          const out = await ts.executeIntent(intent, {
            token: String(creds.token || ""),
            businessId: String(creds.wabaId || ""),
            phoneNumberId: String(creds.phoneNumberId || ""),
            graphVersion: String(cfg.graphVersion || "v20.0"),
            baseUrl: String(cfg.baseUrl || "https://graph.facebook.com")
          });
          data = out.output;
        }
      } catch (err) {
        logger.warn(`TS send bridge unavailable for template, falling back to JS path: ${err?.message || err}`);
      }
      if (data === undefined) {
        const api = new WhatsAppCloudApi({
          token: creds.token,
          phoneNumberId: creds.phoneNumberId,
          wabaId: creds.wabaId,
          graphVersion: cfg.graphVersion || "v20.0",
          baseUrl: cfg.baseUrl
        });
        data = await api.sendTemplate({
          to,
          templateName: opts.templateName,
          language: opts.language,
          params
        });
      }
      // best-effort local analytics tagging
      try {
        const { appendMemory } = require("../lib/memory");
        await appendMemory(creds.client, { type: "outbound_sent", kind: "template", to, category: opts.category });
      } catch {}
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
    .option("--category <utility|marketing>", "category tag for local analytics (does not affect Meta)", "utility")
    .option("--preview-url", "enable URL previews", false)
    .option("--client <name>", "client name (default: active client)")
    .action(async (to, opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const cfg = await getConfig();
      const creds = requireClientCreds(cfg, opts.client);
      if (await isOptedOut(creds.client, to)) {
        throw new Error("Recipient is opted out. Use `waba optout check <number>` to verify.");
      }
      logger.warn("Costs: per-message billed (India approx: ~INR 0.11 utility, ~INR 0.78 marketing; verify current rates in Meta).");
      let data;
      try {
        const ts = await loadTsSendBridge();
        if (ts) {
          const intent = ts.validateIntent({
            action: "send_text",
            business_id: String(creds.wabaId || ""),
            phone_number_id: String(creds.phoneNumberId || ""),
            payload: {
              to,
              body: String(opts.body || ""),
              previewUrl: !!opts.previewUrl
            },
            risk: "HIGH"
          });
          const out = await ts.executeIntent(intent, {
            token: String(creds.token || ""),
            businessId: String(creds.wabaId || ""),
            phoneNumberId: String(creds.phoneNumberId || ""),
            graphVersion: String(cfg.graphVersion || "v20.0"),
            baseUrl: String(cfg.baseUrl || "https://graph.facebook.com")
          });
          data = out.output;
        }
      } catch (err) {
        logger.warn(`TS send bridge unavailable for text, falling back to JS path: ${err?.message || err}`);
      }
      if (data === undefined) {
        const api = new WhatsAppCloudApi({
          token: creds.token,
          phoneNumberId: creds.phoneNumberId,
          wabaId: creds.wabaId,
          graphVersion: cfg.graphVersion || "v20.0",
          baseUrl: cfg.baseUrl
        });
        data = await api.sendText({ to, body: opts.body, previewUrl: !!opts.previewUrl });
      }
      try {
        const { appendMemory } = require("../lib/memory");
        await appendMemory(creds.client, { type: "outbound_sent", kind: "text", to, category: opts.category });
      } catch {}
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
