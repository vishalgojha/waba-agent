// @ts-nocheck
const dayjs = require("dayjs");

const { readSchedules, writeSchedules, newId } = require("../../schedule-store");
const { getClientConfig } = require("../../client-config");

function clampFollowupDays(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  if (n <= 1) return 1;
  if (n <= 3) return 3;
  if (n <= 7) return 7;
  return 14;
}

function toolLeadScheduleFollowup() {
  return {
    name: "lead.schedule_followup",
    description: "Schedule lead follow-up for 1/3/7/14 days using safe defaults.",
    risk: "medium",
    async execute(ctx, args) {
      const to = args?.to || args?.phone;
      if (!to) throw new Error("Missing `to`.");

      const days = clampFollowupDays(args?.days ?? args?.afterDays ?? 1);
      const now = dayjs();
      const runAt = now.add(days, "day").toISOString();
      const client = ctx.client || "default";
      const cfg = await getClientConfig(client);
      const followupTemplate = cfg?.resaleMagic?.defaultFollowupTemplateName || "resale_day1_followup_hi";
      const followupLang = cfg?.resaleMagic?.defaultFollowupLanguage || "hi";

      const list = await readSchedules();
      const useTemplate = !!(args?.templateName || followupTemplate);

      if (useTemplate) {
        const item = {
          id: newId(),
          kind: "template",
          to,
          templateName: args?.templateName || followupTemplate,
          language: args?.language || followupLang,
          params: Array.isArray(args?.params) ? args.params : [],
          category: String(args?.category || "marketing"),
          runAt,
          status: "pending",
          createdAt: new Date().toISOString(),
          client,
          meta: { source: "lead.schedule_followup", days }
        };
        list.push(item);
      } else {
        const item = {
          id: newId(),
          kind: "text",
          to,
          body: String(args?.body || "Hi, just checking if you are still interested. I can share fresh resale options."),
          runAt,
          status: "pending",
          createdAt: new Date().toISOString(),
          client,
          meta: { source: "lead.schedule_followup", days }
        };
        list.push(item);
      }

      const p = await writeSchedules(list);
      await ctx.appendMemory(client, {
        type: "schedule_added",
        source: "lead.schedule_followup",
        to,
        days,
        runAt
      });
      return { ok: true, path: p, runAt, days };
    }
  };
}

module.exports = { toolLeadScheduleFollowup };
