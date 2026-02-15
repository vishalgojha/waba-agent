function toolSendText() {
  return {
    name: "message.send_text",
    description: "Send a WhatsApp text message (high risk: outbound costs and compliance).",
    risk: "high",
    async execute(ctx, args) {
      const to = args?.to;
      const body = args?.body;
      if (!to) throw new Error("Missing `to`.");
      if (!body) throw new Error("Missing `body`.");

      if (ctx.optout?.isOptedOut && (await ctx.optout.isOptedOut(to))) {
        throw new Error("Recipient is opted out. Use `waba optout remove <number>` only if you have explicit consent.");
      }

      const res = await ctx.whatsapp.sendText({ to, body, previewUrl: !!args?.previewUrl });
      await ctx.appendMemory(ctx.client || "default", {
        type: "outbound_sent",
        kind: "text",
        to,
        body,
        category: args?.category || null,
        res
      });
      return { ok: true, res };
    }
  };
}

module.exports = { toolSendText };
