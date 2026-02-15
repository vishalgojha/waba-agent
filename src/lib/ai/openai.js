const fs = require("fs-extra");

const { logger } = require("../logger");

function getOpenAiConfig(cfg) {
  const apiKey = cfg.openaiApiKey || process.env.OPENAI_API_KEY;
  const baseUrl = (cfg.openaiBaseUrl || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = cfg.openaiModel || process.env.OPENAI_MODEL;
  const visionModel = cfg.openaiVisionModel || process.env.WABA_OPENAI_VISION_MODEL || model;
  const transcribeModel = cfg.openaiTranscribeModel || process.env.WABA_OPENAI_TRANSCRIBE_MODEL;
  return { apiKey, baseUrl, model, visionModel, transcribeModel };
}

async function fetchJson(url, { apiKey, method = "POST", body, timeoutMs = 60_000 } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(body instanceof FormData ? {} : { "Content-Type": "application/json" })
      },
      body: body instanceof FormData ? body : JSON.stringify(body),
      signal: ac.signal
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
    if (!res.ok) {
      const msg = data?.error?.message || `${res.status} ${res.statusText}`;
      const e = new Error(msg);
      e.status = res.status;
      e.data = data;
      throw e;
    }
    return data;
  } finally {
    clearTimeout(t);
  }
}

function requireKey(cfg) {
  const { apiKey } = getOpenAiConfig(cfg);
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY (optional). Set it to enable lead classification, vision, and transcription.");
  }
  return apiKey;
}

async function chatCompletionJson(cfg, { model, system, user, maxTokens = 800 } = {}) {
  const { apiKey, baseUrl, model: defaultModel } = getOpenAiConfig(cfg);
  if (!apiKey) throw new Error("OPENAI_API_KEY missing.");
  const m = model || defaultModel;
  if (!m) throw new Error("OpenAI model missing. Set WABA_OPENAI_MODEL or OPENAI_MODEL.");

  const data = await fetchJson(`${baseUrl}/chat/completions`, {
    apiKey,
    body: {
      model: m,
      temperature: 0.2,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system || "Return JSON only." },
        { role: "user", content: user }
      ]
    }
  });

  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI response missing content.");

  try {
    return JSON.parse(content);
  } catch (err) {
    logger.debug({ content });
    throw new Error(`AI returned non-JSON. ${err?.message || err}`);
  }
}

async function visionDescribe(cfg, { imageBuffer, mimeType = "image/jpeg", prompt } = {}) {
  const { apiKey, baseUrl, visionModel } = getOpenAiConfig(cfg);
  if (!apiKey) throw new Error("OPENAI_API_KEY missing.");
  if (!visionModel) throw new Error("Vision model missing. Set WABA_OPENAI_VISION_MODEL (or WABA_OPENAI_MODEL).");

  const b64 = Buffer.from(imageBuffer).toString("base64");
  const dataUrl = `data:${mimeType};base64,${b64}`;

  const data = await fetchJson(`${baseUrl}/chat/completions`, {
    apiKey,
    body: {
      model: visionModel,
      temperature: 0.2,
      max_tokens: 400,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt || "Describe the image for a small business WhatsApp agent. Extract any text, intent, and next best reply." },
            { type: "image_url", image_url: { url: dataUrl } }
          ]
        }
      ]
    }
  });

  return data?.choices?.[0]?.message?.content || "";
}

async function transcribeAudioFile(cfg, { filePath, mimeType = "audio/ogg" } = {}) {
  const { apiKey, baseUrl, transcribeModel } = getOpenAiConfig(cfg);
  if (!apiKey) throw new Error("OPENAI_API_KEY missing.");
  if (!transcribeModel) {
    throw new Error("Transcription model missing. Set WABA_OPENAI_TRANSCRIBE_MODEL (example: gpt-4o-mini-transcribe).");
  }

  const buf = await fs.readFile(filePath);
  const blob = new Blob([buf], { type: mimeType });
  const form = new FormData();
  // Use Blob + filename for broader Node compatibility.
  form.append("file", blob, "audio");
  form.append("model", transcribeModel);

  const data = await fetchJson(`${baseUrl}/audio/transcriptions`, { apiKey, body: form });
  return data?.text || "";
}

module.exports = {
  getOpenAiConfig,
  requireKey,
  chatCompletionJson,
  visionDescribe,
  transcribeAudioFile
};
