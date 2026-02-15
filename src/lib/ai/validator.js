const dayjs = require("dayjs");

const intents = require("./intents.json");
const { normalizePhone } = require("./parser");

const E164_RE = /^\+[1-9]\d{7,14}$/;

function askForField(field, action) {
  if (field === "message" && action === "webhook_setup") return "Missing webhook URL. Share the public URL (e.g., https://abc.ngrok.app).";
  if (field === "phone") return "Missing phone number. Who should I send this to?";
  if (field === "template") return "Missing template name. Which approved template should I use?";
  if (field === "message") return "Missing message text. What should I send?";
  if (field === "datetime") return "What time should I schedule this? (e.g., 'tomorrow 10am')";
  if (field === "client") return "Missing client name. Which client should this run for?";
  return `Missing ${field}. Please provide it.`;
}

function normalizeIntentShape(intent) {
  const src = intent && typeof intent === "object" ? intent : {};
  return {
    action: src.action || null,
    client: src.client || null,
    phone: src.phone || null,
    template: src.template || null,
    params: Array.isArray(src.params) ? src.params : src.params == null ? null : [String(src.params)],
    message: src.message || null,
    datetime: src.datetime || null,
    confidence: Number(src.confidence ?? 0)
  };
}

function validateIntent(intent) {
  const normalized = normalizeIntentShape(intent);
  const errors = [];
  const suggestions = [];
  const missingFields = [];

  if (!normalized.action || !intents[normalized.action]) {
    errors.push(`Unsupported action: ${normalized.action || "null"}`);
    suggestions.push("Try: send text, send template, schedule text, schedule template, list templates, show memory.");
    return { valid: false, errors, suggestions, missingFields, intent: normalized };
  }

  const schema = intents[normalized.action];
  for (const field of schema.required || []) {
    if (normalized[field] === null || normalized[field] === undefined || String(normalized[field]).trim() === "") {
      missingFields.push(field);
      errors.push(`Missing required field: ${field}`);
      suggestions.push(askForField(field, normalized.action));
    }
  }

  if (normalized.phone) {
    const phone = normalizePhone(normalized.phone);
    normalized.phone = phone;
    if (!phone || !E164_RE.test(phone)) {
      errors.push("Phone must be valid E.164 format (example: +919812345678).");
      suggestions.push("Use full international format with country code, e.g. +919812345678.");
    }
  }

  if (normalized.datetime) {
    const dt = dayjs(normalized.datetime);
    if (!dt.isValid()) {
      errors.push("Invalid datetime. Use ISO8601 or natural language like 'tomorrow 10am'.");
      suggestions.push("Example: 2026-02-18T10:00:00+05:30.");
    } else if (!dt.isAfter(dayjs())) {
      errors.push("Datetime must be in the future.");
      suggestions.push("Pick a future time (e.g., tomorrow 10am).");
    }
  }

  if (normalized.confidence < 0 || normalized.confidence > 1 || Number.isNaN(normalized.confidence)) {
    errors.push("Confidence must be between 0 and 1.");
    suggestions.push("Set confidence to a decimal between 0.0 and 1.0.");
  }

  if (normalized.action === "webhook_setup" && normalized.message) {
    const hasUrl = /https?:\/\/\S+/i.test(String(normalized.message));
    if (!hasUrl) {
      errors.push("Webhook setup requires a public URL in the request.");
      suggestions.push("Include a URL like https://your-domain.com in the intent.");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    suggestions,
    missingFields,
    intent: normalized
  };
}

module.exports = { validateIntent };
