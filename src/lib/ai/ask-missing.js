const { askInput } = require("../prompt");
const { normalizePhone, parseRelativeDateTime } = require("./parser");

function questionForField(field, action) {
  if (field === "phone") return "Who should I send this to? (example: +919812345678)";
  if (field === "template") return "Which approved template should I use?";
  if (field === "message" && action === "webhook_setup") return "Share your public webhook URL (example: https://abc.ngrok.app)";
  if (field === "message") return "What message should I send?";
  if (field === "datetime") return "When should this run? (example: tomorrow 10am)";
  if (field === "client") return "Which client name should I use?";
  if (field === "params") return "Any template params? (JSON array like [\"John\"] or comma-separated)";
  return `Provide ${field}:`;
}

function parseParams(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  try {
    const j = JSON.parse(s);
    if (Array.isArray(j)) return j.map((x) => String(x));
  } catch {}
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

function toFieldValue(field, raw, action) {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (field === "phone") return normalizePhone(s);
  if (field === "datetime") return parseRelativeDateTime(s) || s;
  if (field === "params") return parseParams(s);
  if (field === "message" && action === "webhook_setup") return s;
  return s;
}

async function askForMissingFields(intent, missingFields) {
  const updates = {};
  const queue = Array.from(new Set(missingFields || []));
  for (const field of queue) {
    const value = await askInput(questionForField(field, intent.action));
    updates[field] = toFieldValue(field, value, intent.action);
  }
  return updates;
}

module.exports = { askForMissingFields };
