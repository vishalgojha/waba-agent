// @ts-nocheck
const dayjs = require("dayjs");

const { readSchedules, writeSchedules, newId } = require("../../schedule-store");

function toolScheduleAddText() {
  return {
    name: "schedule.add_text",
    description: "Schedule a WhatsApp text for later sending (high risk when executed later).",
    risk: "high",
    async execute(ctx, args) {
      const to = args?.to;
      const body = args?.body;
      const runAt = args?.runAt;
      if (!to) throw new Error("Missing `to`.");
      if (!body) throw new Error("Missing `body`.");
      if (!runAt) throw new Error("Missing `runAt` (ISO string recommended).");

      const dt = dayjs(runAt);
      if (!dt.isValid()) throw new Error("Invalid `runAt`. Use ISO 8601 (example: 2026-02-16T10:00:00+05:30).");

      const list = await readSchedules();
      const item = {
        id: newId(),
        kind: "text",
        to,
        body,
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

module.exports = { toolScheduleAddText };
