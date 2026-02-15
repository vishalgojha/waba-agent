const dayjs = require("dayjs");

const { readSchedules, writeSchedules } = require("../../schedule-store");
const { isOptedOut } = require("../../optout-store");
const { getLastInboundAt, in24hWindow } = require("../../session-window");

function toolScheduleRunDue() {
  return {
    name: "schedule.run_due",
    description: "Send any due scheduled messages now (high risk: outbound).",
    risk: "high",
    async execute(ctx) {
      const list = await readSchedules();
      const now = dayjs();
      const due = list.filter((x) => x.status === "pending" && dayjs(x.runAt).isValid() && dayjs(x.runAt).isBefore(now));
      const sent = [];
      const failed = [];

      for (const item of due) {
        try {
          if (item.kind === "text") {
            if (await isOptedOut(item.client || ctx.client || "default", item.to)) {
              throw new Error("Recipient opted out.");
            }
            const client = item.client || ctx.client || "default";
            const lastInbound = await getLastInboundAt({ client, from: item.to });
            if (!in24hWindow(lastInbound, new Date().toISOString())) {
              throw new Error("Session closed (>24h since last inbound). Use a template schedule.");
            }
            const res = await ctx.whatsapp.sendText({ to: item.to, body: item.body });
            item.status = "sent";
            item.sentAt = new Date().toISOString();
            item.res = res;
            sent.push({ id: item.id });
            await ctx.appendMemory(item.client || ctx.client || "default", { type: "outbound_sent", kind: "text", to: item.to, body: item.body, res });
          } else if (item.kind === "template") {
            if (await isOptedOut(item.client || ctx.client || "default", item.to)) {
              throw new Error("Recipient opted out.");
            }
            const res = await ctx.whatsapp.sendTemplate({
              to: item.to,
              templateName: item.templateName,
              language: item.language || "en",
              params: item.params
            });
            item.status = "sent";
            item.sentAt = new Date().toISOString();
            item.res = res;
            sent.push({ id: item.id });
            await ctx.appendMemory(item.client || ctx.client || "default", {
              type: "outbound_sent",
              kind: "template",
              to: item.to,
              templateName: item.templateName,
              language: item.language || "en",
              params: item.params,
              category: item.category || null,
              res
            });
          } else {
            throw new Error(`Unsupported scheduled kind: ${item.kind}`);
          }
        } catch (err) {
          item.status = "failed";
          item.failedAt = new Date().toISOString();
          item.error = String(err?.message || err);
          failed.push({ id: item.id, error: item.error });
        }
      }

      await writeSchedules(list);
      return { ok: true, sent, failed, due: due.length };
    }
  };
}

module.exports = { toolScheduleRunDue };
