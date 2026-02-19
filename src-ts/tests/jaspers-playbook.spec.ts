// src-ts/tests/jaspers-playbook.spec.ts
import assert from "node:assert/strict";
import { planMarketReply } from "../domain/jaspers-market/playbook.js";
import type { MarketSession } from "../domain/jaspers-market/types.js";

const phone = "919812345678";

function runPlaybookChecks(): void {
  const rec = planMarketReply("birthday under 1200", phone, null);
  assert.equal(rec.stage, "qualified");
  assert.equal(rec.risk, "MEDIUM");
  assert.match(rec.replyText, /Recommended options:/);
  assert.equal(rec.recommendations.length > 0, true);

  const selected = planMarketReply("P2", phone, rec.nextSession);
  assert.equal(selected.stage, "selected");
  assert.equal(selected.risk, "MEDIUM");
  assert.match(selected.replyText, /Reply with recipient \+ delivery details/);

  const checkout = planMarketReply(
    "Recipient Riya tomorrow 6pm Andheri",
    phone,
    selected.nextSession as MarketSession
  );
  assert.equal(checkout.stage, "checkout");
  assert.equal(checkout.risk, "MEDIUM");
  assert.match(checkout.replyText, /Reply exactly: CONFIRM ORDER/);

  const confirm = planMarketReply("CONFIRM ORDER", phone, checkout.nextSession as MarketSession);
  assert.equal(confirm.stage, "checkout");
  assert.equal(confirm.risk, "HIGH");
  assert.match(confirm.replyText, /Order confirmed/);
}

runPlaybookChecks();
console.log("jaspers-playbook transitions: ok");
