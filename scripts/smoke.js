const { createRegistry } = require("../src/lib/tools/registry");

async function main() {
  const r = createRegistry();
  const tools = r.list();
  if (!tools.length) throw new Error("no tools registered");
  // eslint-disable-next-line no-console
  console.log(`ok: ${tools.length} tools`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err?.stack || String(err));
  process.exitCode = 1;
});

