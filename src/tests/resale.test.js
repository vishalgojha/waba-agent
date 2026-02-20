const test = require("node:test");
const assert = require("node:assert/strict");
const dayjs = require("dayjs");

const {
  parseCsv,
  classifyRecencyBucket,
  extractResaleLeadProfile,
  detectResaleIntent
} = require("../lib/domain/real-estate-resale");

test("resale parseCsv parses basic rows", () => {
  const rows = parseCsv("name,phone,last_message_date\nVishal,+919812345678,2026-02-01");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Vishal");
  assert.equal(rows[0].phone, "+919812345678");
});

test("classifyRecencyBucket maps dates", () => {
  const now = dayjs("2026-02-20T10:00:00+05:30");
  assert.equal(classifyRecencyBucket(now.subtract(2, "day").toISOString(), now), "recent_0_6");
  assert.equal(classifyRecencyBucket(now.subtract(20, "day").toISOString(), now), "warm_7_30");
  assert.equal(classifyRecencyBucket(now.subtract(60, "day").toISOString(), now), "older_30_plus");
});

test("extractResaleLeadProfile captures budget bhk area and timeline", () => {
  const out = extractResaleLeadProfile("Need 2 BHK in Wakad budget 70-85L buy in 2 months", {});
  assert.equal(out.changed, true);
  assert.equal(out.profile.preferred_bhk, "2 BHK");
  assert.equal(out.profile.timeline_months, 2);
  assert.equal(out.profile.last_intent, "qualification");
  assert.equal(detectResaleIntent("Send brochure please"), "brochure_request");
});
