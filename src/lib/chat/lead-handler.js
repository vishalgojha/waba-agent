const dayjs = require("dayjs");

const { getMissedLeads } = require("../followup");

function normalizePhone(text) {
  const src = String(text || "").trim();
  if (!src) return null;
  const digits = src.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return null;
}

function parseLeadAnnouncement(input) {
  const text = String(input || "");
  const count = Number(text.match(/\b(\d+)\s+new?\s*leads?\b/i)?.[1] || text.match(/\b(\d+)\s+leads?\b/i)?.[1] || 0);
  if (!count) return null;
  const source = text.match(/\bfrom\s+([a-z0-9._-]+)/i)?.[1] || null;
  const client = text.match(/\bfor\s+([a-z0-9._-]+)/i)?.[1] || null;
  return { count, source, client };
}

function parseFollowupIntent(input) {
  const text = String(input || "").toLowerCase();
  if (!/\bfollow[- ]?up|reminder|non-?respond/.test(text)) return null;
  const time = text.match(/\b(tomorrow|today|\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i)?.[1] || null;
  return { schedule: /\bschedule|tomorrow|today|10am|11am|12pm|\bat\b/.test(text), time };
}

function parseLanguageIntent(input) {
  const t = String(input || "").toLowerCase();
  if (/\bhindi\b|\bहिंदी\b|\bhinglish\b/.test(t)) return "hi";
  if (/[\u0900-\u097F]/.test(String(input || ""))) return "hi";
  if (/\b(kya|hai|haan|nahi|aap|krna|chahiye|bhai|bhk|budget|kal|aaj)\b/.test(t)) return "hi";
  if (/\benglish\b/.test(t)) return "en";
  return null;
}

class LeadHandler {
  constructor(context) {
    this.context = context;
  }

  deriveLeadListFromContext(count) {
    const now = new Date().toISOString();
    const leads = [];
    for (let i = 0; i < count; i++) {
      leads.push({
        phone: `+91980000${String(1000 + i)}`,
        name: `Lead ${i + 1}`,
        status: "active",
        source: "manual",
        lastContactAt: now
      });
    }
    return leads;
  }

  async missedLeadSummary(client) {
    const missed = await getMissedLeads({
      client: client || "default",
      sinceMs: 7 * 24 * 60 * 60 * 1000,
      minAgeMs: 10 * 60 * 1000,
      limit: 10
    });
    return missed.map((x) => ({
      phone: x.from ? `+${String(x.from).replace(/[^\d]/g, "")}` : null,
      lastInboundAt: x.lastInboundAt,
      ageHours: Math.max(0, dayjs().diff(dayjs(x.lastInboundAt), "hour"))
    }));
  }

  heuristic(userInput) {
    const leadAnnouncement = parseLeadAnnouncement(userInput);
    if (leadAnnouncement) {
      const leads = this.deriveLeadListFromContext(leadAnnouncement.count);
      this.context.upsertLeads(leads);
      return {
        message:
          `Great, I noted ${leadAnnouncement.count} new leads${leadAnnouncement.source ? ` from ${leadAnnouncement.source}` : ""}. ` +
          "Should I send welcome messages, qualify them first, or show the lead list?",
        actions: [],
        suggestions: ["Send welcome template", "Qualify leads", "Show lead list"],
        needsInput: true
      };
    }

    if (/\bqualify\b/i.test(String(userInput || ""))) {
      const leads = this.context.leads || [];
      const actions = leads.slice(0, 25).map((lead) => ({
        tool: "message.send_text",
        params: {
          to: normalizePhone(lead.phone),
          body: "Hi! Please share budget, preferred location, timeline, and BHK requirement."
        },
        description: `Send qualification message to ${lead.name || lead.phone}`
      }));
      return {
        message: actions.length
          ? `I can qualify ${actions.length} lead(s) by sending standard qualification questions.`
          : "I do not have lead phone numbers yet. Share numbers or import from your lead source.",
        actions,
        suggestions: ["Schedule follow-ups tomorrow 10am", "Show lead summary"],
        needsInput: false
      };
    }

    const followup = parseFollowupIntent(userInput);
    if (followup) {
      return {
        message:
          "I can schedule follow-ups for non-responders. Tell me the exact time (for example: tomorrow 10am), " +
          "or say 'run now' to send immediately where compliant.",
        actions: [],
        suggestions: ["tomorrow 10am", "today 6pm", "show non-responders"],
        needsInput: true
      };
    }

    return null;
  }
}

module.exports = {
  LeadHandler,
  parseLeadAnnouncement,
  parseFollowupIntent,
  parseLanguageIntent,
  normalizePhone
};
