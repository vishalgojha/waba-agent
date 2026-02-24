// @ts-nocheck
function toolLeadTag() {
  return {
    name: "lead.tag",
    description: "Tag a lead with status/label (hot, warm, cold, followup_needed, etc.).",
    risk: "medium",
    async execute(ctx, args) {
      const phone = args?.phone || args?.to;
      const tag = String(args?.tag || "").trim().toLowerCase();
      const note = String(args?.note || args?.notes || "").trim() || null;
      if (!phone) throw new Error("Missing `phone`.");
      if (!tag) throw new Error("Missing `tag`.");
      await ctx.appendMemory(ctx.client || "default", {
        type: "lead_tagged",
        phone,
        tag,
        note
      });
      return { ok: true, summary: `Tagged ${phone} as ${tag}` };
    }
  };
}

module.exports = { toolLeadTag };
