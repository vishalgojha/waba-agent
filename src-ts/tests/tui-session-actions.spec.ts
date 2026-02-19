// src-ts/tests/tui-session-actions.spec.ts
import assert from "node:assert/strict";
import { createInitialState, hatchReducer } from "../../src/tui/tui-session-actions.js";

function runChecks(): void {
  const init = createInitialState();
  assert.equal(init.domainFlow, null);

  const next = hatchReducer(init, {
    type: "set-domain-flow",
    value: {
      name: "jaspers-market",
      stage: "qualified",
      risk: "MEDIUM",
      target: "919812345678",
      recommendationCodes: ["P1", "P3"],
      preview: "Recommended options...",
      updatedAt: "08:55:00"
    }
  });
  assert.ok(next.domainFlow);
  assert.equal(next.domainFlow?.name, "jaspers-market");
  assert.equal(next.domainFlow?.stage, "qualified");
  assert.deepEqual(next.domainFlow?.recommendationCodes, ["P1", "P3"]);
}

runChecks();
console.log("tui-session-actions domain flow: ok");
