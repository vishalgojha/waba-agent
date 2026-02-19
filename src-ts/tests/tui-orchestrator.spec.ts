// src-ts/tests/tui-orchestrator.spec.ts
import assert from "node:assert/strict";
import { plannerLines, safetyDecision } from "../../src/tui/tui-orchestrator.js";
import type { Intent } from "../../src/tui/tui-types.js";

const baseIntent: Intent = {
  action: "send_text",
  business_id: "biz_1",
  phone_number_id: "phone_1",
  payload: { to: "919812345678", body: "hello" },
  risk: "MEDIUM"
};

function runChecks(): void {
  const lines = plannerLines(baseIntent, []);
  assert.equal(lines.length, 3);
  assert.match(lines[0], /action=send_text/);

  const missing = safetyDecision(baseIntent, ["to"]);
  assert.equal(missing.mode, "block_missing");

  const low = safetyDecision({ ...baseIntent, risk: "LOW" }, []);
  assert.equal(low.mode, "auto_execute");

  const med = safetyDecision({ ...baseIntent, risk: "MEDIUM" }, []);
  assert.equal(med.mode, "queue_approval");
  assert.equal(med.reasonRequired, false);

  const high = safetyDecision({ ...baseIntent, risk: "HIGH" }, []);
  assert.equal(high.mode, "queue_approval");
  assert.equal(high.reasonRequired, true);
}

runChecks();
console.log("tui-orchestrator policy: ok");
