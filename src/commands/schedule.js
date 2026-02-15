const dayjs = require("dayjs");

const { getConfig } = require("../lib/config");
const { WhatsAppCloudApi } = require("../lib/whatsapp");
const { readSchedules, writeSchedules } = require("../lib/schedule-store");
const { askYesNo } = require("../lib/prompt");
const { logger } = require("../lib/logger");
const { isOptedOut } = require("../lib/optout-store");
const { getLastInboundAt, in24hWindow } = require("../lib/session-window");

function registerScheduleCommands(program) {
  const s = program.command("schedule").description("outbound scheduling (stores locally; run `schedule run` to send due)");

  s.command("add-text")
    .description("schedule a text message")
    .argument("<to_number>", "E.164 without + (example: 9198xxxxxx)")
    .requiredOption("--at <iso>", "ISO datetime (recommended with offset, example: 2026-02-16T10:00:00+05:30)")
    .requiredOption("--body <text>", "message body")
    .option("--client <name>", "client name", "default")
    .action(async (to, opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const dt = dayjs(opts.at);
      if (!dt.isValid()) throw new Error("Invalid --at. Use ISO 8601 (example: 2026-02-16T10:00:00+05:30).");
      const list = await readSchedules();
      const item = {
        id: `sch_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
        kind: "text",
        to,
        body: opts.body,
        runAt: dt.toISOString(),
        status: "pending",
        createdAt: new Date().toISOString(),
        client: opts.client
      };
      list.push(item);
      const p = await writeSchedules(list);
      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, path: p, item }, null, 2));
        return;
      }
      logger.ok(`Scheduled ${item.id} at ${item.runAt}`);
      logger.info(`Stored in ${p}`);
      logger.warn("Compliance: scheduled TEXT will only send if the recipient is within the 24h customer-service window; otherwise it will fail closed (use a template schedule).");
      logger.warn("Costs: this will send an outbound message later (India approx: ~INR 0.11 utility, ~INR 0.78 marketing; verify current rates).");
    });

  s.command("add-template")
    .description("schedule a template message (safe for outside 24h window if template is approved)")
    .argument("<to_number>", "E.164 without + (example: 9198xxxxxx)")
    .requiredOption("--at <iso>", "ISO datetime (recommended with offset, example: 2026-02-16T10:00:00+05:30)")
    .requiredOption("--template-name <name>", "approved template name")
    .option("--language <code>", "language code (example: en)", "en")
    .option("--params <json>", "template params JSON (array or object)", "[]")
    .option("--category <utility|marketing>", "cost category label (informational)", "utility")
    .option("--client <name>", "client name", "default")
    .action(async (to, opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const dt = dayjs(opts.at);
      if (!dt.isValid()) throw new Error("Invalid --at. Use ISO 8601 (example: 2026-02-16T10:00:00+05:30).");

      let params;
      try {
        params = JSON.parse(opts.params);
      } catch (err) {
        throw new Error(`Invalid --params JSON: ${err?.message || err}`);
      }

      const list = await readSchedules();
      const item = {
        id: `sch_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
        kind: "template",
        to,
        templateName: opts.templateName,
        language: opts.language,
        params,
        category: String(opts.category || "utility").toLowerCase(),
        runAt: dt.toISOString(),
        status: "pending",
        createdAt: new Date().toISOString(),
        client: opts.client
      };
      list.push(item);
      const p = await writeSchedules(list);
      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, path: p, item }, null, 2));
        return;
      }
      logger.ok(`Scheduled ${item.id} at ${item.runAt}`);
      logger.info(`Stored in ${p}`);
      logger.warn("Costs: this will send an outbound TEMPLATE later (per-message billed).");
    });

  s.command("list")
    .description("list scheduled messages")
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const list = await readSchedules();
      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, list }, null, 2));
        return;
      }
      logger.info(`Scheduled: ${list.length}`);
      for (const x of list) logger.info(`${x.id} ${x.status} ${x.runAt} -> ${x.to} (${x.kind})`);
    });

  s.command("cancel")
    .description("cancel a scheduled message")
    .argument("<id>", "schedule id")
    .option("--yes", "skip confirmation", false)
    .action(async (id, opts) => {
      const list = await readSchedules();
      const item = list.find((x) => x.id === id);
      if (!item) throw new Error("Not found.");
      const ok = opts.yes ? true : await askYesNo(`Cancel ${id}?`, { defaultYes: false });
      if (!ok) return;
      item.status = "cancelled";
      item.cancelledAt = new Date().toISOString();
      await writeSchedules(list);
      logger.ok(`Cancelled ${id}`);
    });

  s.command("run")
    .description("send due scheduled messages now")
    .option("--yes", "skip confirmation", false)
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

      const list = await readSchedules();
      const now = dayjs();
      const due = list.filter((x) => x.status === "pending" && dayjs(x.runAt).isValid() && dayjs(x.runAt).isBefore(now));
      if (!due.length) {
        if (json) {
          // eslint-disable-next-line no-console
          console.log(JSON.stringify({ ok: true, due: 0 }, null, 2));
          return;
        }
        logger.info("No due schedules.");
        return;
      }

      if (!opts.yes) {
        logger.warn("High risk: this will send outbound messages now (per-message billed).");
        const ok = await askYesNo(`Send ${due.length} due message(s) now?`, { defaultYes: false });
        if (!ok) return;
      }

      const sent = [];
      const failed = [];
      for (const item of due) {
        try {
          if (item.kind === "text") {
            if (await isOptedOut(item.client || cfg.activeClient || "default", item.to)) {
              throw new Error("Recipient opted out.");
            }
            const client = item.client || cfg.activeClient || "default";
            const lastInbound = await getLastInboundAt({ client, from: item.to });
            if (!in24hWindow(lastInbound, new Date().toISOString())) {
              throw new Error("Session closed (>24h since last inbound). Use `schedule add-template` with an approved template.");
            }
            const res = await api.sendText({ to: item.to, body: item.body });
            item.status = "sent";
            item.sentAt = new Date().toISOString();
            item.res = res;
            sent.push(item.id);
          } else if (item.kind === "template") {
            if (await isOptedOut(item.client || cfg.activeClient || "default", item.to)) {
              throw new Error("Recipient opted out.");
            }
            const res = await api.sendTemplate({
              to: item.to,
              templateName: item.templateName,
              language: item.language || "en",
              params: item.params
            });
            item.status = "sent";
            item.sentAt = new Date().toISOString();
            item.res = res;
            sent.push(item.id);
          } else {
            throw new Error(`Unsupported kind: ${item.kind}`);
          }
        } catch (err) {
          item.status = "failed";
          item.failedAt = new Date().toISOString();
          item.error = String(err?.message || err);
          failed.push({ id: item.id, error: item.error });
        }
      }
      await writeSchedules(list);

      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, sent, failed }, null, 2));
        return;
      }
      logger.ok(`Sent: ${sent.length}, failed: ${failed.length}`);
      for (const f of failed) logger.error(`${f.id}: ${f.error}`);
    });
}

module.exports = { registerScheduleCommands };
