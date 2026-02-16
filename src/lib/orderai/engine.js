const fs = require("fs-extra");
const path = require("path");

const { wabaHome } = require("../paths");
const { MENU_ITEMS } = require("./menu");

const PROFILE_PATH = path.join(wabaHome(), "orderai-profile.json");
const DELIVERY_FEE_ESTIMATE = 39;
const GST_RATE = 0.05;

const NUMBER_WORDS = {
  ek: 1,
  one: 1,
  do: 2,
  two: 2,
  teen: 3,
  three: 3,
  char: 4,
  chaar: 4,
  four: 4,
  paanch: 5,
  five: 5,
  cheh: 6,
  six: 6,
  saat: 7,
  seven: 7,
  aath: 8,
  eight: 8,
  nau: 9,
  nine: 9,
  dus: 10,
  ten: 10
};

function round2(n) {
  return Number(Number(n || 0).toFixed(2));
}

function toIstHour(now = new Date()) {
  const istMs = now.getTime() + 5.5 * 60 * 60 * 1000;
  return new Date(istMs).getUTCHours();
}

function isBreakfastOpen(now = new Date()) {
  return toIstHour(now) < 11;
}

function normalizeText(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/[^a-z0-9+\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeMode(v) {
  const t = normalizeText(v);
  if (!t) return null;
  if (t.includes("pickup") || t.includes("pick up")) return "pickup";
  if (t.includes("dine")) return "dine-in";
  if (t.includes("delivery") || t.includes("deliver")) return "delivery";
  return null;
}

function normalizePayment(v) {
  const t = normalizeText(v);
  if (!t) return null;
  if (t.includes("upi")) return "UPI";
  if (t.includes("cod") || t.includes("cash")) return "COD";
  if (t.includes("card")) return "Card";
  if (t.includes("netbanking") || t.includes("net banking")) return "NetBanking";
  return null;
}

function normalizeDiet(v) {
  const t = normalizeText(v);
  if (!t) return null;
  if (t.includes("jain")) return "jain";
  if (t.includes("non veg") || t.includes("nonveg") || t.includes("chicken") || t.includes("fish")) return "non-veg";
  if (t.includes("veg") || t.includes("vegetarian")) return "veg";
  return null;
}

function findDietHints(text) {
  const t = normalizeText(text);
  return {
    detected: normalizeDiet(t),
    explicit: /\b(jain|non veg|nonveg|veg|vegetarian)\b/.test(t)
  };
}

function findModeHint(text) {
  return normalizeMode(text);
}

function findPaymentHint(text) {
  return normalizePayment(text);
}

function parseQtyToken(token) {
  if (!token) return null;
  const raw = String(token || "").toLowerCase().trim();
  if (/^\d+$/.test(raw)) return Number(raw);
  return NUMBER_WORDS[raw] || null;
}

function detectQty(segment, start, end) {
  const before = segment.slice(0, start).trim();
  const after = segment.slice(end).trim();
  const beforeTokens = before ? before.split(/\s+/).slice(-3) : [];
  for (let i = beforeTokens.length - 1; i >= 0; i -= 1) {
    const q = parseQtyToken(beforeTokens[i]);
    if (q) return q;
  }
  const afterTokens = after ? after.split(/\s+/).slice(0, 2) : [];
  for (const token of afterTokens) {
    const q = parseQtyToken(token);
    if (q) return q;
  }
  const multi = segment.match(/\b(?:x|x\s*|qty\s*)(\d+)\b/i);
  if (multi) return Number(multi[1]);
  return 1;
}

function detectSize(segment) {
  if (/\blarge\b/.test(segment)) return "large";
  if (/\bmedium\b/.test(segment)) return "medium";
  if (/\bregular\b/.test(segment)) return "regular";
  return null;
}

function detectVariant(item, segment) {
  if (!item?.variants) return null;
  if (/\b10\b|\b10pc\b|\b10 pc\b/.test(segment)) return "10pc";
  if (/\b6\b|\b6pc\b|\b6 pc\b/.test(segment)) return "6pc";
  return item.defaultVariant || null;
}

function escapeRegExp(v) {
  return String(v || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toCustomizationList(c) {
  const out = [];
  for (const x of c.remove || []) out.push(`No ${x}`);
  for (const x of c.add || []) out.push(`Extra ${x}`);
  for (const x of c.sauces || []) out.push(`Extra ${x} sauce`);
  if (c.temperature === "no-ice") out.push("No ice");
  if (c.temperature === "less-ice") out.push("Less ice");
  if (c.spiceLevel) out.push(`Spice: ${c.spiceLevel}`);
  if (c.jain) out.push("Jain prep");
  return [...new Set(out)];
}

function parseCustomizations(segment) {
  const s = normalizeText(segment);
  const custom = {
    remove: [],
    add: [],
    sauces: [],
    temperature: null,
    spiceLevel: null,
    jain: false
  };

  if (/\bno onion\b|\bwithout onion\b|\bonion mat\b|\bonion nahi\b/.test(s)) custom.remove.push("onion");
  if (/\bno mayo\b|\bwithout mayo\b/.test(s)) custom.remove.push("mayo");
  if (/\bno garlic\b/.test(s)) custom.remove.push("garlic");

  if (/\bextra cheese\b/.test(s)) custom.add.push("cheese");
  if (/\bextra patty\b|\bextra tikki\b/.test(s)) custom.add.push("patty");
  if (/\bextra sauce\b/.test(s)) custom.add.push("sauce");

  if (/\bschezwan\b/.test(s)) custom.sauces.push("schezwan");
  if (/\bgreen chutney\b|\bchutney\b/.test(s)) custom.sauces.push("green chutney");
  if (/\btangy mayo\b/.test(s)) custom.sauces.push("tangy mayo");

  if (/\bno ice\b/.test(s)) custom.temperature = "no-ice";
  if (/\bless ice\b/.test(s)) custom.temperature = "less-ice";

  if (/\bfull mirchi\b|\bextra spicy\b|\bspicy\b/.test(s)) custom.spiceLevel = "spicy";
  if ((/\bmedium spicy\b|\bspice medium\b/.test(s)) && !custom.spiceLevel) custom.spiceLevel = "medium";
  if (/\bmild\b|\bless spicy\b/.test(s)) custom.spiceLevel = "mild";

  if (/\bjain\b/.test(s) || (/\bno onion\b/.test(s) && /\bno garlic\b/.test(s))) custom.jain = true;

  custom.remove = [...new Set(custom.remove)];
  custom.add = [...new Set(custom.add)];
  custom.sauces = [...new Set(custom.sauces)];
  return custom;
}

function hasCustomizations(custom) {
  return !!(
    (custom.remove && custom.remove.length) ||
    (custom.add && custom.add.length) ||
    (custom.sauces && custom.sauces.length) ||
    custom.temperature ||
    custom.spiceLevel ||
    custom.jain
  );
}

function customizationCharge(custom) {
  let charge = 0;
  for (const x of custom.add || []) {
    if (x === "cheese") charge += 25;
    if (x === "patty") charge += 40;
    if (x === "sauce") charge += 15;
  }
  charge += (custom.sauces || []).length * 15;
  return charge;
}

function mergeCustomizations(base, patch) {
  const next = {
    remove: [...new Set([...(base.remove || []), ...(patch.remove || [])])],
    add: [...new Set([...(base.add || []), ...(patch.add || [])])],
    sauces: [...new Set([...(base.sauces || []), ...(patch.sauces || [])])],
    temperature: patch.temperature || base.temperature || null,
    spiceLevel: patch.spiceLevel || base.spiceLevel || null,
    jain: !!(base.jain || patch.jain)
  };
  return next;
}

function findItemMatches(segment) {
  const raw = normalizeText(segment);
  if (!raw) return [];
  const matches = [];
  for (const item of MENU_ITEMS) {
    const aliases = [...item.aliases].sort((a, b) => b.length - a.length);
    for (const alias of aliases) {
      const aliasNorm = normalizeText(alias);
      if (!aliasNorm) continue;
      const re = new RegExp(`\\b${escapeRegExp(aliasNorm).replace(/\s+/g, "\\s+")}\\b`, "i");
      const m = raw.match(re);
      if (!m || typeof m.index !== "number") continue;
      matches.push({
        item,
        start: m.index,
        end: m.index + m[0].length,
        aliasLength: aliasNorm.length
      });
      break;
    }
  }

  matches.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return b.aliasLength - a.aliasLength;
  });

  const selected = [];
  for (const hit of matches) {
    const overlap = selected.some((s) => !(hit.end <= s.start || hit.start >= s.end));
    if (!overlap) selected.push(hit);
  }
  return selected;
}

function getUnitPrice(item, { size, variant }) {
  if (item.prices) {
    const resolved = size || item.defaultSize || "regular";
    return Number(item.prices[resolved] || item.prices[item.defaultSize] || 0);
  }
  if (item.variants) {
    const key = variant || item.defaultVariant;
    return Number(item.variants[key] || 0);
  }
  return Number(item.price || 0);
}

function cartKey(item, size, variant, customizations) {
  return JSON.stringify({
    id: item.id,
    size: size || null,
    variant: variant || null,
    customizations: toCustomizationList(customizations)
  });
}

function hasSupportIssue(text) {
  return /\b(stuck|refund|wrong order|order issue|app bug|issue)\b/i.test(String(text || ""));
}

function parseOrderInput(input, opts = {}) {
  const raw = String(input || "").trim();
  const text = normalizeText(raw);
  const now = opts.now || new Date();
  const segments = text.split(/\s*(?:,|\band\b|\baur\b|\bplus\b|&)\s*/g).filter(Boolean);
  const mode = findModeHint(text);
  const paymentMode = findPaymentHint(text);
  const diet = findDietHints(text);

  const add = [];
  const remove = [];
  const warnings = [];
  const notes = [];
  const supportIssue = hasSupportIssue(text);

  if (/\bquick\b|\bjaldi\b/.test(text)) notes.push("Quick delivery requested");
  if (/\bfamily\b|\bparty\b/.test(text)) notes.push("Family/party order");
  if (/\bno maida\b/.test(text)) warnings.push("No-maida option is not guaranteed at McDonald's. Suggesting hash brown or corn-based sides.");

  for (const segment of segments) {
    if (!segment) continue;
    const segmentCustom = parseCustomizations(segment);

    if (/^(remove|delete)\b/.test(segment)) {
      const hits = findItemMatches(segment);
      for (const h of hits) {
        remove.push({
          itemId: h.item.id,
          qty: detectQty(segment, h.start, h.end) || 1
        });
      }
      continue;
    }

    const hits = findItemMatches(segment);
    if (!hits.length) {
      if (hasCustomizations(segmentCustom) && add.length) {
        const last = add[add.length - 1];
        last.customizations = mergeCustomizations(last.customizations, segmentCustom);
      }
      continue;
    }

    for (const hit of hits) {
      const item = hit.item;
      if (item.breakfastOnly && !isBreakfastOpen(now)) {
        warnings.push(`${item.name} breakfast menu mein hai aur 11:00 AM IST ke baad unavailable hota hai.`);
        continue;
      }
      const qty = Math.max(1, detectQty(segment, hit.start, hit.end));
      const size = item.prices ? (detectSize(segment) || item.defaultSize || null) : null;
      const variant = detectVariant(item, segment);
      add.push({
        item,
        qty,
        size,
        variant,
        customizations: segmentCustom
      });
    }
  }

  return {
    raw,
    mode,
    paymentMode,
    diet: diet.detected,
    dietExplicit: diet.explicit,
    add,
    remove,
    warnings,
    notes,
    supportIssue
  };
}

function detectSpicePreference(cart) {
  for (const line of cart) {
    if (line.customizations?.spiceLevel) return line.customizations.spiceLevel;
  }
  return null;
}

function computeTotals(cart, serviceMode) {
  let subtotalBeforeOffers = 0;
  for (const line of cart) subtotalBeforeOffers += line.lineTotal;

  const offers = [];
  let discount = 0;

  for (const line of cart) {
    if (!line.item.id.startsWith("mcflurry_")) continue;
    const freeUnits = Math.floor(line.qty / 2);
    if (!freeUnits) continue;
    const offerDiscount = freeUnits * line.unitPrice;
    discount += offerDiscount;
    offers.push({
      code: "MCFLURRY_BOGO",
      title: "McFlurry Buy 1 Get 1",
      amount: round2(offerDiscount)
    });
  }

  const subtotal = Math.max(0, subtotalBeforeOffers - discount);
  const taxes = round2(subtotal * GST_RATE);
  const deliveryFee = serviceMode === "delivery" ? DELIVERY_FEE_ESTIMATE : 0;
  const total = round2(subtotal + taxes + deliveryFee);

  return {
    subtotalBeforeOffers: round2(subtotalBeforeOffers),
    subtotal: round2(subtotal),
    discount: round2(discount),
    taxes,
    deliveryFee: round2(deliveryFee),
    total,
    offers
  };
}

class OrderAIEngine {
  constructor(opts = {}) {
    this.now = opts.now || new Date();
    this.profile = opts.profile || {};
    this.location = String(opts.location || this.profile.lastLocation || "current location");
    this.serviceMode = normalizeMode(opts.mode || this.profile.preferredMode || "delivery");
    this.diet = normalizeDiet(opts.diet || this.profile.diet || "veg") || "veg";
    this.paymentMode = normalizePayment(opts.payment || this.profile.paymentMode || "") || null;
    this.deliveryAddress = String(opts.address || this.profile.lastAddress || "");
    this.notes = [];
    this.cart = [];
  }

  greet() {
    return "Arre waah! McDonald's order? Batao kya khaane ka mood hai aaj? ";
  }

  locationLine() {
    return `Location detected: ${this.location}.`;
  }

  modeLine() {
    if (this.serviceMode === "pickup") return "Pickup mode set.";
    if (this.serviceMode === "dine-in") return "Dine-in mode set.";
    return "Delivery mode set.";
  }

  applyInput(input) {
    const parsed = parseOrderInput(input, { now: this.now });
    const warnings = [...parsed.warnings];
    const suggestions = [];
    const updates = [];

    if (parsed.mode) this.serviceMode = parsed.mode;
    if (parsed.paymentMode) this.paymentMode = parsed.paymentMode;

    if (parsed.diet) {
      this.diet = parsed.diet;
      updates.push(`Diet set to ${this.diet}.`);
    }

    for (const note of parsed.notes) {
      if (!this.notes.includes(note)) this.notes.push(note);
    }

    for (const rem of parsed.remove) {
      this.removeItem(rem.itemId, rem.qty);
      updates.push(`Removed ${rem.qty} from ${rem.itemId}.`);
    }

    for (const req of parsed.add) {
      const custom = { ...req.customizations };
      const item = req.item;

      if (this.diet === "jain" && !item.veg) {
        warnings.push(`${item.name} Jain order mein allowed nahi hai.`);
        suggestions.push("Jain option: McAloo Tikki (no onion, no garlic, no mayo) try karein?");
        continue;
      }
      if (this.diet === "veg" && !item.veg && parsed.dietExplicit !== true) {
        this.diet = "non-veg";
        updates.push("Non-veg item detect hua, diet auto-switched to non-veg.");
      }

      if (this.diet === "jain") {
        custom.jain = true;
        custom.remove = [...new Set([...(custom.remove || []), "onion", "garlic"])];
      }
      if (this.profile.spiceLevel && !custom.spiceLevel && item.category !== "beverage" && item.category !== "dessert") {
        custom.spiceLevel = this.profile.spiceLevel;
      }

      this.addItem(item, req.qty, { size: req.size, variant: req.variant, customizations: custom });
    }

    if (parsed.supportIssue) {
      updates.push("Order stuck lag raha hai. Main fix flow start kar deta hoon, refund/escalation chahiye to bol do.");
      suggestions.push("Refund request bhej du?");
      suggestions.push("Direct store call connect karu?");
    }

    if (!this.cart.length && !parsed.remove.length && !parsed.add.length) {
      suggestions.push("Example: 2 McAloo Tikki, 1 Large Fries, 1 Coke no ice");
    }

    if (this.cart.some((x) => x.item.category === "side") && !this.cart.some((x) => x.item.category === "dessert")) {
      suggestions.push("Fries ke saath McFlurry add karoge to value better padegi.");
    }
    if (this.serviceMode === "delivery" && !this.paymentMode) {
      suggestions.push("Payment mode bata do: UPI, COD, Card ya NetBanking.");
    }

    return {
      parsed,
      updates,
      warnings,
      suggestions: [...new Set(suggestions)]
    };
  }

  removeItem(itemId, qty = 1) {
    let remaining = Math.max(1, Number(qty || 1));
    const next = [];
    for (const line of this.cart) {
      if (line.item.id !== itemId || remaining <= 0) {
        next.push(line);
        continue;
      }
      if (line.qty <= remaining) {
        remaining -= line.qty;
      } else {
        line.qty -= remaining;
        line.lineTotal = round2(line.qty * (line.unitPrice + line.customizationCharge));
        next.push(line);
        remaining = 0;
      }
    }
    this.cart = next;
  }

  addItem(item, qty, opts = {}) {
    const size = item.prices ? (opts.size || item.defaultSize || "regular") : null;
    const variant = item.variants ? (opts.variant || item.defaultVariant || null) : null;
    const customizations = opts.customizations || {
      remove: [],
      add: [],
      sauces: [],
      temperature: null,
      spiceLevel: null,
      jain: false
    };
    const unitPrice = getUnitPrice(item, { size, variant });
    const extra = customizationCharge(customizations);
    const key = cartKey(item, size, variant, customizations);

    const existing = this.cart.find((x) => x.key === key);
    if (existing) {
      existing.qty += qty;
      existing.lineTotal = round2(existing.qty * (existing.unitPrice + existing.customizationCharge));
      return;
    }

    this.cart.push({
      key,
      item,
      qty,
      size,
      variant,
      unitPrice: round2(unitPrice),
      customizationCharge: round2(extra),
      customizations: mergeCustomizations(
        { remove: [], add: [], sauces: [], temperature: null, spiceLevel: null, jain: false },
        customizations
      ),
      lineTotal: round2(qty * (unitPrice + extra))
    });
  }

  totals() {
    return computeTotals(this.cart, this.serviceMode);
  }

  cartView() {
    const totals = this.totals();
    const lines = this.cart.map((line) => {
      const parts = [];
      if (line.size) parts.push(line.size);
      if (line.variant) parts.push(line.variant);
      const custom = toCustomizationList(line.customizations);
      return {
        item: line.item.name,
        qty: line.qty,
        descriptor: parts.join(" ").trim(),
        customizations: custom,
        lineTotal: round2(line.lineTotal)
      };
    });

    return {
      lines,
      subtotal: totals.subtotal,
      taxes: totals.taxes,
      deliveryFee: totals.deliveryFee,
      discount: totals.discount,
      total: totals.total,
      offers: totals.offers
    };
  }

  isReadyForCheckout() {
    if (!this.cart.length) return { ready: false, reason: "Cart is empty." };
    if (!this.paymentMode) return { ready: false, reason: "Payment mode missing." };
    if (this.serviceMode === "delivery" && !String(this.deliveryAddress || "").trim()) {
      return { ready: false, reason: "Delivery address missing." };
    }
    return { ready: true };
  }

  buildPayload() {
    const totals = this.totals();
    const customizations = {};
    const orderItems = this.cart.map((line, index) => {
      const key = `${line.item.id}_${index + 1}`;
      customizations[key] = {
        size: line.size || null,
        variant: line.variant || null,
        options: toCustomizationList(line.customizations)
      };
      return {
        item_id: line.item.id,
        item_name: line.item.name,
        quantity: line.qty,
        veg: !!line.item.veg,
        size: line.size || null,
        variant: line.variant || null,
        unit_price: round2(line.unitPrice + line.customizationCharge),
        line_total: round2(line.lineTotal)
      };
    });
    const spice = detectSpicePreference(this.cart);
    const notes = [...this.notes];
    if (spice) notes.push(`Spice preference: ${spice}`);
    if (this.diet) notes.push(`Diet: ${this.diet}`);

    return {
      order_items: orderItems,
      customizations,
      total_amount: totals.total,
      subtotal_amount: totals.subtotal,
      taxes: totals.taxes,
      delivery_fee_estimate: totals.deliveryFee,
      discounts_applied: totals.offers,
      payment_mode: this.paymentMode || "UNCONFIRMED",
      delivery_address: this.serviceMode === "delivery" ? String(this.deliveryAddress || "") : "PICKUP",
      notes: notes.join("; ")
    };
  }

  profileSnapshot() {
    return {
      diet: this.diet,
      preferredMode: this.serviceMode,
      paymentMode: this.paymentMode || this.profile.paymentMode || null,
      spiceLevel: detectSpicePreference(this.cart) || this.profile.spiceLevel || null,
      lastAddress: this.deliveryAddress || this.profile.lastAddress || "",
      lastLocation: this.location
    };
  }
}

async function loadOrderProfile() {
  try {
    return (await fs.readJson(PROFILE_PATH)) || {};
  } catch {
    return {};
  }
}

async function saveOrderProfile(profile) {
  await fs.ensureDir(path.dirname(PROFILE_PATH));
  await fs.writeJson(PROFILE_PATH, profile || {}, { spaces: 2 });
}

module.exports = {
  OrderAIEngine,
  parseOrderInput,
  loadOrderProfile,
  saveOrderProfile,
  normalizeMode,
  normalizePayment,
  normalizeDiet
};
