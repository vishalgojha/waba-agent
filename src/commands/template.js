const { getConfig } = require("../lib/config");
const { WhatsAppCloudApi } = require("../lib/whatsapp");
const { logger } = require("../lib/logger");
const { saveDraft, loadDraft, listDrafts } = require("../lib/template-drafts");
const { readMemory } = require("../lib/memory");

async function createOrSubmitTemplate(opts, { json }) {
  const cfg = await getConfig();
  const client = opts.client || cfg.activeClient || "default";

  let examples = null;
  if (opts.examples) {
    try {
      examples = JSON.parse(opts.examples);
    } catch (err) {
      throw new Error(`Invalid --examples JSON: ${err?.message || err}`);
    }
  }

  // If BODY not provided, try draft.
  let draft = null;
  if (!opts.body) draft = await loadDraft(client, opts.name);
  const bodyText = opts.body || draft?.components?.find?.((c) => c.type === "BODY")?.text ||
    "Thanks for contacting us. Please share your requirement and location.";

  const components = [];
  if (opts.headerText) {
    components.push({ type: "HEADER", format: "TEXT", text: String(opts.headerText) });
  }
  components.push({
    type: "BODY",
    text: String(bodyText),
    ...(examples ? { example: examples } : {})
  });
  if (opts.footer) components.push({ type: "FOOTER", text: String(opts.footer) });

  const payloadDraft = {
    name: opts.name,
    language: opts.language,
    category: opts.category,
    components
  };

  if (opts.saveDraft) {
    const p = await saveDraft(client, payloadDraft);
    if (!json) logger.ok(`Draft saved: ${p}`);
  }

  const api = new WhatsAppCloudApi({
    token: cfg.token,
    phoneNumberId: cfg.phoneNumberId,
    wabaId: cfg.wabaId,
    graphVersion: cfg.graphVersion || "v20.0",
    baseUrl: cfg.baseUrl
  });

  const data = await api.createTemplate(payloadDraft);
  if (json) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ok: true, data }, null, 2));
    return;
  }
  logger.ok("Template create submitted.");
  logger.info(JSON.stringify(data, null, 2));
}

function registerTemplateCommands(program) {
  const t = program.command("template").description("manage message templates");

  t.command("list")
    .description("list message templates (requires business/WABA ID)")
    .option("--limit <n>", "limit", (v) => Number(v), 50)
    .action(async (opts, cmd) => {
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
      const data = await api.listTemplates({ limit: opts.limit });
      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, data }, null, 2));
        return;
      }
      const rows = data?.data || [];
      logger.info(`Templates: ${rows.length}`);
      for (const r of rows) {
        logger.info(`${r.name} (${r.language}) - ${r.status} - ${r.category}`);
      }
    });

  t.command("preview")
    .description("preview a template by replacing {{1}}, {{2}} placeholders using provided params")
    .requiredOption("--name <name>", "template name")
    .option("--client <name>", "client name (default: active client)")
    .option("--language <code>", "optional language filter")
    .option("--params <json>", "JSON array params for BODY placeholders", "[]")
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const cfg = await getConfig();
      const client = opts.client || cfg.activeClient || "default";

      const api = new WhatsAppCloudApi({
        token: cfg.token,
        phoneNumberId: cfg.phoneNumberId,
        wabaId: cfg.wabaId,
        graphVersion: cfg.graphVersion || "v20.0",
        baseUrl: cfg.baseUrl
      });

      let params;
      try {
        params = JSON.parse(opts.params);
      } catch (err) {
        throw new Error(`Invalid --params JSON: ${err?.message || err}`);
      }
      if (!Array.isArray(params)) throw new Error("--params must be a JSON array.");

      const tmpl = await api.getTemplateByName({ name: opts.name });
      if (!tmpl) throw new Error("Template not found.");
      if (opts.language && tmpl.language !== opts.language) logger.warn(`Language mismatch. Found ${tmpl.language}`);

      const bodyComp = (tmpl.components || []).find((c) => c.type === "BODY");
      const headerComp = (tmpl.components || []).find((c) => c.type === "HEADER");
      const footerComp = (tmpl.components || []).find((c) => c.type === "FOOTER");

      const render = (text) => {
        let out = String(text || "");
        for (let i = 0; i < params.length; i++) {
          const k = `{{${i + 1}}}`;
          out = out.split(k).join(String(params[i]));
        }
        return out;
      };

      const preview = {
        client,
        name: tmpl.name,
        language: tmpl.language,
        status: tmpl.status,
        category: tmpl.category,
        header: headerComp?.format === "TEXT" ? render(headerComp?.text) : null,
        body: render(bodyComp?.text),
        footer: footerComp?.text || null
      };

      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, preview }, null, 2));
        return;
      }
      logger.info(JSON.stringify(preview, null, 2));
    });

  t.command("create")
    .description("create a message template (submitted for approval automatically by Meta)")
    .requiredOption("--name <name>", "template name (lowercase, numbers, underscore)")
    .requiredOption("--category <MARKETING|UTILITY|AUTHENTICATION>", "category")
    .option("--language <code>", "language (example: en_US)", "en_US")
    .option("--body <text>", "BODY text. Use {{1}}, {{2}} for variables.")
    .option("--header-text <text>", "TEXT header")
    .option("--footer <text>", "footer text")
    .option("--examples <json>", "example values JSON (body_text), for variable templates. Example: {\"body_text\":[[\"John\",\"Tomorrow\"]]}")
    .option("--client <name>", "client name (default: active client)")
    .option("--save-draft", "save draft locally under ~/.waba/context/<client>/templates/<name>.json", false)
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      await createOrSubmitTemplate(opts, { json });
    });

  t.command("submit-for-approval")
    .description("submit a template for approval (alias of create; will use local draft if present)")
    .requiredOption("--name <name>", "template name")
    .requiredOption("--category <MARKETING|UTILITY|AUTHENTICATION>", "category")
    .option("--language <code>", "language", "en_US")
    .option("--body <text>", "BODY text (optional if draft exists)")
    .option("--header-text <text>", "TEXT header")
    .option("--footer <text>", "footer text")
    .option("--examples <json>", "examples JSON")
    .option("--client <name>", "client name (default: active client)")
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      await createOrSubmitTemplate(opts, { json });
    });

  t.command("drafts")
    .description("list local template drafts for a client")
    .option("--client <name>", "client name (default: active client)")
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const cfg = await getConfig();
      const client = opts.client || cfg.activeClient || "default";
      const drafts = await listDrafts(client);
      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, client, drafts }, null, 2));
        return;
      }
      logger.info(`Drafts (${client}): ${drafts.length}`);
      for (const d of drafts) logger.info(d);
    });

  t.command("analytics")
    .description("local template analytics from memory logs (best-effort)")
    .option("--client <name>", "client name (default: active client)")
    .option("--days <n>", "lookback window", (v) => Number(v), 30)
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const cfg = await getConfig();
      const client = opts.client || cfg.activeClient || "default";
      const days = opts.days;

      const events = await readMemory(client, { limit: 50_000 });
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      const recent = events.filter((e) => {
        const ts = Date.parse(e.ts || "");
        return Number.isFinite(ts) && ts >= cutoff;
      });

      const outboundTemplates = recent.filter((e) => e.type === "outbound_sent" && e.kind === "template");
      const byName = {};
      for (const e of outboundTemplates) {
        const name = e.templateName || e.template_name || e.name || "unknown";
        byName[name] = byName[name] || { sent: 0, marketing: 0, utility: 0, unknownCategory: 0 };
        byName[name].sent += 1;
        const cat = String(e.category || "").toLowerCase();
        if (cat === "marketing") byName[name].marketing += 1;
        else if (cat === "utility") byName[name].utility += 1;
        else byName[name].unknownCategory += 1;
      }

      const out = {
        client,
        days,
        totals: { sentTemplates: outboundTemplates.length },
        templates: byName
      };

      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, out }, null, 2));
        return;
      }
      logger.info(JSON.stringify(out, null, 2));
    });
}

module.exports = { registerTemplateCommands };
