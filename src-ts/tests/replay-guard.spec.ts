// src-ts/tests/replay-guard.spec.ts
import assert from "node:assert/strict";
import { assertReplayIntentHasRequiredPayload } from "../replay-guard.js";
import type { Intent } from "../types.js";

const base: Omit<Intent, "action" | "payload"> = {
  business_id: "b",
  phone_number_id: "p",
  risk: "HIGH"
};

assert.throws(() => {
  assertReplayIntentHasRequiredPayload({
    ...base,
    action: "send_template",
    payload: { to: "+919999999999" }
  });
}, /payload\.to and payload\.templateName/);

assert.throws(() => {
  assertReplayIntentHasRequiredPayload({
    ...base,
    action: "upload_media",
    payload: {}
  });
}, /payload\.mediaPath/);

assert.doesNotThrow(() => {
  assertReplayIntentHasRequiredPayload({
    ...base,
    action: "send_template",
    payload: { to: "+919999999999", templateName: "welcome" }
  });
});

console.log("replay-guard checks: ok");

