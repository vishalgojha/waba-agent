// @ts-nocheck
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");

const intents = require("../ai/intents.json");

dayjs.extend(utc);
dayjs.extend(timezone);

const IST_TZ = "Asia/Kolkata";

function getIntentRisk(action) {
  return intents[action]?.risk || "low";
}

function formatDatetime(datetime, tz = IST_TZ) {
  if (!datetime) return "-";
  const d = dayjs(datetime);
  if (!d.isValid()) return String(datetime);
  return d.tz(tz).format("YYYY-MM-DD hh:mm A [IST]");
}

function padRight(s, n) {
  const src = String(s || "");
  if (src.length >= n) return src;
  return `${src}${" ".repeat(n - src.length)}`;
}

function boxLine(label, value) {
  const left = padRight(label, 10);
  const right = String(value ?? "-");
  return `${left}: ${right}`;
}

function formatParsedIntent(intent) {
  const risk = String(getIntentRisk(intent?.action)).toUpperCase();
  const rows = [
    boxLine("Action", intent?.action || "-"),
    boxLine("Client", intent?.client || "-"),
    boxLine("Phone", intent?.phone || "-"),
    boxLine("Template", intent?.template || "-"),
    boxLine("Params", intent?.params ? JSON.stringify(intent.params) : "-"),
    boxLine("Message", intent?.message || "-"),
    boxLine("Time", formatDatetime(intent?.datetime)),
    boxLine("Risk", `${risk} (${risk === "HIGH" ? "outbound message" : "workflow action"})`),
    boxLine("Confidence", Number(intent?.confidence ?? 0).toFixed(2))
  ];
  return [
    "+- Parsed Intent ---------------------------------+",
    ...rows.map((line) => `| ${padRight(line, 45)}|`),
    "+-----------------------------------------------+"
  ].join("\n");
}

module.exports = { formatParsedIntent, getIntentRisk, formatDatetime };
