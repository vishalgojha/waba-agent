// src-ts/domain/jaspers-market/playbook.ts
import { JASPERS_CATALOG } from "./catalog.js";
import type { MarketPlan, MarketProduct, MarketSession } from "./types.js";

function nowIso(): string {
  return new Date().toISOString();
}

function parseBudget(text: string): number | undefined {
  const m = text.match(/(?:under|below|budget)\s*₹?\s*(\d{2,6})/i) || text.match(/₹\s*(\d{2,6})/i);
  if (!m) return undefined;
  const v = Number(m[1]);
  if (!Number.isFinite(v) || v <= 0) return undefined;
  return v;
}

function parseOccasion(text: string): string | undefined {
  const t = text.toLowerCase();
  if (t.includes("birthday")) return "birthday";
  if (t.includes("anniversary")) return "anniversary";
  if (t.includes("wedding")) return "wedding";
  if (t.includes("congrats") || t.includes("congratulations")) return "congrats";
  if (t.includes("thank")) return "thank-you";
  return undefined;
}

function parseProductCode(text: string): string | undefined {
  const m = text.toUpperCase().match(/\bP\d+\b/);
  return m?.[0];
}

function hasCheckoutDetails(text: string): boolean {
  const t = String(text || "").trim();
  if (!t) return false;
  const hasDateHint = /\b(today|tomorrow|am|pm|\d{1,2}[\/-]\d{1,2}([\/-]\d{2,4})?|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(t);
  const hasRecipientHint = /\b(name|recipient|deliver|delivery|address|flat|house|society|lane|street|road|pincode|pin)\b/i.test(t);
  return hasDateHint || hasRecipientHint || t.split(/\s+/).length >= 5;
}

function isConfirmOrder(text: string): boolean {
  return /\bconfirm\s+order\b/i.test(String(text || ""));
}

function isEditOrder(text: string): boolean {
  return /\b(edit|change|modify)\s+order\b/i.test(String(text || ""));
}

function topRecommendations(occasion?: string, budgetMaxInr?: number): MarketProduct[] {
  const scored = JASPERS_CATALOG.map((p) => {
    let score = 0;
    if (occasion && p.tags.includes(occasion)) score += 3;
    if (budgetMaxInr !== undefined && p.priceInr <= budgetMaxInr) score += 2;
    if (p.category === "bouquet" || p.category === "gift_box") score += 1;
    return { p, score };
  })
    .sort((a, b) => b.score - a.score || a.p.priceInr - b.p.priceInr)
    .map((x) => x.p);

  return scored.slice(0, 3);
}

function renderMenu(): string {
  return [
    "Welcome to Jaspers Market.",
    "Tell me occasion + budget and I will suggest products.",
    "Examples:",
    '- "birthday under 1000"',
    '- "anniversary budget 1500"',
    "You can also select by product code: P1, P2, P3..."
  ].join("\n");
}

function renderRecommendations(items: MarketProduct[]): string {
  if (!items.length) return "I could not find a perfect match. Share occasion and budget to refine.";
  const lines = items.map((x) => `${x.code} - ${x.name} (INR ${x.priceInr})`);
  return ["Recommended options:", ...lines, "Reply with product code (example: P2)."].join("\n");
}

function quoteFor(product: MarketProduct): { subtotalInr: number; deliveryInr: number; totalInr: number } {
  const subtotalInr = product.priceInr;
  const deliveryInr = subtotalInr >= 1500 ? 0 : 120;
  return { subtotalInr, deliveryInr, totalInr: subtotalInr + deliveryInr };
}

export function planMarketReply(inputText: string, phone: string, prev: MarketSession | null): MarketPlan {
  const base: MarketSession = prev || {
    phone,
    updatedAt: nowIso(),
    stage: "new"
  };

  const text = String(inputText || "").trim();
  const lower = text.toLowerCase();
  const budget = parseBudget(text) ?? base.budgetMaxInr;
  const occasion = parseOccasion(text) ?? base.occasion;
  const selectedCode = parseProductCode(text);

  if (!text || /\b(hi|hello|start|menu|shop)\b/i.test(lower)) {
    const nextSession: MarketSession = { ...base, updatedAt: nowIso(), stage: "menu" };
    return {
      stage: nextSession.stage,
      risk: "MEDIUM",
      replyText: renderMenu(),
      nextSession,
      recommendations: []
    };
  }

  if (selectedCode) {
    const chosen = JASPERS_CATALOG.find((x) => x.code === selectedCode);
    if (chosen) {
      const nextSession: MarketSession = {
        ...base,
        updatedAt: nowIso(),
        stage: "selected",
        occasion,
        budgetMaxInr: budget,
        selectedProductCode: selectedCode
      };
      return {
        stage: nextSession.stage,
        risk: "MEDIUM",
        replyText: `Selected: ${chosen.name} (INR ${chosen.priceInr}).\nReply with recipient + delivery details to generate your quote.`,
        nextSession,
        recommendations: [chosen]
      };
    }
  }

  if (base.stage === "selected" && base.selectedProductCode && hasCheckoutDetails(text)) {
    const chosen = JASPERS_CATALOG.find((x) => x.code === base.selectedProductCode);
    if (chosen) {
      const quote = quoteFor(chosen);
      const nextSession: MarketSession = {
        ...base,
        updatedAt: nowIso(),
        stage: "checkout",
        recipientNote: text.slice(0, 240),
        quoteTotalInr: quote.totalInr,
        checkoutConfirmed: false
      };
      return {
        stage: nextSession.stage,
        risk: "MEDIUM",
        replyText: [
          `Quote for ${chosen.name}:`,
          `Item: INR ${quote.subtotalInr}`,
          `Delivery: INR ${quote.deliveryInr}`,
          `Total: INR ${quote.totalInr}`,
          "Reply exactly: CONFIRM ORDER",
          "Or reply: EDIT ORDER"
        ].join("\n"),
        nextSession,
        recommendations: [chosen]
      };
    }
  }

  if (base.stage === "checkout" && base.selectedProductCode) {
    const chosen = JASPERS_CATALOG.find((x) => x.code === base.selectedProductCode);
    if (isEditOrder(text)) {
      const nextSession: MarketSession = {
        ...base,
        updatedAt: nowIso(),
        stage: "selected",
        checkoutConfirmed: false
      };
      return {
        stage: nextSession.stage,
        risk: "MEDIUM",
        replyText: "Order moved back to edit mode. Share a new product code (example: P3).",
        nextSession,
        recommendations: chosen ? [chosen] : []
      };
    }
    if (isConfirmOrder(text)) {
      const nextSession: MarketSession = {
        ...base,
        updatedAt: nowIso(),
        stage: "checkout",
        checkoutConfirmed: true
      };
      const total = Number(base.quoteTotalInr || (chosen ? quoteFor(chosen).totalInr : 0));
      return {
        stage: nextSession.stage,
        risk: "HIGH",
        replyText: [
          `Order confirmed for ${chosen?.name || "selected item"} (INR ${total}).`,
          "A payment link and final delivery confirmation will be shared by our team shortly."
        ].join("\n"),
        nextSession,
        recommendations: chosen ? [chosen] : []
      };
    }
    return {
      stage: base.stage,
      risk: "MEDIUM",
      replyText: "Please reply exactly: CONFIRM ORDER to proceed, or EDIT ORDER to change selection.",
      nextSession: { ...base, updatedAt: nowIso() },
      recommendations: chosen ? [chosen] : []
    };
  }

  const recos = topRecommendations(occasion, budget);
  const nextSession: MarketSession = {
    ...base,
    updatedAt: nowIso(),
    stage: occasion || budget ? "qualified" : "menu",
    occasion,
    budgetMaxInr: budget
  };
  return {
    stage: nextSession.stage,
    risk: "MEDIUM",
    replyText: renderRecommendations(recos),
    nextSession,
    recommendations: recos
  };
}
