const fs = require("fs-extra");

const { logger } = require("../logger");

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434/v1";
const DEFAULT_OLLAMA_MODEL = "deepseek-coder-v2:16b";
const DEFAULT_OLLAMA_FALLBACK_MODEL = "qwen2.5:7b";

function normalizeProvider(v) {
  const raw = String(v || "").trim().toLowerCase();
  if (!raw) return null;
  if (["openai", "anthropic", "xai", "openrouter"].includes(raw)) return raw;
  if (raw === "x.ai") return "xai";
  if (raw === "claude") return "anthropic";
  if (raw === "grok") return "xai";
  if (raw === "ollama") return "openai"; // OpenAI-compatible endpoint.
  return raw;
}

function defaultModelFor(provider) {
  switch (provider) {
    case "anthropic":
      return "claude-3-5-haiku-latest";
    case "xai":
      return "grok-2-latest";
    case "openrouter":
      return "openai/gpt-4o-mini";
    case "openai":
    default:
      return "gpt-4o-mini";
  }
}

function trimSlash(url) {
  return String(url || "").replace(/\/+$/, "");
}

function shouldUseOllamaFallback({ providerHint, openaiApiKey, anthropicApiKey, xaiApiKey, openrouterApiKey, openaiBaseUrlInput }) {
  const noHostedKeys = !openaiApiKey && !anthropicApiKey && !xaiApiKey && !openrouterApiKey;
  if (!noHostedKeys) return false;

  if (!providerHint) return true;
  if (providerHint === "openai") return true;
  if (String(providerHint).toLowerCase() === "ollama") return true;

  // If someone set a local OpenAI-compatible endpoint but forgot keys, prefer local fallback.
  const base = String(openaiBaseUrlInput || "").toLowerCase();
  if (base.includes("127.0.0.1:11434") || base.includes("localhost:11434")) return true;

  return false;
}

function buildOllamaFallbackConfig({ cfg = {}, openaiBaseUrlInput = "", openaiModelInput = "", openaiApiKey = "" } = {}) {
  const baseUrl = trimSlash(
    openaiBaseUrlInput
    || cfg.ollamaBaseUrl
    || process.env.WABA_OLLAMA_BASE_URL
    || DEFAULT_OLLAMA_BASE_URL
  );
  const model = openaiModelInput
    || cfg.ollamaModel
    || process.env.WABA_OLLAMA_MODEL
    || DEFAULT_OLLAMA_MODEL;
  const apiKey = openaiApiKey || process.env.WABA_OLLAMA_API_KEY || "ollama";

  return {
    provider: "openai",
    apiKey,
    baseUrl,
    model,
    extraHeaders: {},
    localFallback: "ollama"
  };
}

function resolveAiProviderConfig(cfg = {}) {
  const openaiApiKey = cfg.openaiApiKey || process.env.OPENAI_API_KEY;
  const openaiBaseUrlInput = cfg.openaiBaseUrl || process.env.OPENAI_BASE_URL || "";
  const openaiBaseUrl = trimSlash(openaiBaseUrlInput || DEFAULT_OPENAI_BASE_URL);
  const openaiModel = cfg.openaiModel || process.env.WABA_OPENAI_MODEL || process.env.OPENAI_MODEL || null;

  const anthropicApiKey = cfg.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
  const anthropicBaseUrl = (cfg.anthropicBaseUrl || process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com/v1").replace(/\/+$/, "");
  const anthropicModel = cfg.anthropicModel || process.env.WABA_ANTHROPIC_MODEL || process.env.ANTHROPIC_MODEL || null;

  const xaiApiKey = cfg.xaiApiKey || process.env.XAI_API_KEY;
  const xaiBaseUrl = (cfg.xaiBaseUrl || process.env.XAI_BASE_URL || "https://api.x.ai/v1").replace(/\/+$/, "");
  const xaiModel = cfg.xaiModel || process.env.WABA_XAI_MODEL || process.env.XAI_MODEL || null;

  const openrouterApiKey = cfg.openrouterApiKey || process.env.OPENROUTER_API_KEY;
  const openrouterBaseUrl = (cfg.openrouterBaseUrl || process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/+$/, "");
  const openrouterModel = cfg.openrouterModel || process.env.WABA_OPENROUTER_MODEL || process.env.OPENROUTER_MODEL || null;
  const openrouterSiteUrl = cfg.openrouterSiteUrl || process.env.WABA_OPENROUTER_SITE_URL || process.env.OPENROUTER_SITE_URL || "";
  const openrouterAppName = cfg.openrouterAppName || process.env.WABA_OPENROUTER_APP_NAME || process.env.OPENROUTER_APP_NAME || "waba-agent";

  const providerHintRaw = cfg.aiProvider || process.env.WABA_AI_PROVIDER;
  const providerHint = String(providerHintRaw || "").trim().toLowerCase() || null;

  // Explicit local override: if user picked ollama, force local OpenAI-compatible runtime.
  if (providerHint === "ollama") {
    return buildOllamaFallbackConfig({
      cfg,
      openaiBaseUrlInput,
      openaiModelInput: openaiModel,
      openaiApiKey
    });
  }

  let provider = normalizeProvider(providerHintRaw);
  if (!provider) {
    const hintedBase = String(openaiBaseUrl || "").toLowerCase();
    if (anthropicApiKey && !openrouterApiKey && !xaiApiKey && !openaiApiKey) provider = "anthropic";
    else if (openrouterApiKey || hintedBase.includes("openrouter.ai")) provider = "openrouter";
    else if (xaiApiKey || hintedBase.includes("api.x.ai")) provider = "xai";
    else provider = "openai";
  }

  if (
    shouldUseOllamaFallback({
      providerHint,
      openaiApiKey,
      anthropicApiKey,
      xaiApiKey,
      openrouterApiKey,
      openaiBaseUrlInput
    })
  ) {
    return buildOllamaFallbackConfig({
      cfg,
      openaiBaseUrlInput,
      openaiModelInput: openaiModel,
      openaiApiKey
    });
  }

  switch (provider) {
    case "anthropic":
      return {
        provider,
        apiKey: anthropicApiKey,
        baseUrl: anthropicBaseUrl,
        model: anthropicModel || openaiModel || defaultModelFor(provider),
        extraHeaders: {}
      };
    case "xai":
      return {
        provider,
        apiKey: xaiApiKey || openaiApiKey,
        baseUrl: (xaiApiKey ? xaiBaseUrl : (openaiBaseUrl || xaiBaseUrl)).replace(/\/+$/, ""),
        model: xaiModel || openaiModel || defaultModelFor(provider),
        extraHeaders: {}
      };
    case "openrouter": {
      const extraHeaders = {};
      if (openrouterSiteUrl) extraHeaders["HTTP-Referer"] = openrouterSiteUrl;
      if (openrouterAppName) extraHeaders["X-Title"] = openrouterAppName;
      return {
        provider,
        apiKey: openrouterApiKey || openaiApiKey,
        baseUrl: (openrouterApiKey ? openrouterBaseUrl : (openaiBaseUrl || openrouterBaseUrl)).replace(/\/+$/, ""),
        model: openrouterModel || openaiModel || defaultModelFor(provider),
        extraHeaders
      };
    }
    case "openai":
    default:
      return {
        provider: "openai",
        apiKey: openaiApiKey,
        baseUrl: openaiBaseUrl,
        model: openaiModel || defaultModelFor("openai"),
        extraHeaders: {}
      };
  }
}

function getOpenAiConfig(cfg = {}) {
  const runtime = resolveAiProviderConfig(cfg);
  const visionModel = cfg.openaiVisionModel || process.env.WABA_OPENAI_VISION_MODEL || runtime.model;
  const transcribeModel = cfg.openaiTranscribeModel || process.env.WABA_OPENAI_TRANSCRIBE_MODEL;
  return { ...runtime, visionModel, transcribeModel };
}

function hasAiProviderConfigured(cfg = {}) {
  const runtime = resolveAiProviderConfig(cfg);
  return !!(runtime.apiKey && runtime.model);
}

async function fetchJson(url, { apiKey, method = "POST", body, timeoutMs = 60_000, headers = {}, auth = "bearer" } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const authHeaders = auth === "bearer" && apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
    const res = await fetch(url, {
      method,
      headers: {
        ...authHeaders,
        ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }),
        ...headers
      },
      body: body instanceof FormData ? body : JSON.stringify(body),
      signal: ac.signal
    });
    let data;
    if (typeof res.text === "function") {
      const text = await res.text();
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
    } else if (typeof res.json === "function") {
      data = await res.json();
    } else {
      data = {};
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

function requireKey(cfg = {}) {
  const { apiKey } = resolveAiProviderConfig(cfg);
  if (!apiKey) {
    throw new Error("No AI provider key found. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, XAI_API_KEY, or OPENROUTER_API_KEY. For local default, run Ollama at http://127.0.0.1:11434/v1.");
  }
  return apiKey;
}

async function chatCompletionText(cfg, { model, system, user, maxTokens = 800, temperature = 0.2, timeoutMs = 60_000 } = {}) {
  const runtime = resolveAiProviderConfig(cfg);
  if (!runtime.apiKey) {
    throw new Error("AI key missing. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, XAI_API_KEY, or OPENROUTER_API_KEY. For local default, run Ollama at http://127.0.0.1:11434/v1.");
  }
  const m = model || runtime.model;
  if (!m) throw new Error("AI model missing. Set WABA_OPENAI_MODEL / WABA_ANTHROPIC_MODEL / WABA_XAI_MODEL / WABA_OPENROUTER_MODEL.");

  if (runtime.provider === "anthropic") {
    const data = await fetchJson(`${runtime.baseUrl}/messages`, {
      apiKey: runtime.apiKey,
      auth: "none",
      timeoutMs,
      headers: {
        "x-api-key": runtime.apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: {
        model: m,
        max_tokens: maxTokens,
        temperature,
        system: system || undefined,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: String(user || "") }]
          }
        ]
      }
    });
    const content = Array.isArray(data?.content)
      ? data.content.map((x) => x?.text || "").filter(Boolean).join("\n").trim()
      : "";
    if (!content) throw new Error("Anthropic response missing content.");
    return { content, provider: runtime.provider, model: m, raw: data };
  }

  const buildBody = (modelName) => ({
    model: modelName,
    temperature,
    max_tokens: maxTokens,
    messages: [
      ...(system ? [{ role: "system", content: system }] : []),
      { role: "user", content: String(user || "") }
    ]
  });

  let usedModel = m;
  let data;
  try {
    data = await fetchJson(`${runtime.baseUrl}/chat/completions`, {
      apiKey: runtime.apiKey,
      timeoutMs,
      headers: runtime.extraHeaders || {},
      body: buildBody(usedModel)
    });
  } catch (err) {
    const fallbackModel = process.env.WABA_OLLAMA_FALLBACK_MODEL || DEFAULT_OLLAMA_FALLBACK_MODEL;
    const missingModel = /model .* not found/i.test(String(err?.message || ""));
    const allowFallback = runtime.localFallback === "ollama" && missingModel && fallbackModel && fallbackModel !== usedModel;
    if (!allowFallback) throw err;

    logger.warn(`Primary Ollama model '${usedModel}' unavailable. Retrying with '${fallbackModel}'.`);
    usedModel = fallbackModel;
    data = await fetchJson(`${runtime.baseUrl}/chat/completions`, {
      apiKey: runtime.apiKey,
      timeoutMs,
      headers: runtime.extraHeaders || {},
      body: buildBody(usedModel)
    });
  }
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI response missing content.");
  return { content, provider: runtime.provider, model: usedModel, raw: data };
}

async function chatCompletionJson(cfg, { model, system, user, maxTokens = 800 } = {}) {
  const { content } = await chatCompletionText(cfg, {
    model,
    system: system || "Return JSON only.",
    user,
    maxTokens,
    temperature: 0.2
  });

  try {
    return JSON.parse(content);
  } catch (err) {
    logger.debug({ content });
    throw new Error(`AI returned non-JSON. ${err?.message || err}`);
  }
}

async function visionDescribe(cfg, { imageBuffer, mimeType = "image/jpeg", prompt } = {}) {
  const { apiKey, baseUrl, visionModel, provider, extraHeaders } = getOpenAiConfig(cfg);
  if (!apiKey) throw new Error("AI key missing.");
  if (!visionModel) throw new Error("Vision model missing. Set WABA_OPENAI_VISION_MODEL (or WABA_OPENAI_MODEL).");
  if (provider === "anthropic") {
    throw new Error("Vision helper currently requires an OpenAI-compatible endpoint (OpenAI, xAI, OpenRouter, or Ollama-compatible gateway).");
  }

  const b64 = Buffer.from(imageBuffer).toString("base64");
  const dataUrl = `data:${mimeType};base64,${b64}`;

  const data = await fetchJson(`${baseUrl}/chat/completions`, {
    apiKey,
    headers: extraHeaders || {},
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
  const { apiKey, baseUrl, transcribeModel, provider, extraHeaders } = getOpenAiConfig(cfg);
  if (!apiKey) throw new Error("AI key missing.");
  if (!transcribeModel) {
    throw new Error("Transcription model missing. Set WABA_OPENAI_TRANSCRIBE_MODEL (example: gpt-4o-mini-transcribe).");
  }
  if (provider === "anthropic") {
    throw new Error("Transcription helper currently requires an OpenAI-compatible endpoint that supports /audio/transcriptions.");
  }

  const buf = await fs.readFile(filePath);
  const blob = new Blob([buf], { type: mimeType });
  const form = new FormData();
  // Use Blob + filename for broader Node compatibility.
  form.append("file", blob, "audio");
  form.append("model", transcribeModel);

  const data = await fetchJson(`${baseUrl}/audio/transcriptions`, {
    apiKey,
    body: form,
    headers: extraHeaders || {}
  });
  return data?.text || "";
}

module.exports = {
  getOpenAiConfig,
  resolveAiProviderConfig,
  hasAiProviderConfigured,
  requireKey,
  chatCompletionText,
  chatCompletionJson,
  visionDescribe,
  transcribeAudioFile
};
