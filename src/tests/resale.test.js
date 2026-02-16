const test = require("node:test");
const assert = require("node:assert/strict");

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
  assert.equal(classifyRecencyBucket("2026-02-15T10:00:00+05:30"), "recent_0_6");
  assert.equal(classifyRecencyBucket("2026-01-20T10:00:00+05:30"), "warm_7_30");
  assert.equal(classifyRecencyBucket("2025-12-01T10:00:00+05:30"), "older_30_plus");
});

test("extractResaleLeadProfile captures budget bhk area and timeline", () => {
  const out = extractResaleLeadProfile("Need 2 BHK in Wakad budget 70-85L buy in 2 months", {});
  assert.equal(out.changed, true);
  assert.equal(out.profile.preferred_bhk, "2 BHK");
  assert.equal(out.profile.timeline_months, 2);
  assert.equal(out.profile.last_intent, "qualification");
  assert.equal(detectResaleIntent("Send brochure please"), "brochure_request");
});
