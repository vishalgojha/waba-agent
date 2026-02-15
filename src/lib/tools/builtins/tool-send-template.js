function toolSendTemplate() {
  return {
    name: "template.send",
    description: "Send a pre-approved WhatsApp template message (high risk: outbound costs and compliance).",
    risk: "high",
    async execute(ctx, args) {
      const to = args?.to;
      const templateName = args?.templateName;
      const language = args?.language || "en";
      const params = args?.params;
      if (!to) throw new Error("Missing `to`.");
      if (!templateName) throw new Error("Missing `templateName`.");

      const res = await ctx.whatsapp.sendTemplate({ to, templateName, language, params });
      await ctx.appendMemory(ctx.client || "default", {
        type: "outbound_sent",
        kind: "template",
        to,
        templateName,
        language,
        params,
        category: args?.category || null,
        res
      });
      return { ok: true, res };
    }
  };
}

module.exports = { toolSendTemplate };
