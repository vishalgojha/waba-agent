#!/usr/bin/env node
// @ts-nocheck
/* eslint-disable no-console */
const { activateResaleMagic } = require("../src/lib/domain/real-estate-resale");
const { safeClientName } = require("../src/lib/creds");

function parseArgs(argv) {
  const out = { client: "default", off: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if ((a === "--client" || a === "-c") && argv[i + 1]) {
      out.client = argv[++i];
      continue;
    }
    if (a === "--off") {
      out.off = true;
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const client = safeClientName(args.client || "default");
  const out = await activateResaleMagic({ client, enabled: !args.off });
  console.log(JSON.stringify({
    ok: true,
    client,
    enabled: !args.off,
    path: out.path
  }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: String(err?.message || err) }, null, 2));
  process.exitCode = 1;
});
