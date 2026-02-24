// @ts-nocheck
const path = require("path");
const dayjs = require("dayjs");
const fs = require("fs-extra");

const { getConfig } = require("../lib/config");
const { getClientConfig } = require("../lib/client-config");
const { logger } = require("../lib/logger");
const { askYesNo } = require("../lib/prompt");
const { parseDurationMs } = require("../lib/duration");
const { buildSummaryReport } = require("../lib/summary");
const { getMissedLeads, buildFollowupActions, summarizePlan, scheduleFollowupActions } = require("../lib/followup");
const { createAgentContext } = require("../lib/agent/agent");

function registerAutopilotCommands(program) {
  const a = program.command("autopilot").description("safe daily automation helpers (plan-first)");

  a.command("daily")
    .description("run daily ops: summary -> missed leads -> schedule followups (requires --yes to take outbound action)")
    .option("--client <name>", "client name (default: active client)")
    .option("--since <dur>", "lookback window (default: 24h)", "24h")
    .option("--min-age <dur>", "missed lead min age (default: 10m)", "10m")
    .option("--limit <n>", "max missed leads to act on (default: 25)", (v) => Number(v), 25)
    .option("--schedule-delay <dur>", "delay for scheduled followups (default: 0m)", "0m")
    .option("--template-name <name>", "follow-up template name override (else uses client.json templates.followup.name)")
    .option("--email <addr>", "email summary HTML to address (requires SMTP env vars)")
    .option("--out <path>", "summary HTML output path (default: ./autopilot_<client>_<YYYY-MM-DD>.html)")
    .option("--yes", "execute outbound scheduling (otherwise plan only)", false)
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      if (json) throw new Error("--json not supported for autopilot (multi-step).");

      const cfg = await getConfig();
      const client = opts.client || cfg.activeClient || "default";
      const clientCfg = (await getClientConfig(client)) || {};

      const templateName = opts.templateName || clientCfg?.templates?.followup?.name || null;
      const outPath = opts.out || path.resolve(process.cwd(), `autopilot_${client}_${dayjs().format("YYYY-MM-DD")}.html`);

      logger.info(`Autopilot daily: client=${client} window=${opts.since}`);

      const sinceMs = parseDurationMs(opts.since);
      const minAgeMs = parseDurationMs(opts.minAge);
      if (!sinceMs) throw new Error("Invalid --since. Example: 24h, 7d, 90m");
      if (!minAgeMs) throw new Error("Invalid --min-age. Example: 10m, 30s");

      // 1) Summary HTML (share the same renderer as `export summary`)
      logger.info("1) Export summary HTML");
      const { html } = await buildSummaryReport({
        client,
        sinceMs,
        minAgeMs,
        pricing: cfg.pricing,
        clientCfg,
        sinceLabel: opts.since
      });
      await fs.ensureDir(path.dirname(outPath));
      await fs.writeFile(outPath, html, "utf8");
      logger.ok(`Summary ready: ${outPath}`);

      // 2) Missed leads + follow-up plan (no commander recursion)
      logger.info("2) Missed leads + follow-up plan");
      const missed = await getMissedLeads({
        client,
        sinceMs,
        minAgeMs,
        limit: opts.limit
      });

      const plan = await buildFollowupActions({
        client,
        missed,
        clientCfg,
        templateName,
        nowIso: new Date().toISOString()
      });
      const view = summarizePlan(plan);
      logger.info(`Missed leads: ${missed.length} (text=${view.counts.text}, template=${view.counts.template}, skipped=${view.counts.skipped})`);
      for (const line of view.sample) logger.info(line);
      if (view.more) logger.info(`... (${view.more} more)`);

      // 3) Followup schedule (plan by default)
      logger.info("3) Schedule follow-ups (compliant: text within 24h, template otherwise)");
      if (!templateName) {
        logger.warn("No follow-up template configured. Outside-24h followups will be skipped unless you set templates.followup.name in client.json or pass --template-name.");
      }

      if (!opts.yes) {
        logger.warn("Plan-only mode. Re-run with --yes to schedule outbound follow-ups.");
        logger.info(`Planned command: waba autopilot daily --client ${client} --since ${opts.since} --min-age ${opts.minAge} --schedule-delay ${opts.scheduleDelay}${templateName ? ` --template-name ${templateName}` : ""} --yes`);
      } else {
        logger.warn("High risk: this will schedule outbound messages (per-message billed).");
        const ok = await askYesNo("Proceed to schedule follow-ups now?", { defaultYes: false });
        if (!ok) return;
        const delayMs = parseDurationMs(opts.scheduleDelay);
        if (delayMs == null) throw new Error("Invalid --schedule-delay. Example: 0m, 10m, 2h");
        const runAt = dayjs().add(delayMs, "millisecond").toISOString();

        const ctx = await createAgentContext({ client, memoryEnabled: root.opts().memory !== false });
        const res = await scheduleFollowupActions(ctx, { actions: plan.actions, runAt });
        logger.ok(`Scheduled: ${res.scheduled}, skipped: ${res.skipped}`);
        logger.info("Next: `waba schedule run` (or run it via cron).");
      }

      // 4) Optional email (keep it simple by emailing the summary HTML file)
      if (opts.email) {
        logger.info("4) Email summary (optional)");
        const { sendEmail } = require("../lib/email");
        const html = await fs.readFile(outPath, "utf8");
        const subject = `${client} WhatsApp Daily Summary (${dayjs().format("YYYY-MM-DD")})`;
        await sendEmail({ to: opts.email, subject, html, text: `Daily summary for ${client}: ${outPath}` });
        logger.ok(`Emailed: ${opts.email}`);
      }

      logger.ok("Autopilot daily complete.");
      logger.info("Next: run `waba schedule run` from cron (or use `schedule.run_due` tool in a runner).");
    });
}

module.exports = { registerAutopilotCommands };
