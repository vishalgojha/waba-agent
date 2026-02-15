const dayjs = require("dayjs");

const { readMemory } = require("./memory");
const { readState } = require("./flow-state");
const { in24hWindow, normalizeNumber } = require("./session-window");
const { redactPhone } = require("./redact");

function isInbound(e) {
  const t = String(e?.type || "");
  return t === "inbound_message" || t === "inbound_text" || t.startsWith("inbound_");
}

function isOutbound(e) {
  const t = String(e?.type || "");
  return t === "outbound_sent" || t === "auto_reply_sent" || t.startsWith("outbound_");
}

function isRecent(e, cutoffMs) {
  const ts = Date.parse(e?.ts || "");
  return Number.isFinite(ts) && ts >= cutoffMs;
}

function lastTextSnippet(e) {
  const s = String(e?.text || e?.body || "");
  const t = s.replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length > 140 ? `${t.slice(0, 140)}...` : t;
}

async function getMissedLeads({ client, sinceMs, minAgeMs, limit = 50 } = {}) {
  const now = Date.now();
  const cutoff = now - sinceMs;
  const minInboundTs = now - minAgeMs;

  const events = await readMemory(client, { limit: 50_000 });
  const recent = events.filter((e) => isRecent(e, cutoff));

  // Aggregate per number.
  const by = new Map(); // from -> { from, lastInboundAt, lastOutboundAt, lastInboundEvent }
  for (const e of recent) {
    if (isInbound(e)) {
      const from = normalizeNumber(e.from);
      if (!from) continue;
      const ts = Date.parse(e.ts || "");
      if (!Number.isFinite(ts)) continue;
      const prev = by.get(from) || { from, lastInboundAt: null, lastOutboundAt: null, lastInboundEvent: null };
      if (!prev.lastInboundAt || ts > Date.parse(prev.lastInboundAt)) {
        prev.lastInboundAt = new Date(ts).toISOString();
        prev.lastInboundEvent = e;
      }
      by.set(from, prev);
    } else if (isOutbound(e)) {
      const to = normalizeNumber(e.to || e.recipient || e.to_number);
      if (!to) continue;
      const ts = Date.parse(e.ts || "");
      if (!Number.isFinite(ts)) continue;
      const prev = by.get(to) || { from: to, lastInboundAt: null, lastOutboundAt: null, lastInboundEvent: null };
      if (!prev.lastOutboundAt || ts > Date.parse(prev.lastOutboundAt)) {
        prev.lastOutboundAt = new Date(ts).toISOString();
      }
      by.set(to, prev);
    }
  }

  let missed = [];
  for (const x of by.values()) {
    if (!x.lastInboundAt) continue;
    const inboundTs = Date.parse(x.lastInboundAt);
    if (!Number.isFinite(inboundTs) || inboundTs > now) continue;
    if (inboundTs > minInboundTs) continue; // too fresh
    const outboundTs = x.lastOutboundAt ? Date.parse(x.lastOutboundAt) : NaN;
    const okOutbound = Number.isFinite(outboundTs) && outboundTs >= inboundTs;
    if (okOutbound) continue;
    missed.push(x);
  }

  missed.sort((a, b) => Date.parse(b.lastInboundAt) - Date.parse(a.lastInboundAt));
  missed = missed.slice(0, Math.max(1, Math.min(500, Number(limit) || 50)));
  return missed;
}

function renderTextTemplate(tpl, vars) {
  let out = String(tpl || "");
  const v = vars && typeof vars === "object" ? vars : {};
  out = out.replace(/\{\{\s*([a-zA-Z0-9._-]+)\s*\}\}/g, (_m, key) => {
    const val = v[key];
    if (val === null || val === undefined) return "";
    return String(val);
  });
  return out;
}

function buildTemplateParamsFromFields(keys, fields, vars, { businessName } = {}) {
  const k = Array.isArray(keys) && keys.length ? keys : ["name", "client"];
  const f = fields && typeof fields === "object" ? fields : {};
  const v = vars && typeof vars === "object" ? vars : {};
  const out = [];
  for (const key0 of k) {
    const key = String(key0 || "").trim();
    let val = "";
    if (key === "client") val = businessName || v.client || "";
    else if (key === "from") val = v.from || "";
    else if (key === "snippet") val = v.snippet || "";
    else val = f[key] ?? "";

    if (!val && key === "name") val = "there";
    out.push(String(val));
  }
  return out;
}

async function buildFollowupActions({
  client,
  missed,
  clientCfg,
  templateName,
  templateLanguage,
  templateParams,
  nowIso
} = {}) {
  const followupTmplCfg = clientCfg?.templates?.followup || null;
  const businessName = clientCfg?.businessName || clientCfg?.brandName || client;

  const name = templateName || followupTmplCfg?.name || null;
  const lang = templateLanguage || followupTmplCfg?.language || "en";

  let params = templateParams ?? null;
  if (params === null && followupTmplCfg?.params) params = followupTmplCfg.params;
  const paramsFromFields = Array.isArray(followupTmplCfg?.paramsFromFields) ? followupTmplCfg.paramsFromFields : ["name", "client"];

  // Enrichment: flow fields + last lead_classification fields.
  const state = await readState(client);
  const flowFieldsByFrom = new Map();
  for (const [k, v] of Object.entries(state || {})) {
    const num = normalizeNumber(k);
    if (!num) continue;
    const data = v && typeof v === "object" ? v.data : null;
    if (data && typeof data === "object") flowFieldsByFrom.set(num, data);
  }

  const events = await readMemory(client, { limit: 50_000 });
  const classifyByFrom = new Map(); // from -> { ts, fields }
  for (const e of events) {
    if (e?.type !== "lead_classification") continue;
    const from = normalizeNumber(e.from);
    if (!from) continue;
    const ts = Date.parse(e.ts || "");
    if (!Number.isFinite(ts)) continue;
    const f = e.result?.fields;
    if (!f || typeof f !== "object") continue;
    const prev = classifyByFrom.get(from);
    if (!prev || ts > prev.ts) classifyByFrom.set(from, { ts, fields: f });
  }

  const defaultText =
    "Hi! Just following up on your message to {{client}}. Reply with your requirement and preferred time. If you want a call, reply CALL.";
  const textTpl = clientCfg?.intentReplies?.fallback || defaultText;

  const actions = [];
  let willText = 0;
  let willTemplate = 0;
  let skipped = 0;

  const now = nowIso || new Date().toISOString();
  for (const x of missed || []) {
    const from = x.from;
    const lastInboundAt = x.lastInboundAt;
    const snippet = lastTextSnippet(x.lastInboundEvent);
    const sessionOpen = in24hWindow(lastInboundAt, now);
    const flowFields = flowFieldsByFrom.get(normalizeNumber(from)) || {};
    const aiFields = classifyByFrom.get(normalizeNumber(from))?.fields || {};
    const fields = { ...aiFields, ...flowFields };

    if (sessionOpen) {
      const body = renderTextTemplate(textTpl, { client, from, snippet });
      actions.push({ kind: "text", to: from, body, lastInboundAt, fields });
      willText += 1;
    } else if (name) {
      const built = params ?? buildTemplateParamsFromFields(paramsFromFields, fields, { client, from, snippet }, { businessName });
      actions.push({ kind: "template", to: from, templateName: name, language: lang, params: built, lastInboundAt, fields });
      willTemplate += 1;
    } else {
      actions.push({ kind: "skip", to: from, reason: "session_closed_no_template", lastInboundAt, fields });
      skipped += 1;
    }
  }

  return {
    actions,
    counts: { total: actions.length, text: willText, template: willTemplate, skipped },
    template: { name, language: lang }
  };
}

function summarizePlan({ actions, counts } = {}) {
  const sample = [];
  for (const a of (actions || []).slice(0, 20)) {
    if (a.kind === "text") sample.push(`${redactPhone(a.to)} -> text (24h ok)`);
    else if (a.kind === "template") sample.push(`${redactPhone(a.to)} -> template ${a.templateName}`);
    else sample.push(`${redactPhone(a.to)} -> skip (${a.reason})`);
  }
  return { counts, sample, more: Math.max(0, (actions || []).length - sample.length) };
}

async function scheduleFollowupActions(ctx, { actions, runAt } = {}) {
  const dt = dayjs(runAt);
  if (!dt.isValid()) throw new Error("Invalid `runAt`. Use ISO 8601 (example: 2026-02-16T10:00:00+05:30).");

  let scheduled = 0;
  let skipped = 0;
  for (const a of actions || []) {
    if (a.kind === "skip") {
      skipped += 1;
      continue;
    }
    if (a.kind === "text") {
      // eslint-disable-next-line no-await-in-loop
      await ctx.registry.get("schedule.add_text").execute(ctx, { to: a.to, body: a.body, runAt: dt.toISOString() });
      scheduled += 1;
      continue;
    }
    if (a.kind === "template") {
      // eslint-disable-next-line no-await-in-loop
      await ctx.registry.get("schedule.add_template").execute(ctx, {
        to: a.to,
        templateName: a.templateName,
        language: a.language || "en",
        params: a.params,
        category: "utility",
        runAt: dt.toISOString()
      });
      scheduled += 1;
      continue;
    }
    skipped += 1;
  }
  return { scheduled, skipped };
}

module.exports = { getMissedLeads, buildFollowupActions, summarizePlan, scheduleFollowupActions };

