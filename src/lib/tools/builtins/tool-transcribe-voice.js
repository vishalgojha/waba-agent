const { transcribeAudioFile } = require("../../ai/openai");
const { logger } = require("../../logger");

function toolTranscribeVoice() {
  return {
    name: "transcribe.voice",
    description: "Transcribe an audio file (voice note) using a Whisper-style model (AI optional).",
    risk: "medium",
    async execute(ctx, args) {
      const client = args?.client || ctx.client || "default";
      const filePath = args?.filePath;
      const mimeType = args?.mimeType || "audio/ogg";
      if (!filePath) throw new Error("Missing `filePath`.");
      if (!ctx.config?.openaiApiKey) {
        logger.warn("OPENAI_API_KEY not set; cannot transcribe. Set WABA_OPENAI_TRANSCRIBE_MODEL too.");
        return { ok: false, skipped: true, reason: "openai_not_configured" };
      }
      const text = await transcribeAudioFile(ctx.config, { filePath, mimeType });
      await ctx.appendMemory(client, { type: "audio_transcript", filePath, mimeType, text });
      return { ok: true, text };
    }
  };
}

module.exports = { toolTranscribeVoice };

