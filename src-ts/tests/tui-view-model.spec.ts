// src-ts/tests/tui-view-model.spec.ts
import assert from "node:assert/strict";
import {
  buildConfirmLines,
  buildQueueRows,
  buildResultRows,
  type ConfirmState
} from "../tui-view-model.js";
import type { ActionResult, Intent } from "../types.js";

const sampleIntent: Intent = {
  action: "send_template",
  business_id: "123",
  phone_number_id: "456",
  payload: { to: "+919999999999", templateName: "welcome" },
  risk: "HIGH"
};

function runSnapshotChecks(): void {
  const queueRows = buildQueueRows(
    [
      sampleIntent,
      { ...sampleIntent, action: "get_profile", risk: "LOW", payload: {} }
    ],
    1
  );
  assert.deepEqual(queueRows, ["  send_template [HIGH]", "> get_profile [LOW]"]);

  const resultRows = buildResultRows(
    [
      {
        ok: true,
        action: "get_profile",
        id: "12345678-zzzz-yyyy",
        risk: "LOW",
        intent: { ...sampleIntent, action: "get_profile", risk: "LOW", payload: {} },
        output: {},
        executedAt: "2026-01-01T00:00:00.000Z"
      } satisfies ActionResult
    ],
    0
  );
  assert.deepEqual(resultRows, ["> get_profile ok=true id=12345678"]);

  const high: ConfirmState = { intent: sampleIntent, stage: 2, reason: "Need client escalation" };
  assert.deepEqual(buildConfirmLines(high), [
    "Reason required for HIGH: send_template",
    "reason: Need client escalation",
    "Type reason and press Enter to execute."
  ]);

  const critical: ConfirmState = {
    intent: { ...sampleIntent, risk: "CRITICAL", action: "delete_template" },
    stage: 2,
    reason: "APPROVE: compliance request"
  };
  assert.deepEqual(buildConfirmLines(critical), [
    "CRITICAL approval: delete_template",
    "reason: APPROVE: compliance request",
    "Type APPROVE: <reason> then press Enter."
  ]);
}

runSnapshotChecks();
console.log("tui-view-model snapshots: ok");

