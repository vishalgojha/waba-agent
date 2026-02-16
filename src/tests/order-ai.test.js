const test = require("node:test");
const assert = require("node:assert/strict");

const { OrderAIEngine, parseOrderInput } = require("../lib/orderai/engine");

test("order parser: handles messy Hinglish input with customizations", () => {
  const parsed = parseOrderInput("Ek large McAloo Tikki meal, extra tikki, no onion, coke no ice");
  assert.equal(parsed.add.length, 2);
  assert.equal(parsed.add[0].item.id, "mcaloo_tikki_meal");
  assert.equal(parsed.add[0].qty, 1);
  assert.ok(parsed.add[0].customizations.add.includes("patty"));
  assert.ok(parsed.add[0].customizations.remove.includes("onion"));
  assert.equal(parsed.add[1].item.id, "coke");
  assert.equal(parsed.add[1].customizations.temperature, "no-ice");
});

test("order engine: supports combo input and computes totals", () => {
  const engine = new OrderAIEngine({
    mode: "delivery",
    payment: "UPI",
    address: "Bandra West, Mumbai"
  });
  const out = engine.applyInput("Maharaja Mac combo do, spicy bana do bhai, fries large, McFlurry Oreo add karo");
  assert.equal(out.warnings.length, 0);
  assert.ok(engine.cart.some((x) => x.item.id === "maharaja_mac_combo" && x.qty === 2));
  assert.ok(engine.cart.some((x) => x.item.id === "fries"));
  assert.ok(engine.cart.some((x) => x.item.id === "mcflurry_oreo"));
  const totals = engine.totals();
  assert.ok(totals.total > 0);
  assert.equal(engine.isReadyForCheckout().ready, true);
});

test("order engine: blocks non-veg in jain mode", () => {
  const engine = new OrderAIEngine({ diet: "jain" });
  const out = engine.applyInput("1 Maharaja Mac");
  assert.equal(engine.cart.length, 0);
  assert.ok(out.warnings.some((x) => /Jain/i.test(x)));
});

test("order engine: payload shape includes backend keys", () => {
  const engine = new OrderAIEngine({
    mode: "pickup",
    payment: "UPI"
  });
  engine.applyInput("2 McAloo Tikki, 2 McFlurry Oreo");
  const payload = engine.buildPayload();
  assert.ok(Array.isArray(payload.order_items));
  assert.ok(payload.order_items.length >= 1);
  assert.equal(typeof payload.total_amount, "number");
  assert.equal(payload.payment_mode, "UPI");
  assert.equal(typeof payload.customizations, "object");
});
