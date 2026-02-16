function toolSendTextButtons() {
  return {
    name: "message.send_text_buttons",
    description: "Send an interactive WhatsApp message with quick-reply buttons.",
    risk: "high",
    async execute(ctx, args) {
      const to = args?.to;
      const body = args?.body;
      const buttons = Array.isArray(args?.buttons) ? args.buttons : [];
      if (!to) throw new Error("Missing `to`.");
      if (!body) throw new Error("Missing `body`.");
      if (!buttons.length) throw new Error("Missing `buttons` (1-3).");

      if (ctx.optout?.isOptedOut && (await ctx.optout.isOptedOut(to))) {
        throw new Error("Recipient is opted out. Use `waba optout remove <number>` only if you have explicit consent.");
      }

      const res = await ctx.whatsapp.sendTextWithButtons({
        to,
        body,
        buttons
      });
      await ctx.appendMemory(ctx.client || "default", {
        type: "outbound_sent",
        kind: "interactive_buttons",
        to,
        body,
        buttons,
        category: args?.category || "utility",
        meta: { source: args?.source || "chat" },
        res
      });
      return { ok: true, res };
    }
  };
}

module.exports = { toolSendTextButtons };
