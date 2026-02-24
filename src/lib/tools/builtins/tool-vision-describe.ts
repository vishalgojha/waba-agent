// @ts-nocheck
const fs = require("fs-extra");

const { visionDescribe } = require("../../ai/openai");
const { logger } = require("../../logger");

function toolVisionDescribe() {
  return {
    name: "vision.describe",
    description: "Describe an image (extract intent + any visible text) using a vision-capable model (AI optional).",
    risk: "medium",
    async execute(ctx, args) {
      const client = args?.client || ctx.client || "default";
      const filePath = args?.filePath;
      const mimeType = args?.mimeType || "image/jpeg";
      if (!filePath) throw new Error("Missing `filePath`.");
      if (!ctx.config?.openaiApiKey) {
        logger.warn("OPENAI_API_KEY not set; cannot describe image.");
        return { ok: false, skipped: true, reason: "openai_not_configured" };
      }
      const buf = await fs.readFile(filePath);
      const desc = await visionDescribe(ctx.config, { imageBuffer: buf, mimeType });
      await ctx.appendMemory(client, { type: "vision_description", filePath, mimeType, desc });
      return { ok: true, desc };
    }
  };
}

module.exports = { toolVisionDescribe };

