// @ts-nocheck
const dayjs = require("dayjs");

const { readMemory } = require("./memory");

function toNumber(x, d = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : d;
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor((p / 100) * (sorted.length - 1));
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

function withinDays(ts, days) {
  const d = dayjs(ts);
  if (!d.isValid()) return false;
  return d.isAfter(dayjs().subtract(days, "day"));
}

function normalizeIntent(x) {
  if (!x) return null;
  return String(x).trim().toLowerCase();
}

async function computeMetrics({ client, days = 30, pricing } = {}) {
  const events = await readMemory(client, { limit: 50_000 });
  const recent = events.filter((e) => withinDays(e.ts, days));

  const inbound = recent.filter((e) => e.type === "inbound_message" || e.type === "inbound_text");
  const outbound = recent.filter((e) => e.type === "outbound_sent" || e.type === "auto_reply_sent");
  const classifications = recent.filter((e) => e.type === "lead_classification");

  // Lead volume: unique senders + total inbound.
  const uniqueFrom = new Set(inbound.map((e) => e.from).filter(Boolean));

  // Intent/funnel: from classifications if present, else from webhook intent notes (best-effort).
  const intentCounts = {};
  for (const c of classifications) {
    const intent = normalizeIntent(c.result?.intent) || "unknown";
    intentCounts[intent] = (intentCounts[intent] || 0) + 1;
  }

  // Response times: next outbound to same number after each inbound.
  const outByTo = new Map();
  for (const o of outbound) {
    const to = o.to || o.recipient || o.to_number;
    if (!to) continue;
    const list = outByTo.get(to) || [];
    list.push(o);
    outByTo.set(to, list);
  }
  for (const [to, list] of outByTo.entries()) {
    list.sort((a, b) => dayjs(a.ts).valueOf() - dayjs(b.ts).valueOf());
    outByTo.set(to, list);
  }

  const responseMinutes = [];
  for (const i of inbound) {
    const from = i.from;
    if (!from) continue;
    const list = outByTo.get(from);
    if (!list?.length) continue;
    const t0 = dayjs(i.ts);
    if (!t0.isValid()) continue;
    const next = list.find((o) => dayjs(o.ts).isAfter(t0));
    if (!next) continue;
    const dt = dayjs(next.ts).diff(t0, "minute", true);
    if (dt >= 0) responseMinutes.push(dt);
  }

  // Cost estimate from outbound counts.
  const rates = pricing || { inrPerUtility: 0.11, inrPerMarketing: 0.78 };
  let utility = 0;
  let marketing = 0;
  let unknown = 0;

  for (const o of outbound) {
    const cat = normalizeIntent(o.category);
    if (cat === "utility") utility += 1;
    else if (cat === "marketing") marketing += 1;
    else unknown += 1;
  }

  const costs = {
    messages: { utility, marketing, unknown, total: utility + marketing + unknown },
    inr: {
      utility: utility * toNumber(rates.inrPerUtility, 0.11),
      marketing: marketing * toNumber(rates.inrPerMarketing, 0.78),
      unknown: null,
      totalKnown: utility * toNumber(rates.inrPerUtility, 0.11) + marketing * toNumber(rates.inrPerMarketing, 0.78)
    }
  };

  return {
    client,
    windowDays: days,
    leads: {
      inboundMessages: inbound.length,
      uniqueSenders: uniqueFrom.size
    },
    responses: {
      samples: responseMinutes.length,
      avgMinutes: responseMinutes.length ? responseMinutes.reduce((a, b) => a + b, 0) / responseMinutes.length : null,
      p50Minutes: percentile(responseMinutes, 50),
      p90Minutes: percentile(responseMinutes, 90)
    },
    funnel: {
      intents: intentCounts
    },
    costs
  };
}

module.exports = { computeMetrics };

