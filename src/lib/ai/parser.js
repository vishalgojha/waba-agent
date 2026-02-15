const fs = require("fs-extra");
const path = require("path");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
const customParseFormat = require("dayjs/plugin/customParseFormat");

const { logger } = require("../logger");
const { wabaHome } = require("../paths");
const { safeClientName } = require("../creds");

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);

const IST_TZ = "Asia/Kolkata";
const AI_LOG_PATH = path.join(wabaHome(), "ai-interactions.jsonl");

const ACTIONS = new Set([
  "send_template",
  "send_text",
  "schedule_text",
  "schedule_template",
  "list_templates",
  "webhook_setup",
  "show_memory"
]);

function emptyIntent() {
  return {
    action: null,
    client: null,
    phone: null,
    template: null,
    params: null,
    message: null,
    datetime: null,
    confidence: 0
  };
}

async function appendAiLog(event) {
  try {
    await fs.ensureDir(path.dirname(AI_LOG_PATH));
    await fs.appendFile(
      AI_LOG_PATH,
      `${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`,
      "utf8"
    );
  } catch {}
}

function clampConfidence(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function extractJson(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {}

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {}
  }

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {}
  }
  return null;
}

function normalizePhone(phoneLike) {
  const src = String(phoneLike || "").trim();
  if (!src) return null;
  const hasPlus = src.startsWith("+");
  const digits = src.replace(/\D/g, "");
  if (!digits) return null;
  if (hasPlus && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return null;
}

function extractPhone(text) {
  const m = String(text || "").match(/(\+?\d[\d\s\-()]{7,}\d)/);
  return normalizePhone(m ? m[1] : null);
}

function extractClient(text) {
  const src = String(text || "").replace(/["'][^"']*["']/g, " ");
  const stopWords = new Set(["my", "your", "our", "their", "the", "this", "that"]);
  const m1 = src.match(/\bfor\s+(?:client\s+)?([a-z0-9][a-z0-9._-]{1,})\b/i);
  if (m1 && !stopWords.has(String(m1[1]).toLowerCase())) return safeClientName(m1[1]);
  const m2 = src.match(/\bclient\s+([a-z0-9][a-z0-9._-]{1,})\b/i);
  if (m2 && !stopWords.has(String(m2[1]).toLowerCase())) return safeClientName(m2[1]);
  return null;
}

function extractTemplate(text) {
  const src = String(text || "");
  const a = src.match(/\bsend\s+([a-z0-9][a-z0-9._-]{1,})\s+template\b/i);
  if (a) return a[1];
  const b = src.match(/\btemplate(?:-name)?\s+["']?([a-z0-9][a-z0-9._-]{1,})["']?/i);
  if (b) return b[1];
  return null;
}

function extractQuotedMessage(text) {
  const src = String(text || "");
  const m = src.match(/["']([^"']{1,500})["']/);
  if (m) return m[1].trim();
  return null;
}

function extractTextMessage(text) {
  const quoted = extractQuotedMessage(text);
  if (quoted) return quoted;

  const src = String(text || "");
  const m = src.match(/\bsend(?:\s+text)?\s+(.+?)\s+\bto\b/i);
  if (m) return m[1].trim();
  if (/\breminder\b/i.test(src)) return "Reminder";
  return null;
}

function extractParams(text) {
  const src = String(text || "");
  const jsonBlock = src.match(/\[(.+)\]/);
  if (jsonBlock) {
    try {
      const parsed = JSON.parse(`[${jsonBlock[1]}]`);
      if (Array.isArray(parsed)) return parsed.map((x) => String(x));
    } catch {}
  }
  const m = src.match(/\bwith\s+params?\s+(.+)$/i);
  if (!m) return null;
  const raw = m[1].trim();
  if (!raw) return null;
  const parts = raw.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
  return parts.length ? parts : null;
}

function parseTimePart(text) {
  const src = String(text || "");
  const m = src.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2] || 0);
  const meridian = (m[3] || "").toLowerCase();
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  if (meridian === "pm" && hour < 12) hour += 12;
  if (meridian === "am" && hour === 12) hour = 0;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function parseRelativeDateTime(text, now = dayjs().tz(IST_TZ)) {
  const src = String(text || "").trim();
  if (!src) return null;

  const iso = src.match(/\b\d{4}-\d{2}-\d{2}(?:[tT ]\d{2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?(?:Z|[+-]\d{2}:?\d{2})?)?\b/);
  if (iso) {
    const parsedIso = dayjs(iso[0]);
    if (parsedIso.isValid()) return parsedIso.toISOString();
  }

  const time = parseTimePart(src) || { hour: 10, minute: 0 };
  if (/\btomorrow\b/i.test(src)) {
    return now
      .add(1, "day")
      .hour(time.hour)
      .minute(time.minute)
      .second(0)
      .millisecond(0)
      .toISOString();
  }

  if (/\btoday\b/i.test(src)) {
    return now
      .hour(time.hour)
      .minute(time.minute)
      .second(0)
      .millisecond(0)
      .toISOString();
  }

  const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  for (let i = 0; i < dayNames.length; i++) {
    if (src.toLowerCase().includes(dayNames[i])) {
      const current = now.day();
      let delta = i - current;
      if (delta <= 0) delta += 7;
      return now
        .add(delta, "day")
        .hour(time.hour)
        .minute(time.minute)
        .second(0)
        .millisecond(0)
        .toISOString();
    }
  }

  return null;
}

function chooseAction(text) {
  const t = String(text || "").toLowerCase();
  if (!t) return "list_templates";
  if (/\b(list|show|get)\b.*\btemplates?\b/.test(t) || /\btemplates?\b.*\b(list|available)\b/.test(t)) return "list_templates";
  if (/show.*memory|memory.*(show|list|for)/.test(t)) return "show_memory";
  if (/webhook.*setup|setup.*webhook/.test(t)) return "webhook_setup";
  if (/schedule|remind|tomorrow|next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)|\bat\s+\d{1,2}(?::\d{2})?\s*(am|pm)?\b/.test(t)) {
    if (/template/.test(t)) return "schedule_template";
    return "schedule_text";
  }
  if (/template/.test(t)) return "send_template";
  if (/send|message|text/.test(t)) return "send_text";
  return "send_text";
}

function heuristicParseIntent(text) {
  const action = chooseAction(text);
  const out = emptyIntent();
  out.action = action;
  out.client = extractClient(text);
  out.phone = extractPhone(text);
  out.template = extractTemplate(text);
  out.params = extractParams(text);
  out.message = extractTextMessage(text);
  out.datetime = parseRelativeDateTime(text);
  out.confidence = 0.42;

  if (action === "list_templates") {
    out.phone = null;
    out.template = null;
    out.params = null;
    out.message = null;
    out.datetime = null;
    out.confidence = 0.74;
  }

  if (action === "show_memory") {
    out.phone = null;
    out.template = null;
    out.params = null;
    out.datetime = null;
    out.confidence = 0.68;
  }

  if (action === "webhook_setup") {
    const url = String(text || "").match(/https?:\/\/\S+/i);
    out.message = url ? url[0] : null;
    out.phone = null;
    out.template = null;
    out.params = null;
    out.datetime = null;
    out.confidence = 0.61;
  }

  if ((action === "schedule_text" || action === "schedule_template") && !out.datetime) {
    out.datetime = parseRelativeDateTime("tomorrow 10am");
    out.confidence = 0.35;
  }

  if (action === "send_template" || action === "schedule_template") {
    if (!out.template && out.message && !/\s/.test(out.message)) {
      out.template = out.message;
      out.message = null;
    }
  }

  if (action === "send_text" && !out.message && out.template) {
    out.message = out.template;
    out.template = null;
  }

  return out;
}

function normalizeIntent(raw, fallbackText) {
  const out = emptyIntent();
  const source = raw && typeof raw === "object" ? raw : {};
  const fallback = String(fallbackText || "");

  const action = String(source.action || "").trim();
  out.action = ACTIONS.has(action) ? action : chooseAction(fallback);

  out.client = source.client ? safeClientName(source.client) : extractClient(fallback);
  out.phone = normalizePhone(source.phone) || extractPhone(fallback);
  out.template = source.template ? String(source.template).trim() : extractTemplate(fallback);
  out.params = Array.isArray(source.params)
    ? source.params.map((x) => String(x))
    : extractParams(fallback);
  out.message = source.message ? String(source.message).trim() : extractTextMessage(fallback);
  out.datetime = source.datetime ? parseRelativeDateTime(source.datetime) || dayjs(source.datetime).toISOString() : parseRelativeDateTime(fallback);
  out.confidence = clampConfidence(source.confidence);

  if (!out.confidence) {
    out.confidence = out.action ? 0.55 : 0.2;
  }

  if (out.action === "list_templates" || out.action === "show_memory" || out.action === "webhook_setup") {
    out.phone = null;
    if (out.action !== "webhook_setup") out.message = null;
    out.template = null;
    out.params = null;
    out.datetime = null;
  }

  if (out.action === "send_text") out.template = null;
  if (out.action === "send_template" || out.action === "schedule_template") {
    if (out.message && !out.template && !/\s/.test(out.message)) {
      out.template = out.message;
      out.message = null;
    }
  }

  if (out.action === "schedule_text" || out.action === "schedule_template") {
    if (!out.datetime) out.datetime = parseRelativeDateTime(fallback);
  } else {
    out.datetime = null;
  }

  return out;
}

function readContentText(choice) {
  const msg = choice?.message;
  if (!msg) return "";
  const c = msg.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .map((x) => (typeof x === "string" ? x : x?.text || ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

async function callLlmParse(text, config, { timeoutMs = 1_500 } = {}) {
  const apiKey = process.env.OPENAI_API_KEY || config?.openaiApiKey;
  if (!apiKey) throw new Error("OPENAI_API_KEY missing.");

  const baseUrl = (process.env.OPENAI_BASE_URL || config?.openaiBaseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = process.env.WABA_AI_MODEL || config?.wabaAiModel || config?.openaiModel || "gpt-4o-mini";
  const nowIst = dayjs().tz(IST_TZ).format("YYYY-MM-DD HH:mm:ss");

  const system = [
    "You are a strict intent parser for the waba CLI.",
    "Return ONLY a valid JSON object with this schema and exact keys:",
    "{",
    '  "action": "send_template" | "send_text" | "schedule_text" | "schedule_template" | "list_templates" | "webhook_setup" | "show_memory",',
    '  "client": string | null,',
    '  "phone": string | null,',
    '  "template": string | null,',
    '  "params": string[] | null,',
    '  "message": string | null,',
    '  "datetime": ISO8601 string | null,',
    '  "confidence": number',
    "}",
    `Assume timezone Asia/Kolkata. Current IST time: ${nowIst}.`,
    "Resolve relative time phrases to ISO8601.",
    "Prefer E.164 for phone numbers. Use null for missing fields."
  ].join("\n");

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    await appendAiLog({ type: "ai_parse_request", model, text });
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 350,
        messages: [
          { role: "system", content: system },
          { role: "user", content: text }
        ]
      }),
      signal: ac.signal
    });

    let payload;
    if (typeof res.text === "function") {
      const rawBody = await res.text();
      try {
        payload = JSON.parse(rawBody);
      } catch {
        payload = { raw: rawBody };
      }
    } else if (typeof res.json === "function") {
      payload = await res.json();
    } else {
      payload = {};
    }

    if (!res.ok) {
      const msg = payload?.error?.message || `${res.status} ${res.statusText}`;
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }

    const content = readContentText(payload?.choices?.[0]);
    const parsed = extractJson(content);
    if (!parsed) throw new Error("Model returned non-JSON content.");

    await appendAiLog({
      type: "ai_parse_response",
      model,
      latencyMs: Date.now() - startedAt,
      content,
      parsed
    });
    logger.debug({ aiParse: { model, latencyMs: Date.now() - startedAt } });
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

async function aiParseIntent(text, config = {}, options = {}) {
  const sourceText = String(text || "").trim();
  if (!sourceText) return emptyIntent();

  const quiet = !!options.quiet;
  const maxAttempts = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const parsed = await callLlmParse(sourceText, config, { timeoutMs: 1_500 });
      return normalizeIntent(parsed, sourceText);
    } catch (err) {
      lastError = err;
      const isTimeout = err?.name === "AbortError" || /timed? ?out/i.test(String(err?.message || ""));
      await appendAiLog({
        type: "ai_parse_error",
        attempt,
        timeout: !!isTimeout,
        message: String(err?.message || err)
      });
      if (!quiet) logger.warn(`AI parse attempt ${attempt}/${maxAttempts} failed: ${err?.message || err}`);
      if (!isTimeout) break;
    }
  }

  if (!quiet) logger.warn("Falling back to heuristic intent parsing.");
  if (!quiet && lastError) logger.debug({ aiParseFallbackReason: String(lastError?.message || lastError) });
  const fallback = heuristicParseIntent(sourceText);
  await appendAiLog({ type: "ai_parse_fallback", text: sourceText, intent: fallback });
  return normalizeIntent(fallback, sourceText);
}

module.exports = {
  aiParseIntent,
  parseRelativeDateTime,
  normalizePhone,
  __test: {
    heuristicParseIntent,
    normalizeIntent,
    chooseAction,
    extractJson
  }
};
