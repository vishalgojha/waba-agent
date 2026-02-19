// src-ts/tests/tui-jaspers-command.spec.ts
import assert from "node:assert/strict";
import { buildJaspersDraftIntent, parseJaspersSlashArgs } from "../../src/tui/tui-command-handlers.js";

function runChecks(): void {
  const parsed = parseJaspersSlashArgs("919812345678 birthday under 1200");
  assert.deepEqual(parsed, { from: "919812345678", text: "birthday under 1200" });
  assert.equal(parseJaspersSlashArgs(""), null);
  assert.equal(parseJaspersSlashArgs("919812345678"), null);
  assert.equal(parseJaspersSlashArgs("bad-phone hello"), null);

  const draft = buildJaspersDraftIntent(
    { businessId: "biz_1", phoneNumberId: "phone_1" },
    "919812345678",
    "Recommended options:\nP1 ...",
    "MEDIUM"
  );
  assert.equal(draft.action, "send_text");
  assert.equal(draft.risk, "MEDIUM");
  assert.equal(String(draft.payload.to), "919812345678");
  assert.match(String(draft.payload.body), /Recommended options/);

  const high = buildJaspersDraftIntent(
    { businessId: "biz_1", phoneNumberId: "phone_1" },
    "919812345678",
    "Order confirmed",
    "HIGH"
  );
  assert.equal(high.risk, "HIGH");
}

runChecks();
console.log("tui-jaspers slash helpers: ok");
