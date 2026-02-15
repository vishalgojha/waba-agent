const { getConfig } = require("../lib/config");
const { logger } = require("../lib/logger");
const { generateWeeklyReport, writeWeeklyReportFile } = require("../lib/report");
const { sendEmail, getSmtpConfig } = require("../lib/email");

function registerReportCommands(program) {
  const r = program.command("report").description("reports (weekly summaries for clients)");

  r.command("weekly")
    .description("generate a weekly report (HTML) and optionally email it via SMTP")
    .option("--client <name>", "client name (default: active client)")
    .option("--days <n>", "lookback window (default: 7)", (v) => Number(v), 7)
    .option("--email <addr>", "send to email address (requires SMTP env vars)")
    .option("--cc <addr>", "cc email")
    .option("--bcc <addr>", "bcc email")
    .option("--from <addr>", "override from email (otherwise WABA_SMTP_FROM)")
    .option("--include-samples", "include redacted inbound samples in the HTML", false)
    .option("--dry-run", "generate + save, but do not send email", false)
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();

      const cfg = await getConfig();
      const client = opts.client || cfg.activeClient || "default";

      const rep = await generateWeeklyReport({
        client,
        days: opts.days,
        pricing: cfg.pricing,
        includeSamples: !!opts.includeSamples
      });

      const filePath = await writeWeeklyReportFile({ client, html: rep.html });

      if (opts.email && !opts.dryRun) {
        const smtp = getSmtpConfig();
        logger.info(`SMTP: ${smtp.url ? "url" : `${smtp.host || "(missing host)"}:${smtp.port || ""}`}`);
        const info = await sendEmail({
          to: opts.email,
          cc: opts.cc,
          bcc: opts.bcc,
          from: opts.from,
          subject: rep.subject,
          html: rep.html,
          text: rep.text
        });
        if (json) {
          // eslint-disable-next-line no-console
          console.log(JSON.stringify({ ok: true, client, filePath, email: { to: opts.email, messageId: info.messageId } }, null, 2));
          return;
        }
        logger.ok(`Report saved: ${filePath}`);
        logger.ok(`Email sent: ${opts.email} (messageId=${info.messageId || "n/a"})`);
        return;
      }

      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, client, filePath }, null, 2));
        return;
      }
      logger.ok(`Report saved: ${filePath}`);
      if (opts.email && opts.dryRun) logger.warn("--dry-run set; not sending email.");
      if (opts.email && !opts.dryRun) {
        logger.warn("Email not sent because SMTP is not configured or --dry-run set.");
        logger.info("Set env vars: WABA_SMTP_URL (or WABA_SMTP_HOST/WABA_SMTP_USER/WABA_SMTP_PASS) and WABA_SMTP_FROM");
      }
    });
}

module.exports = { registerReportCommands };

