// @ts-nocheck
const test = require("node:test");
const assert = require("node:assert/strict");

const { isJaspersDomainEnabled, mapJaspersPlanRiskToOverall } = require("../server/webhook");

test("webhook domain toggle detects jaspers-market enablement", () => {
  assert.equal(isJaspersDomainEnabled({}), false);
  assert.equal(
    isJaspersDomainEnabled({
      domain: { vertical: "jaspers-market", jaspers: { enabled: true } }
    }),
    true
  );
  assert.equal(
    isJaspersDomainEnabled({
      domain: { vertical: "jaspers-market", jaspers: { enabled: false } }
    }),
    false
  );
  assert.equal(
    isJaspersDomainEnabled({
      domain: { vertical: "real-estate-resale", jaspers: { enabled: true } }
    }),
    false
  );
});

test("webhook maps jaspers plan risk to overall runtime risk", () => {
  assert.equal(mapJaspersPlanRiskToOverall("HIGH"), "high");
  assert.equal(mapJaspersPlanRiskToOverall("MEDIUM"), "medium");
  assert.equal(mapJaspersPlanRiskToOverall("LOW"), "medium");
  assert.equal(mapJaspersPlanRiskToOverall(""), "medium");
});
