// @ts-nocheck
const fs = require("fs-extra");
const dayjs = require("dayjs");

const { getConfig } = require("../lib/config");
const { WhatsAppCloudApi } = require("../lib/whatsapp");
const { logger } = require("../lib/logger");
const { createCampaign, loadCampaign, saveCampaign, listCampaigns } = require("../lib/campaign-store");
const { dueToRun, runCampaignOnce } = require("../lib/campaign-runner");

function parseAudienceCsv(text) {
  const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out = [];
  for (const line of lines) {
    const first = line.split(",")[0]?.trim();
    if (!first) continue;
    // Skip header-ish rows
    if (/phone|number|mobile/i.test(first)) continue;
    const digits = first.replace(/^\+/, "").replace(/[^0-9]/g, "");
    if (digits.length < 10) continue;
    out.push(digits);
  }
  // de-dupe
  return [...new Set(out)];
}

function registerCampaignCommands(program) {
  const c = program.command("campaign").description("broadcast campaigns (template-only)");

  c.command("list")
    .description("list campaigns")
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const rows = await listCampaigns();
      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, campaigns: rows }, null, 2));
        return;
      }
      logger.info(`Campaigns: ${rows.length}`);
      for (const x of rows) logger.info(`${x.id} ${x.status} ${x.name} (client=${x.client}) audience=${x.audience?.length || 0}`);
    });

  c.command("create")
    .description("create a campaign (draft)")
    .argument("<name>", "campaign name")
    .requiredOption("--template <name>", "template name")
    .option("--language <code>", "language code", "en")
    .option("--category <utility|marketing>", "category tag for local analytics", "marketing")
    .option("--client <name>", "client name (default: active client)")
    .action(async (name, opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const cfg = await getConfig();
      const client = opts.client || cfg.activeClient || "default";
      const out = await createCampaign({ name, client, templateName: opts.template, language: opts.language, category: opts.category });
      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, ...out }, null, 2));
        return;
      }
      logger.ok(`Created: ${out.campaign.id}`);
      logger.info(`Config: ${out.path}`);
    });

  c.command("import")
    .description("import audience CSV (first column should be phone numbers)")
    .requiredOption("--id <id>", "campaign id")
    .requiredOption("--csv <path>", "CSV path")
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const { campaign } = await loadCampaign(opts.id);
      const text = await fs.readFile(opts.csv, "utf8");
      const audience = parseAudienceCsv(text);
      campaign.audience = audience;
      await saveCampaign(campaign);
      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, id: campaign.id, audience: audience.length }, null, 2));
        return;
      }
      logger.ok(`Imported audience: ${audience.length}`);
    });

  c.command("schedule")
    .description("schedule a campaign")
    .requiredOption("--id <id>", "campaign id")
    .requiredOption("--at <iso>", "ISO datetime (with offset recommended)")
    .action(async (opts) => {
      const { campaign } = await loadCampaign(opts.id);
      const d = dayjs(opts.at);
      if (!d.isValid()) throw new Error("Invalid --at (use ISO 8601).");
      campaign.scheduledAt = d.toISOString();
      campaign.status = "scheduled";
      await saveCampaign(campaign);
      logger.ok(`Scheduled: ${campaign.id} at ${campaign.scheduledAt}`);
    });

  c.command("status")
    .description("show campaign progress")
    .requiredOption("--id <id>", "campaign id")
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const { campaign } = await loadCampaign(opts.id);
      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, campaign }, null, 2));
        return;
      }
      logger.info(`${campaign.id} ${campaign.status} ${campaign.name}`);
      logger.info(`client=${campaign.client} template=${campaign.template?.name} (${campaign.template?.language}) audience=${campaign.audience?.length || 0}`);
      const p = campaign.progress || {};
      logger.info(`processed=${p.processed || 0} sent=${p.sent || 0} failed=${p.failed || 0} optedOut=${p.optedOut || 0} lastIndex=${p.lastIndex || 0}`);
      if (campaign.scheduledAt) logger.info(`scheduledAt=${campaign.scheduledAt}`);
    });

  c.command("stop")
    .description("stop a campaign")
    .requiredOption("--id <id>", "campaign id")
    .action(async (opts) => {
      const { campaign } = await loadCampaign(opts.id);
      campaign.status = "stopped";
      campaign.stoppedAt = new Date().toISOString();
      await saveCampaign(campaign);
      logger.ok(`Stopped: ${campaign.id}`);
    });

  c.command("run")
    .description("run a campaign now (resumable). Template-only. Checks opt-out list.")
    .requiredOption("--id <id>", "campaign id")
    .option("--throttle-ms <n>", "delay between sends (default: 350ms)", (v) => Number(v), 350)
    .option("--stop-optout-rate <n>", "stop if optedOut/processed exceeds this (example: 0.05)", (v) => Number(v), null)
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const cfg = await getConfig();
      const { campaign } = await loadCampaign(opts.id);

      if (!dueToRun(campaign)) {
        throw new Error(`Not due yet. scheduledAt=${campaign.scheduledAt}`);
      }

      // Use campaign's client creds (not necessarily active).
      const clientName = campaign.client || cfg.activeClient || "default";
      const clientCreds = cfg.clients?.[clientName];
      if (!clientCreds?.token || !clientCreds?.phoneNumberId) {
        throw new Error(`Missing creds for client '${clientName}'. Use: waba clients add ${clientName} --token ... --phone-id ... --business-id ...`);
      }

      const api = new WhatsAppCloudApi({
        token: clientCreds.token,
        phoneNumberId: clientCreds.phoneNumberId,
        wabaId: clientCreds.wabaId,
        graphVersion: cfg.graphVersion || "v20.0",
        baseUrl: cfg.baseUrl
      });

      if (campaign.status === "draft") campaign.status = "running";
      if (campaign.status === "scheduled") campaign.status = "running";
      await saveCampaign(campaign);

      logger.warn("High risk: campaign sends outbound template messages (per-message billed).");
      const out = await runCampaignOnce({
        campaign,
        config: cfg,
        whatsapp: api,
        throttleMs: opts.throttleMs,
        stopOptoutRate: opts.stopOptoutRate
      });

      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, out }, null, 2));
        return;
      }
      logger.ok(`Run result: ${out.ok ? "ok" : "stopped"} processed=${out.processed ?? "-"} sent=${out.sent ?? "-"} failed=${out.failed ?? "-"} optedOut=${out.optedOut ?? "-"}`);
      if (!out.ok && out.reason) logger.warn(`reason=${out.reason}`);
    });
}

module.exports = { registerCampaignCommands };

