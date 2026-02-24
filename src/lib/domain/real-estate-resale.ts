// @ts-nocheck
const fs = require("fs-extra");
const path = require("path");
const dayjs = require("dayjs");

const { contextDir } = require("../paths");
const { safeName, appendMemory, readMemory } = require("../memory");
const { getClientConfig, setClientConfig } = require("../client-config");
const { readSchedules, writeSchedules, newId } = require("../schedule-store");
const { hasAiProviderConfigured } = require("../ai/openai");

const DOMAIN_ID = "real-estate-resale";
const DOMAIN_VERSION = "2026.02.16";
const DOMAIN_ROOT = path.resolve(__dirname, "..", "..", "..", "domain", DOMAIN_ID);
const FLOWS_PATH = path.join(DOMAIN_ROOT, "flows", "nurture-sequences.json");
const PROMPT_PATH = path.join(DOMAIN_ROOT, "intents", "system-prompt.txt");
const FEW_SHOT_PATH = path.join(DOMAIN_ROOT, "intents", "few-shot.json");
const EN_TEMPLATES_PATH = path.join(DOMAIN_ROOT, "templates", "templates.en.json");
const HI_TEMPLATES_PATH = path.join(DOMAIN_ROOT, "templates", "templates.hi.json");

function leadsStorePath(client) {
  return path.join(contextDir(), safeName(client), "resale-leads.json");
}

async function readLeadStore(client) {
  const p = leadsStorePath(client);
  if (!(await fs.pathExists(p))) return [];
  try {
    const rows = await fs.readJson(p);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

async function writeLeadStore(client, leads) {
  const p = leadsStorePath(client);
  await fs.ensureDir(path.dirname(p));
  await fs.writeJson(p, leads, { spaces: 2 });
  try {
    await fs.chmod(p, 0o600);
  } catch {}
  return p;
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

function parseSimpleCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];
    if (ch === '"') {
      if (inQuotes && next === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function parseCsv(text) {
  const rows = String(text || "")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
  if (!rows.length) return [];
  const header = parseSimpleCsvLine(rows[0]).map((x) => x.trim().toLowerCase());
  const data = [];
  for (const line of rows.slice(1)) {
    const cols = parseSimpleCsvLine(line);
    const rec = {};
    for (let i = 0; i < header.length; i++) rec[header[i]] = cols[i] ?? "";
    data.push(rec);
  }
  return data;
}

function parsePastedContacts(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
  const rows = [];
  for (const line of lines) {
    const parts = line.split("|").map((x) => x.trim());
    if (parts.length < 2) continue;
    rows.push({
      name: parts[0],
      phone: parts[1],
      last_message_date: parts[2] || "",
      property_interested: parts[3] || "",
      notes: parts[4] || ""
    });
  }
  return rows;
}

function parseDateLike(input) {
  const s = String(input || "").trim();
  if (!s) return null;
  const d = dayjs(s);
  if (!d.isValid()) return null;
  return d.toISOString();
}

function normalizeLeadRow(row) {
  const name = String(row.name || row.customer_name || row.lead_name || "").trim() || null;
  const phone = normalizePhone(row.phone || row.mobile || row.number);
  if (!phone) return null;
  const lastMessageDate = parseDateLike(row.last_message_date || row.last_contact_date || row.last_message || row.last_contact_at);
  const propertyInterested = String(row.property_interested || row.property || row.requirement || "").trim() || null;
  const notes = String(row.notes || row.note || "").trim() || null;
  return {
    id: `lead_${phone.replace(/[^\d]/g, "")}`,
    name,
    phone,
    last_message_date: lastMessageDate,
    property_interested: propertyInterested,
    notes,
    imported_at: new Date().toISOString(),
    source: "import"
  };
}

function mergeLeads(existing, incoming) {
  const byPhone = new Map((existing || []).map((x) => [String(x.phone || ""), x]));
  for (const lead of incoming || []) {
    if (!lead?.phone) continue;
    const prev = byPhone.get(lead.phone) || {};
    byPhone.set(lead.phone, { ...prev, ...lead, updated_at: new Date().toISOString() });
  }
  return [...byPhone.values()].sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

async function loadJson(p, fallback = null) {
  try {
    const data = await fs.readJson(p);
    return data && typeof data === "object" ? data : fallback;
  } catch {
    return fallback;
  }
}

async function loadResaleTemplatePack(lang = "en") {
  const p = lang === "hi" ? HI_TEMPLATES_PATH : EN_TEMPLATES_PATH;
  const data = await loadJson(p, { templates: [] });
  return Array.isArray(data?.templates) ? data.templates : [];
}

async function loadResaleFewShot() {
  const data = await loadJson(FEW_SHOT_PATH, { examples: [] });
  return Array.isArray(data?.examples) ? data.examples : [];
}

async function getResaleSystemPrompt() {
  try {
    return await fs.readFile(PROMPT_PATH, "utf8");
  } catch {
    return "You are a strict real-estate resale WhatsApp assistant for Indian brokers.";
  }
}

async function loadNurtureFlows() {
  const data = await loadJson(FLOWS_PATH, { buckets: [] });
  return data && typeof data === "object" ? data : { buckets: [] };
}

function classifyRecencyBucket(lastMessageDate, now = dayjs()) {
  if (!lastMessageDate) return "older_30_plus";
  const dt = dayjs(lastMessageDate);
  if (!dt.isValid()) return "older_30_plus";
  const days = Math.max(0, now.diff(dt, "day"));
  if (days < 7) return "recent_0_6";
  if (days <= 30) return "warm_7_30";
  return "older_30_plus";
}

async function activateResaleMagic({ client, enabled = true } = {}) {
  const c = safeName(client || "default");
  const patch = {
    domain: {
      vertical: DOMAIN_ID,
      version: DOMAIN_VERSION,
      activatedAt: new Date().toISOString()
    },
    resaleMagic: {
      enabled: !!enabled,
      autonomousPercent: 85,
      strictVerticalScope: true,
      fallbackMode: "templates_and_schedule_only",
      allowedActions: [
        "template.send",
        "message.send_text_buttons",
        "lead.schedule_followup",
        "lead.tag",
        "lead.escalate_human"
      ],
      guardrails: {
        requireApprovalFor: ["money_transfer", "legal_docs", "external_api_calls"],
        forceHumanOnLowConfidence: true
      },
      defaultFollowupTemplateName: "resale_day1_followup_hi",
      defaultFollowupLanguage: "hi"
    }
  };
  const out = await setClientConfig(c, patch);
  await appendMemory(c, {
    type: "resale_magic_activated",
    enabled: !!enabled,
    domain: DOMAIN_ID
  });
  return out;
}

async function importResaleLeads({ client, csvPath, csvText, pasteText, append = true } = {}) {
  const c = safeName(client || "default");
  let raw = "";
  if (csvPath) raw = await fs.readFile(path.resolve(csvPath), "utf8");
  if (!raw && csvText) raw = String(csvText);

  let rows = [];
  if (raw) rows = parseCsv(raw);
  if (!rows.length && pasteText) rows = parsePastedContacts(pasteText);
  const normalized = rows.map(normalizeLeadRow).filter(Boolean);

  const existing = append ? await readLeadStore(c) : [];
  const merged = mergeLeads(existing, normalized);
  const storePath = await writeLeadStore(c, merged);
  await appendMemory(c, {
    type: "resale_leads_imported",
    imported: normalized.length,
    total: merged.length
  });
  return {
    imported: normalized.length,
    total: merged.length,
    leads: merged,
    path: storePath
  };
}

function hydrateLeadFromProfile(lead) {
  const x = { ...lead };
  x.preferred_area = x.preferred_area || x.property_interested || null;
  x.preferred_bhk = x.preferred_bhk || null;
  x.timeline_months = Number.isFinite(Number(x.timeline_months)) ? Number(x.timeline_months) : null;
  x.budget_min = Number.isFinite(Number(x.budget_min)) ? Number(x.budget_min) : null;
  x.budget_max = Number.isFinite(Number(x.budget_max)) ? Number(x.budget_max) : null;
  return x;
}

function pickBucketConfig(flows, bucketId) {
  const buckets = Array.isArray(flows?.buckets) ? flows.buckets : [];
  return buckets.find((b) => b.id === bucketId) || null;
}

function buildTemplateParams(lead) {
  const x = hydrateLeadFromProfile(lead);
  const budgetRange = x.budget_min && x.budget_max
    ? `${Math.round(x.budget_min / 100000)}L-${Math.round(x.budget_max / 100000)}L`
    : x.budget_max
      ? `up to ${Math.round(x.budget_max / 100000)}L`
      : "flexible";
  return [
    x.name || "Sir/Ma'am",
    x.preferred_area || "your preferred area",
    x.preferred_bhk || "2 BHK",
    budgetRange
  ];
}

async function queueMagicNurture({ client, nowIso, dryRun = false, limit = 100 } = {}) {
  const c = safeName(client || "default");
  const leads = (await readLeadStore(c)).slice(0, Math.max(1, Math.min(500, Number(limit) || 100)));
  const flows = await loadNurtureFlows();
  const now = nowIso ? dayjs(nowIso) : dayjs();
  if (!now.isValid()) throw new Error("Invalid now timestamp.");

  const planned = [];
  for (const lead of leads) {
    const bucketId = classifyRecencyBucket(lead.last_message_date, now);
    const bucket = pickBucketConfig(flows, bucketId);
    if (!bucket) continue;
    const steps = Array.isArray(bucket.steps) ? bucket.steps : [];
    for (const step of steps) {
      const offsetDays = Number(step.offset_days || 0);
      const runAt = now.add(offsetDays, "day").toISOString();
      planned.push({
        id: newId(),
        kind: "template",
        to: lead.phone,
        templateName: step.template_name,
        language: step.language || "hi",
        params: buildTemplateParams(lead),
        category: step.category || "marketing",
        runAt,
        status: "pending",
        createdAt: new Date().toISOString(),
        client: c,
        meta: {
          source: "resale_magic",
          bucket: bucket.id,
          lead_id: lead.id
        }
      });
    }
  }

  if (!dryRun) {
    const list = await readSchedules();
    list.push(...planned);
    await writeSchedules(list);
  }

  await appendMemory(c, {
    type: "resale_magic_nurture_queued",
    queued: planned.length,
    dryRun: !!dryRun
  });
  return {
    queued: planned.length,
    dryRun: !!dryRun,
    sample: planned.slice(0, 12),
    leads: leads.length
  };
}

function toInr(v, unit) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const u = String(unit || "").toLowerCase();
  if (u.startsWith("cr")) return n * 10000000;
  if (u.startsWith("l")) return n * 100000;
  if (u === "k") return n * 1000;
  return n;
}

function parseBudgetRange(text) {
  const src = String(text || "").toLowerCase();
  const m = src.match(/(\d+(?:\.\d+)?)\s*(cr|crore|l|lac|lakh|k)?\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*(cr|crore|l|lac|lakh|k)?/);
  if (m) {
    const min = toInr(m[1], m[2] || m[4]);
    const max = toInr(m[3], m[4] || m[2]);
    if (min && max) return { budget_min: Math.min(min, max), budget_max: Math.max(min, max) };
  }
  const single = src.match(/(?:budget|under|upto|up to)\s*(\d+(?:\.\d+)?)\s*(cr|crore|l|lac|lakh|k)/);
  if (single) {
    const max = toInr(single[1], single[2]);
    if (max) return { budget_min: null, budget_max: max };
  }
  return null;
}

function parseTimelineMonths(text) {
  const src = String(text || "").toLowerCase();
  const m = src.match(/(\d{1,2})\s*(month|months|mahina|mahine)/);
  if (m) return Number(m[1]);
  if (/\bimmediate|asap|urgent|jaldi\b/.test(src)) return 1;
  if (/\bthis year\b/.test(src)) return 6;
  return null;
}

function parsePreferredBhk(text) {
  const src = String(text || "").toLowerCase();
  const m = src.match(/\b([1-5])\s*bhk\b/);
  if (m) return `${m[1]} BHK`;
  if (/\b4\+\s*bhk\b/.test(src)) return "4+ BHK";
  return null;
}

function parsePreferredArea(text) {
  const src = String(text || "");
  const m = src.match(/\b(?:in|near|around|area)\s+([a-zA-Z][a-zA-Z0-9\s-]{2,40})/i);
  if (!m) return null;
  return String(m[1]).trim().replace(/\s+/g, " ");
}

function detectResaleIntent(text) {
  const t = String(text || "").toLowerCase();
  if (!t) return null;
  if (/\b(brochure|details|catalog|floor ?plan)\b/.test(t)) return "brochure_request";
  if (/\b(site visit|visit|showing|inspection)\b/.test(t)) return "site_visit_interest";
  if (/\b(loan|home loan|emi|finance)\b/.test(t)) return "loan_query";
  if (/\b(negotia|best price|discount|kam karo|price drop)\b/.test(t)) return "negotiation_interest";
  if (/\b(not interested|no longer|stop|reject)\b/.test(t)) return "rejection";
  if (/\b(budget|bhk|location|timeline|buy)\b/.test(t)) return "qualification";
  return "general_resale";
}

function detectLanguageFromText(text) {
  const t = String(text || "");
  if (!t.trim()) return null;
  if (/[\u0900-\u097F]/.test(t)) return "hi";
  if (/\b(kya|hai|haan|nahi|krna|chahiye|bhk|budget|kal|aaj|bataiye)\b/i.test(t)) return "hi";
  if (/[a-z]/i.test(t)) return "en";
  return null;
}

function scoreLead(profile) {
  const p = profile || {};
  let score = 0;
  if (p.timeline_months && p.timeline_months <= 2) score += 2;
  if (p.budget_max) score += 1;
  if (p.preferred_area) score += 1;
  if (p.preferred_bhk) score += 1;
  if (["site_visit_interest", "negotiation_interest"].includes(p.last_intent)) score += 2;
  if (score >= 5) return "hot";
  if (score >= 3) return "warm";
  return "cold";
}

function extractResaleLeadProfile(text, prevProfile = {}) {
  const base = { ...(prevProfile || {}) };
  const budget = parseBudgetRange(text);
  const timeline = parseTimelineMonths(text);
  const bhk = parsePreferredBhk(text);
  const area = parsePreferredArea(text);
  const intent = detectResaleIntent(text);
  const out = { ...base };
  if (budget) {
    out.budget_min = budget.budget_min ?? out.budget_min ?? null;
    out.budget_max = budget.budget_max ?? out.budget_max ?? null;
  }
  if (timeline) out.timeline_months = timeline;
  if (bhk) out.preferred_bhk = bhk;
  if (area) out.preferred_area = area;
  if (intent) out.last_intent = intent;
  out.notes = String(out.notes || "");
  out.lead_score = scoreLead(out);
  const changed = JSON.stringify(base) !== JSON.stringify(out);
  return { changed, profile: out };
}

function isResaleScopeInput(text) {
  const t = String(text || "").toLowerCase();
  if (!t) return true;
  if (/\b(help|status|schedule|template|memory|lead)\b/.test(t)) return true;
  return /\b(resale|2 ?bhk|3 ?bhk|4 ?bhk|flat|apartment|plot|villa|row house|independent house|budget|location|site visit|brochure|loan|negotiation|price|property)\b/.test(t);
}

function isResaleMagicEnabled(clientCfg) {
  const cfg = clientCfg && typeof clientCfg === "object" ? clientCfg : {};
  return cfg?.domain?.vertical === DOMAIN_ID && cfg?.resaleMagic?.enabled === true;
}

async function computeResaleMagicMetrics({ client, hours = 48 } = {}) {
  const c = safeName(client || "default");
  const leads = await readLeadStore(c);
  const events = await readMemory(c, { limit: 50000 });
  const sinceTs = Date.now() - (Math.max(1, Number(hours) || 48) * 60 * 60 * 1000);

  const firstMagicOutboundByPhone = new Map();
  const inboundAfterMagic = new Set();
  const qualifiedPhones = new Set();
  let brochureRequests = 0;
  let siteVisitRequests = 0;

  for (const e of events) {
    const ts = Date.parse(e.ts || "");
    if (!Number.isFinite(ts) || ts < sinceTs) continue;
    const to = normalizePhone(e.to || e.phone || e.recipient);
    const from = normalizePhone(e.from || e.phone || e.sender);
    if ((e.type === "resale_magic_outbound" || (e.type === "outbound_sent" && e?.meta?.source === "resale_magic")) && to) {
      if (!firstMagicOutboundByPhone.has(to)) firstMagicOutboundByPhone.set(to, ts);
    }
    if ((e.type === "inbound_message" || e.type === "inbound_text" || String(e.type || "").startsWith("inbound_")) && from) {
      const first = firstMagicOutboundByPhone.get(from);
      if (first && ts > first) inboundAfterMagic.add(from);
    }
    if (e.type === "lead_profile_update" && e.phone) {
      const p = e.profile || {};
      if ((p.budget_min || p.budget_max) && p.timeline_months) qualifiedPhones.add(normalizePhone(e.phone));
      if (p.last_intent === "brochure_request") brochureRequests += 1;
      if (p.last_intent === "site_visit_interest") siteVisitRequests += 1;
    }
    if (e.type === "resale_intent_detected") {
      if (e.intent === "brochure_request") brochureRequests += 1;
      if (e.intent === "site_visit_interest") siteVisitRequests += 1;
    }
  }

  const imported = leads.length;
  const reengaged = inboundAfterMagic.size;
  const qualified = [...qualifiedPhones].filter(Boolean).length;
  const funnel = {
    imported,
    messaged: firstMagicOutboundByPhone.size,
    reengaged,
    qualified,
    site_visit_or_brochure: siteVisitRequests + brochureRequests
  };
  return {
    windowHours: Number(hours) || 48,
    contacts_reengaged: reengaged,
    qualified_leads: qualified,
    brochure_requests: brochureRequests,
    site_visit_requests: siteVisitRequests,
    funnel
  };
}

function buildShareableWin(metrics, client) {
  const m = metrics || {};
  return {
    title: `Resale Magic Mode - ${safeName(client || "default")} - ${m.windowHours || 48}h`,
    lines: [
      `Contacts re-engaged: ${m.contacts_reengaged || 0}`,
      `Qualified leads: ${m.qualified_leads || 0}`,
      `Brochure requests: ${m.brochure_requests || 0}`,
      `Site visit requests: ${m.site_visit_requests || 0}`
    ],
    funnel: m.funnel || {}
  };
}

module.exports = {
  DOMAIN_ID,
  DOMAIN_VERSION,
  DOMAIN_ROOT,
  isResaleMagicEnabled,
  hasAiProviderConfigured,
  normalizePhone,
  parseCsv,
  parsePastedContacts,
  readLeadStore,
  writeLeadStore,
  loadResaleTemplatePack,
  loadResaleFewShot,
  getResaleSystemPrompt,
  activateResaleMagic,
  importResaleLeads,
  queueMagicNurture,
  classifyRecencyBucket,
  extractResaleLeadProfile,
  detectResaleIntent,
  detectLanguageFromText,
  isResaleScopeInput,
  computeResaleMagicMetrics,
  buildShareableWin
};
