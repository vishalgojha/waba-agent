// @ts-nocheck
function toolLeadEscalateHuman() {
  return {
    name: "lead.escalate_human",
    description: "Escalate a lead conversation to a human broker/agent with reason and priority.",
    risk: "high",
    async execute(ctx, args) {
      const phone = args?.phone || args?.to;
      const reason = String(args?.reason || "manual_review").trim();
      const priority = String(args?.priority || "normal").trim().toLowerCase();
      await ctx.appendMemory(ctx.client || "default", {
        type: "lead_escalated",
        phone: phone || null,
        reason,
        priority,
        note: args?.note || null
      });
      return {
        ok: true,
        summary: `Escalated ${phone || "lead"} to human (${priority})`,
        details: reason
      };
    }
  };
}

module.exports = { toolLeadEscalateHuman };
