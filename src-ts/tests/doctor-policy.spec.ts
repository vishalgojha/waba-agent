// src-ts/tests/doctor-policy.spec.ts
import assert from "node:assert/strict";
import { shouldFailDoctorGate } from "../doctor-policy.js";
import type { DoctorReport } from "../types.js";

function report(overall: DoctorReport["overall"]): DoctorReport {
  const ok = { name: "x", ok: true, detail: "ok" };
  return {
    tokenValidity: ok,
    requiredScopes: ok,
    phoneAccess: ok,
    webhookConnectivity: ok,
    testSendCapability: ok,
    rateLimits: ok,
    overall
  };
}

assert.equal(shouldFailDoctorGate(report("PASS"), false), false);
assert.equal(shouldFailDoctorGate(report("WARN"), false), false);
assert.equal(shouldFailDoctorGate(report("WARN"), true), true);
assert.equal(shouldFailDoctorGate(report("FAIL"), false), true);
assert.equal(shouldFailDoctorGate(report("FAIL"), true), true);

console.log("doctor-policy checks: ok");

