const fs = require("fs-extra");
const path = require("path");

const { logger } = require("../lib/logger");
const { getConfig } = require("../lib/config");
const { safeClientName } = require("../lib/creds");
const {
  DOMAIN_ID,
  DOMAIN_VERSION,
  activateResaleMagic,
  importResaleLeads,
  queueMagicNurture,
  computeResaleMagicMetrics,
  buildShareableWin,
  loadResaleTemplatePack
} = require("../lib/domain/real-estate-resale");

function registerResaleCommands(program) {
  const r = program
    .command("resale")
    .alias("re")
    .description("real-estate resale magic mode (brokers/agencies)");

  r.command("activate")
    .description("activate resale magic profile for a client")
    .option("-c, --client <name>", "client name (default: active client)")
    .option("--off", "disable magic mode", false)
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const cfg = await getConfig();
      const client = safeClientName(opts.client || cfg.activeClient || "default");
      const out = await activateResaleMagic({ client, enabled: !opts.off });
      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, client, enabled: !opts.off, path: out.path, config: out.config }, null, 2));
        return;
      }
      logger.ok(`Resale Magic ${opts.off ? "disabled" : "enabled"} for ${client}`);
      logger.info(`Domain: ${DOMAIN_ID}@${DOMAIN_VERSION}`);
      logger.info(`Config: ${out.path}`);
    });

  r.command("import")
    .description("import resale leads from CSV or pasted rows")
    .option("-c, --client <name>", "client name (default: active client)")
    .option("--csv <file>", "CSV path with columns: name,phone,last_message_date,property_interested,notes")
    .option("--paste <text>", "paste rows: name|phone|last_message_date|property_interested|notes")
    .option("--replace", "replace existing lead store instead of append", false)
    .option("--magic-start", "auto-queue nurture sequences immediately after import", false)
    .option("--dry-run", "used with --magic-start; do not write schedules", false)
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const cfg = await getConfig();
      const client = safeClientName(opts.client || cfg.activeClient || "default");
      if (!opts.csv && !opts.paste) throw new Error("Provide --csv <file> or --paste <text>.");
      if (opts.csv && !(await fs.pathExists(path.resolve(opts.csv)))) {
        throw new Error(`CSV not found: ${opts.csv}`);
      }

      const out = await importResaleLeads({
        client,
        csvPath: opts.csv,
        pasteText: opts.paste,
        append: !opts.replace
      });

      let queued = null;
      if (opts.magicStart) {
        queued = await queueMagicNurture({
          client,
          dryRun: !!opts.dryRun
        });
      }

      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, client, ...out, queued }, null, 2));
        return;
      }
      logger.ok(`Imported ${out.imported} leads for ${client} (total: ${out.total}).`);
      logger.info(`Lead store: ${out.path}`);
      if (queued) {
        logger.ok(`Magic nurture ${opts.dryRun ? "planned" : "queued"}: ${queued.queued} follow-up schedule item(s).`);
      }
    });

  r.command("magic-start")
    .description("queue pre-built 1/3/7/14-day nurture sequences for imported resale leads")
    .option("-c, --client <name>", "client name (default: active client)")
    .option("--dry-run", "plan only, do not write schedules", false)
    .option("--limit <n>", "max leads to queue", (v) => Number(v), 100)
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const cfg = await getConfig();
      const client = safeClientName(opts.client || cfg.activeClient || "default");
      const out = await queueMagicNurture({
        client,
        dryRun: !!opts.dryRun,
        limit: opts.limit
      });
      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, client, ...out }, null, 2));
        return;
      }
      logger.ok(`Magic nurture ${opts.dryRun ? "planned" : "queued"} for ${client}: ${out.queued} item(s), across ${out.leads} lead(s).`);
    });

  r.command("metrics")
    .description("show first-48h wow metrics for resale magic mode")
    .option("-c, --client <name>", "client name (default: active client)")
    .option("--hours <n>", "window size in hours", (v) => Number(v), 48)
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const cfg = await getConfig();
      const client = safeClientName(opts.client || cfg.activeClient || "default");
      const metrics = await computeResaleMagicMetrics({ client, hours: opts.hours });
      const share = buildShareableWin(metrics, client);
      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, client, metrics, share }, null, 2));
        return;
      }
      logger.info(`Resale Magic (${client}) - last ${metrics.windowHours}h`);
      logger.info(`Re-engaged: ${metrics.contacts_reengaged}`);
      logger.info(`Qualified: ${metrics.qualified_leads}`);
      logger.info(`Brochure requests: ${metrics.brochure_requests}`);
      logger.info(`Site visit requests: ${metrics.site_visit_requests}`);
      logger.info(`Funnel: imported=${metrics.funnel.imported}, messaged=${metrics.funnel.messaged}, reengaged=${metrics.funnel.reengaged}, qualified=${metrics.funnel.qualified}`);
      logger.info(`Share card: ${share.title}`);
    });

  r.command("templates")
    .description("show bundled resale template pack")
    .option("--lang <en|hi>", "template language", "hi")
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const lang = opts.lang === "en" ? "en" : "hi";
      const templates = await loadResaleTemplatePack(lang);
      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, lang, count: templates.length, templates }, null, 2));
        return;
      }
      logger.info(`Resale templates (${lang}): ${templates.length}`);
      for (const t of templates) logger.info(`- ${t.name}: ${t.summary}`);
    });
}

module.exports = { registerResaleCommands };
