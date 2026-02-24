// @ts-nocheck
const { getConfig } = require("../lib/config");
const { WhatsAppCloudApi } = require("../lib/whatsapp");
const { logger } = require("../lib/logger");
const { saveDraft, loadDraft, listDrafts } = require("../lib/template-drafts");
const { readMemory } = require("../lib/memory");
const { requireClientCreds } = require("../lib/creds");
const { loadTsMetaClientBridge } = require("../lib/ts-bridge");

function parseDurationMs(s) {
  const t = String(s || "").trim().toLowerCase();
  if (!t) return null;
  const m = t.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  const u = m[2] || "ms";
  if (!Number.isFinite(n) || n < 0) return null;
  if (u === "ms") return Math.floor(n);
  if (u === "s") return Math.floor(n * 1000);
  if (u === "m") return Math.floor(n * 60_000);
  if (u === "h") return Math.floor(n * 3_600_000);
  return null;
}

function stableStringify(obj) {
  const seen = new WeakSet();
  const sorter = (x) => {
    if (!x || typeof x !== "object") return x;
    if (seen.has(x)) return "[Circular]";
    seen.add(x);
    if (Array.isArray(x)) return x.map(sorter);
    const out = {};
    for (const k of Object.keys(x).sort()) out[k] = sorter(x[k]);
    return out;
  };
  return JSON.stringify(sorter(obj), null, 2);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function createJsTemplateApi(cfg, creds) {
  return new WhatsAppCloudApi({
    token: creds.token,
    phoneNumberId: creds.phoneNumberId,
    wabaId: creds.wabaId,
    graphVersion: cfg.graphVersion || "v20.0",
    baseUrl: cfg.baseUrl
  });
}

function findTemplateByName(data, name) {
  const rows = data?.data || [];
  const n = String(name || "").trim();
  if (!n) return null;
  return rows.find((r) => r.name === n) || null;
}

async function getTemplateByNameTsFirst(cfg, creds, name, limit = 200) {
  try {
    const ts = await loadTsMetaClientBridge();
    if (ts) {
      const api = new ts.MetaClient({
        token: String(creds.token || ""),
        phoneNumberId: String(creds.phoneNumberId || ""),
        businessId: String(creds.wabaId || ""),
        graphVersion: String(cfg.graphVersion || "v20.0"),
        baseUrl: String(cfg.baseUrl || "https://graph.facebook.com")
      });
      const out = await api.listTemplates();
      const sliced = out && typeof out === "object" && Array.isArray(out.data)
        ? { ...out, data: out.data.slice(0, Number(limit || 200)) }
        : out;
      const tmpl = findTemplateByName(sliced, name);
      if (tmpl) return tmpl;
    }
  } catch (err) {
    logger.warn(`TS template lookup unavailable, falling back to JS path: ${err?.message || err}`);
  }

  const api = createJsTemplateApi(cfg, creds);
  return api.getTemplateByName({ name, limit });
}

async function createOrSubmitTemplate(opts, { json }) {
  const cfg = await getConfig();
  const client = opts.client || cfg.activeClient || "default";
  const creds = requireClientCreds(cfg, client);

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
    token: creds.token,
    phoneNumberId: creds.phoneNumberId,
    wabaId: creds.wabaId,
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
    .description("list message templates (legacy route; prefer `waba ts templates`)")
    .option("--limit <n>", "limit", (v) => Number(v), 50)
    .option("--client <name>", "client name (default: active client)")
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const cfg = await getConfig();
      const creds = requireClientCreds(cfg, opts.client);
      logger.warn("Migration note: `waba template list` prefers TS runtime. Use `waba ts templates` for direct TS path.");
      let data;
      try {
        const ts = await loadTsMetaClientBridge();
        if (ts) {
          const api = new ts.MetaClient({
            token: String(creds.token || ""),
            phoneNumberId: String(creds.phoneNumberId || ""),
            businessId: String(creds.wabaId || ""),
            graphVersion: String(cfg.graphVersion || "v20.0"),
            baseUrl: String(cfg.baseUrl || "https://graph.facebook.com")
          });
          const out = await api.listTemplates();
          if (out && typeof out === "object" && Array.isArray(out.data)) {
            data = { ...out, data: out.data.slice(0, Number(opts.limit || 50)) };
          } else {
            data = out;
          }
        }
      } catch (err) {
        logger.warn(`TS template list bridge unavailable, falling back to JS path: ${err?.message || err}`);
      }
      if (data === undefined) {
        const api = new WhatsAppCloudApi({
          token: creds.token,
          phoneNumberId: creds.phoneNumberId,
          wabaId: creds.wabaId,
          graphVersion: cfg.graphVersion || "v20.0",
          baseUrl: cfg.baseUrl
        });
        data = await api.listTemplates({ limit: opts.limit });
      }
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

  t.command("status")
    .description("check template status by name")
    .requiredOption("--name <name>", "template name")
    .option("--limit <n>", "search limit", (v) => Number(v), 200)
    .option("--client <name>", "client name (default: active client)")
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const cfg = await getConfig();
      const creds = requireClientCreds(cfg, opts.client);
      const tmpl = await getTemplateByNameTsFirst(cfg, creds, opts.name, opts.limit);
      if (!tmpl) throw new Error("Template not found.");
      const out = {
        id: tmpl.id || null,
        name: tmpl.name,
        language: tmpl.language,
        category: tmpl.category,
        status: tmpl.status,
        quality_score: tmpl.quality_score || null,
        rejected_reason: tmpl.rejected_reason || tmpl.reason || null,
        last_updated_time: tmpl.last_updated_time || null
      };
      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, template: out }, null, 2));
        return;
      }
      logger.info(JSON.stringify(out, null, 2));
    });

  t.command("wait")
    .description("wait until a template becomes APPROVED or REJECTED (polls Graph)")
    .requiredOption("--name <name>", "template name")
    .option("--timeout <dur>", "timeout (example: 20m, 600s). default: 20m", "20m")
    .option("--interval <dur>", "poll interval (default: 20s)", "20s")
    .option("--limit <n>", "search limit", (v) => Number(v), 200)
    .option("--client <name>", "client name (default: active client)")
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const cfg = await getConfig();
      const creds = requireClientCreds(cfg, opts.client);
      const timeoutMs = parseDurationMs(opts.timeout);
      const intervalMs = parseDurationMs(opts.interval);
      if (!timeoutMs || timeoutMs < 1000) throw new Error("Invalid --timeout. Example: 20m");
      if (!intervalMs || intervalMs < 1000) throw new Error("Invalid --interval. Example: 20s");

      const start = Date.now();
      let last = null;
      while (Date.now() - start < timeoutMs) {
        const tmpl = await getTemplateByNameTsFirst(cfg, creds, opts.name, opts.limit);
        if (!tmpl) throw new Error("Template not found.");
        last = tmpl;
        const st = String(tmpl.status || "").toUpperCase();
        if (!json) logger.info(`status=${st} quality=${tmpl.quality_score || "-"} updated=${tmpl.last_updated_time || "-"}`);
        if (st === "APPROVED" || st === "REJECTED") break;
        await sleep(intervalMs);
      }

      if (!last) throw new Error("No status read.");
      const out = {
        name: last.name,
        status: last.status,
        rejected_reason: last.rejected_reason || last.reason || null,
        quality_score: last.quality_score || null
      };

      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, template: out }, null, 2));
        return;
      }
      logger.ok(`Final: ${out.status}`);
      if (out.rejected_reason) logger.warn(`reason: ${out.rejected_reason}`);
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
      const creds = requireClientCreds(cfg, client);

      let params;
      try {
        params = JSON.parse(opts.params);
      } catch (err) {
        throw new Error(`Invalid --params JSON: ${err?.message || err}`);
      }
      if (!Array.isArray(params)) throw new Error("--params must be a JSON array.");

      const tmpl = await getTemplateByNameTsFirst(cfg, creds, opts.name, 200);
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

  t.command("sync-drafts")
    .description("compare local template drafts with remote templates (best-effort)")
    .option("--client <name>", "client name (default: active client)")
    .option("--limit <n>", "remote search limit", (v) => Number(v), 200)
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const cfg = await getConfig();
      const client = opts.client || cfg.activeClient || "default";
      const creds = requireClientCreds(cfg, client);

      const api = new WhatsAppCloudApi({
        token: creds.token,
        phoneNumberId: creds.phoneNumberId,
        wabaId: creds.wabaId,
        graphVersion: cfg.graphVersion || "v20.0",
        baseUrl: cfg.baseUrl
      });

      const drafts = await listDrafts(client);
      const result = [];

      for (const name of drafts) {
        const draft = await loadDraft(client, name);
        const remote = await api.getTemplateByName({ name: draft?.name || name, limit: opts.limit });

        const draftNorm = stableStringify({
          name: draft?.name,
          language: draft?.language,
          category: draft?.category,
          components: draft?.components
        });

        const remoteNorm = remote
          ? stableStringify({
              name: remote?.name,
              language: remote?.language,
              category: remote?.category,
              components: remote?.components
            })
          : null;

        result.push({
          name: draft?.name || name,
          localDraft: true,
          remoteExists: !!remote,
          status: remote?.status || null,
          matchesRemote: remoteNorm ? draftNorm === remoteNorm : null
        });
      }

      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, client, result }, null, 2));
        return;
      }
      logger.info(`Draft sync (${client}): ${result.length}`);
      for (const r of result) {
        logger.info(`${r.name} remote=${r.remoteExists ? "yes" : "no"} status=${r.status || "-"} match=${r.matchesRemote === null ? "-" : r.matchesRemote}`);
      }
    });
}

module.exports = { registerTemplateCommands };
