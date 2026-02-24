// @ts-nocheck
const dayjs = require("dayjs");

function safeString(x) {
  if (x === null || x === undefined) return "";
  return String(x);
}

function normalizeInteractive(interactive) {
  const type = interactive?.type;
  if (type === "button_reply") {
    return {
      kind: "button_reply",
      id: interactive.button_reply?.id,
      title: interactive.button_reply?.title
    };
  }
  if (type === "list_reply") {
    return {
      kind: "list_reply",
      id: interactive.list_reply?.id,
      title: interactive.list_reply?.title,
      description: interactive.list_reply?.description
    };
  }
  return null;
}

function parseWebhookPayload(payload) {
  const events = [];
  const entries = payload?.entry || [];

  for (const entry of entries) {
    for (const change of entry?.changes || []) {
      const value = change?.value || {};

      const messages = value?.messages || [];
      for (const m of messages) {
        let ts = new Date().toISOString();
        if (m.timestamp) {
          const d = dayjs.unix(Number(m.timestamp));
          if (d.isValid()) ts = d.toISOString();
        }
        const interactive = normalizeInteractive(m.interactive);
        const text =
          m.type === "text"
            ? safeString(m.text?.body)
            : m.type === "button"
              ? safeString(m.button?.text || m.button?.payload || "")
            : m.type === "interactive"
              ? safeString(interactive?.title || interactive?.id || "")
              : "";

        events.push({
          kind: "message",
          id: m.id,
          from: m.from,
          type: m.type,
          timestamp: ts,
          text,
          interactive,
          image: m.image,
          audio: m.audio,
          button: m.button,
          context: m.context,
          raw: m
        });
      }

      const statuses = value?.statuses || [];
      for (const s of statuses) {
        let ts = new Date().toISOString();
        if (s.timestamp) {
          const d = dayjs.unix(Number(s.timestamp));
          if (d.isValid()) ts = d.toISOString();
        }
        events.push({
          kind: "status",
          id: s.id,
          status: s.status,
          recipient_id: s.recipient_id,
          timestamp: ts,
          errors: s.errors,
          raw: s
        });
      }
    }
  }

  return events;
}

function ruleBasedIntent(text) {
  const t = safeString(text).toLowerCase();
  if (!t.trim()) return { intent: "unknown", confidence: 0.2, signals: [] };

  const signals = [];
  const has = (re, label) => {
    if (re.test(t)) signals.push(label);
  };

  has(/\b(price|cost|rate|quotation|quote|charges|fees)\b/, "price");
  has(/\b(book|booking|appointment|slot|visit|schedule|demo)\b/, "booking");
  has(/\b(order|buy|purchase|deliver|delivery|cod)\b/, "order");
  has(/\b(hello|hi|hey|hii|hlo|namaste)\b/, "greeting");

  const intent =
    signals.includes("price")
      ? "price_inquiry"
      : signals.includes("booking")
        ? "booking_request"
        : signals.includes("order")
          ? "order_intent"
          : signals.includes("greeting")
            ? "greeting"
            : "unknown";

  const confidence = intent === "unknown" ? 0.35 : 0.75;
  return { intent, confidence, signals };
}

module.exports = {
  parseWebhookPayload,
  ruleBasedIntent
};
