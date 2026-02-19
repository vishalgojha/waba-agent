// src-ts/tests/tui-persist.spec.ts
import assert from "node:assert/strict";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { loadHatchState, saveHatchState } from "../../src/tui/tui-persist.js";

async function runChecks(): Promise<void> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "waba-hatch-persist-"));
  const prevHome = process.env.WABA_HOME;
  process.env.WABA_HOME = tempRoot;

  try {
    const empty = await loadHatchState();
    assert.equal(empty.domainFlow, null);

    await saveHatchState({
      domainFlow: {
        name: "jaspers-market",
        stage: "qualified",
        risk: "MEDIUM",
        target: "919812345678",
        recommendationCodes: ["P1", "P3"],
        preview: "Recommended options...",
        updatedAt: "09:10:00"
      }
    });

    const loaded = await loadHatchState();
    assert.ok(loaded.domainFlow);
    assert.equal(loaded.domainFlow?.name, "jaspers-market");
    assert.equal(loaded.domainFlow?.stage, "qualified");
    assert.deepEqual(loaded.domainFlow?.recommendationCodes, ["P1", "P3"]);
  } finally {
    if (prevHome === undefined) delete process.env.WABA_HOME;
    else process.env.WABA_HOME = prevHome;
    await fs.remove(tempRoot);
  }
}

void runChecks().then(() => {
  console.log("tui-persist roundtrip: ok");
});
