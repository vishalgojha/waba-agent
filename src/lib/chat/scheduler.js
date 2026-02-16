const dayjs = require("dayjs");

const { parseRelativeDateTime } = require("../ai/parser");
const { getMissedLeads, buildFollowupActions, scheduleFollowupActions } = require("../followup");
const { getClientConfig } = require("../client-config");

function resolveRunAt(text) {
  const iso = parseRelativeDateTime(text || "");
  if (iso) return iso;
  const parsed = dayjs(text);
  if (parsed.isValid()) return parsed.toISOString();
  return null;
}

class ProactiveScheduler {
  constructor(context, runtimeCtx) {
    this.context = context;
    this.runtimeCtx = runtimeCtx;
  }

  async suggestFollowups() {
    const client = this.context.client || "default";
    const missed = await getMissedLeads({
      client,
      sinceMs: 7 * 24 * 60 * 60 * 1000,
      minAgeMs: 2 * 60 * 60 * 1000,
      limit: 5
    });
    if (!missed.length) return null;
    return `You have ${missed.length} lead(s) pending follow-up. Want me to schedule reminders?`;
  }

  async scheduleNonResponders(timeText) {
    const client = this.context.client || "default";
    const runAt = resolveRunAt(timeText);
    if (!runAt) throw new Error("Could not parse schedule time. Example: tomorrow 10am");

    const missed = await getMissedLeads({
      client,
      sinceMs: 7 * 24 * 60 * 60 * 1000,
      minAgeMs: 30 * 60 * 1000,
      limit: 100
    });
    const clientCfg = await getClientConfig(client);
    const plan = await buildFollowupActions({
      client,
      missed,
      clientCfg,
      nowIso: new Date().toISOString()
    });
    const out = await scheduleFollowupActions(this.runtimeCtx, {
      actions: plan.actions,
      runAt
    });
    return {
      ...out,
      runAt,
      considered: plan.counts.total
    };
  }
}

module.exports = { ProactiveScheduler, resolveRunAt };
