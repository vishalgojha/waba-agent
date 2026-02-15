const os = require("os");
const path = require("path");
const fs = require("fs-extra");

const { logger } = require("./logger");

async function downloadMediaToTemp(whatsapp, { mediaId }) {
  const meta = await whatsapp.getMedia({ mediaId });
  const buf = await whatsapp.downloadMedia({ url: meta.url });
  const ext = meta.mime_type?.includes("png") ? "png" : meta.mime_type?.includes("jpeg") ? "jpg" : "bin";
  const filePath = path.join(os.tmpdir(), `waba_media_${mediaId}_${Date.now()}.${ext}`);
  await fs.writeFile(filePath, buf);
  return { meta, filePath };
}

async function transcribeVoiceStub(ctx, { mediaId, mimeType }) {
  const { meta, filePath } = await downloadMediaToTemp(ctx.whatsapp, { mediaId });
  const mt = mimeType || meta.mime_type || "audio/ogg";

  // Stub: wire this to your transcription provider.
  // Example (OpenAI-compatible):
  // const { transcribeAudioFile } = require("./ai/openai");
  // const text = await transcribeAudioFile(ctx.config, { filePath, mimeType: mt });
  // return { filePath, text };

  if (!ctx.config?.openaiApiKey) {
    logger.warn("Voice note received. To enable transcription, set OPENAI_API_KEY and WABA_OPENAI_TRANSCRIBE_MODEL.");
  }

  return { filePath, mimeType: mt, text: "[voice transcription stub]" };
}

async function describeImageStub(ctx, { mediaId, mimeType }) {
  const { meta, filePath } = await downloadMediaToTemp(ctx.whatsapp, { mediaId });
  const mt = mimeType || meta.mime_type || "image/jpeg";

  // Stub: wire this to your vision provider.
  // Example (OpenAI-compatible):
  // const { visionDescribe } = require("./ai/openai");
  // const desc = await visionDescribe(ctx.config, { imageBuffer: await fs.readFile(filePath), mimeType: mt });
  // return { filePath, desc };

  if (!ctx.config?.openaiApiKey) {
    logger.warn("Image received. To enable description, set OPENAI_API_KEY and WABA_OPENAI_VISION_MODEL.");
  }

  return { filePath, mimeType: mt, desc: "[image description stub]" };
}

module.exports = {
  transcribeVoiceStub,
  describeImageStub
};

