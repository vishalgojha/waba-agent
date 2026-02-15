function toolWebhookValidate() {
  return {
    name: "webhook.validate",
    description: "Validate webhook verification endpoint by calling hub.challenge.",
    risk: "low",
    async execute(ctx, args) {
      const url = args?.url;
      const verifyToken = args?.verifyToken || ctx.config?.webhookVerifyToken;
      if (!url) throw new Error("Missing `url`.");
      if (!verifyToken) throw new Error("Missing verify token (run `waba webhook setup` or pass verifyToken).");

      const challenge = "123456";
      const target = `${String(url).replace(/\/+$/, "")}?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(verifyToken)}&hub.challenge=${challenge}`;
      const res = await fetch(target, { method: "GET" });
      const text = await res.text();
      const ok = res.status === 200 && text.trim() === challenge;
      await ctx.appendMemory(ctx.client || "default", {
        type: "webhook_validate",
        url,
        status: res.status,
        ok
      });
      return { ok, status: res.status, body: text };
    }
  };
}

module.exports = { toolWebhookValidate };
