// @ts-nocheck
const dayjs = require("dayjs");

const { readSchedules, writeSchedules, newId } = require("../../schedule-store");

function toolScheduleAddTemplate() {
  return {
    name: "schedule.add_template",
    description: "Schedule a WhatsApp template message for later sending (high risk: outbound).",
    risk: "high",
    async execute(ctx, args) {
      const to = args?.to;
      const templateName = args?.templateName;
      const language = args?.language || "en";
      const params = args?.params ?? [];
      const runAt = args?.runAt;
      const category = String(args?.category || "utility").toLowerCase();
      if (!to) throw new Error("Missing `to`.");
      if (!templateName) throw new Error("Missing `templateName`.");
      if (!runAt) throw new Error("Missing `runAt` (ISO string recommended).");

      const dt = dayjs(runAt);
      if (!dt.isValid()) throw new Error("Invalid `runAt`. Use ISO 8601 (example: 2026-02-16T10:00:00+05:30).");

      const list = await readSchedules();
      const item = {
        id: newId(),
        kind: "template",
        to,
        templateName,
        language,
        params,
        category,
        runAt: dt.toISOString(),
        status: "pending",
        createdAt: new Date().toISOString(),
        client: ctx.client || "default"
      };
      list.push(item);
      const p = await writeSchedules(list);
      await ctx.appendMemory(ctx.client || "default", { type: "schedule_added", item });
      return { ok: true, path: p, item };
    }
  };
}

module.exports = { toolScheduleAddTemplate };

