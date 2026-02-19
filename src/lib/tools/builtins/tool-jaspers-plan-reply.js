const tsBridge = require("../../ts-bridge");

function toolJaspersPlanReply() {
  return {
    name: "jaspers.plan_reply",
    description: "Plan Jaspers market conversational reply (quote/confirm flow) without sending outbound messages.",
    risk: "medium",
    async execute(ctx, args) {
      const from = String(args?.from || "").trim();
      const text = String(args?.text || "").trim();
      if (!from) throw new Error("Missing `from`.");
      if (!text) throw new Error("Missing `text`.");

      const bridge = await tsBridge.loadTsJaspersBridge();
      if (!bridge?.planMarketReply || !bridge?.getMarketSession || !bridge?.saveMarketSession) {
        throw new Error("TypeScript jaspers runtime is unavailable. Run: npm.cmd run build:ts:tmp");
      }

      const prevSession = await bridge.getMarketSession(from);
      const plan = bridge.planMarketReply(text, from, prevSession || null);
      await bridge.saveMarketSession(plan.nextSession);

      await ctx.appendMemory(ctx.client || "default", {
        type: "jaspers_plan",
        from,
        text: text.slice(0, 240),
        stage: plan.stage,
        risk: plan.risk,
        recommendations: (plan.recommendations || []).map((x) => x.code)
      });

      return {
        ok: true,
        result: {
          stage: plan.stage,
          risk: plan.risk,
          replyText: plan.replyText,
          recommendations: plan.recommendations || [],
          nextSession: plan.nextSession
        }
      };
    }
  };
}

module.exports = { toolJaspersPlanReply };
