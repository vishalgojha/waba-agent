// @ts-nocheck
const os = require("os");
const path = require("path");
const fs = require("fs-extra");

const { logger } = require("./logger");
const { transcribeAudioFile, visionDescribe } = require("./ai/openai");

async function downloadMediaToTemp(whatsapp, { mediaId }) {
  const meta = await whatsapp.getMedia({ mediaId });
  const buf = await whatsapp.downloadMedia({ url: meta.url });
  const ext = meta.mime_type?.includes("png") ? "png" : meta.mime_type?.includes("jpeg") ? "jpg" : "bin";
  const filePath = path.join(os.tmpdir(), `waba_media_${mediaId}_${Date.now()}.${ext}`);
  await fs.writeFile(filePath, buf);
  return { meta, filePath };
}

async function transcribeVoiceStub(ctx, { mediaId, mimeType, ai = false }) {
  const { meta, filePath } = await downloadMediaToTemp(ctx.whatsapp, { mediaId });
  const mt = mimeType || meta.mime_type || "audio/ogg";

  if (ai && ctx.config?.openaiApiKey) {
    try {
      const text = await transcribeAudioFile(ctx.config, { filePath, mimeType: mt });
      return { filePath, mimeType: mt, text };
    } catch (err) {
      logger.warn(`Transcription failed; using stub. ${err?.message || err}`);
      return { filePath, mimeType: mt, text: "[voice transcription failed]" };
    }
  }

  if (ai && !ctx.config?.openaiApiKey) {
    logger.warn("Voice note received. To enable transcription, set OPENAI_API_KEY and WABA_OPENAI_TRANSCRIBE_MODEL.");
  }

  return { filePath, mimeType: mt, text: "[voice transcription stub]" };
}

async function describeImageStub(ctx, { mediaId, mimeType, ai = false }) {
  const { meta, filePath } = await downloadMediaToTemp(ctx.whatsapp, { mediaId });
  const mt = mimeType || meta.mime_type || "image/jpeg";

  if (ai && ctx.config?.openaiApiKey) {
    try {
      const buf = await fs.readFile(filePath);
      const desc = await visionDescribe(ctx.config, { imageBuffer: buf, mimeType: mt });
      return { filePath, mimeType: mt, desc };
    } catch (err) {
      logger.warn(`Vision failed; using stub. ${err?.message || err}`);
      return { filePath, mimeType: mt, desc: "[image description failed]" };
    }
  }

  if (ai && !ctx.config?.openaiApiKey) {
    logger.warn("Image received. To enable description, set OPENAI_API_KEY and WABA_OPENAI_VISION_MODEL.");
  }

  return { filePath, mimeType: mt, desc: "[image description stub]" };
}

module.exports = {
  transcribeVoiceStub,
  describeImageStub
};
