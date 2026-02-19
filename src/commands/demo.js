const fs = require("fs-extra");
const path = require("path");

const { getConfig } = require("../lib/config");
const { buildReadiness } = require("../lib/readiness");
const { createRegistry } = require("../lib/tools/registry");
const { logger } = require("../lib/logger");
const {
  loadTsConfigBridge,
  loadTsOpsBridge,
  loadTsJaspersBridge,
  loadTsTuiBridge
} = require("../lib/ts-bridge");

async function runSmokeChecks() {
  const checks = [];
  const add = (name, pass, detail) => checks.push({ name, pass: !!pass, detail: String(detail || "") });

  const cfg = await getConfig();
  const readiness = buildReadiness(cfg, {});

  add(
    "Meta Credentials",
    readiness.metaReady,
    readiness.metaReady
      ? "token + phone id + business id detected"
      : "missing credentials. run: waba login --token ... --phone-id ... --business-id ..."
  );

  add(
    "Webhook Verify Token",
    readiness.webhookReady,
    readiness.webhookReady
      ? "verify token is configured"
      : "missing verify token. run: waba setup --generate-verify-token"
  );

  const tsConfig = await loadTsConfigBridge();
  add(
    "TS Runtime Build",
    !!tsConfig,
    tsConfig ? "compiled TS bridge found" : "missing TS build. run: npm run build:ts:tmp"
  );

  const tsOps = await loadTsOpsBridge();
  add(
    "TS Engine Bridge",
    !!tsOps,
    tsOps ? "intent validator/executor bridge ready" : "engine bridge missing. run: npm run build:ts:tmp"
  );

  const tsTui = await loadTsTuiBridge();
  add(
    "Hatch TUI Bridge",
    !!tsTui?.startHatchTui,
    tsTui?.startHatchTui ? "Hatch entrypoint available" : "hatch bridge missing. run: npm run build:ts:tmp"
  );

  const jaspers = await loadTsJaspersBridge();
  if (!jaspers) {
    add("Jaspers Playbook", false, "jaspers bridge missing. run: npm run build:ts:tmp");
  } else {
    try {
      const sample = jaspers.planMarketReply("birthday under 1200", "919812345678", null);
      const ok = !!(sample?.stage && sample?.replyText && sample?.risk);
      add("Jaspers Playbook", ok, ok ? `stage=${sample.stage} risk=${sample.risk}` : "planner returned invalid output");
    } catch (err) {
      add("Jaspers Playbook", false, `planner error: ${err?.message || err}`);
    }
  }

  try {
    const toolNames = createRegistry()
      .list()
      .map((x) => x.name);
    const hasTool = toolNames.includes("jaspers.plan_reply");
    add(
      "Agent Tool Wiring",
      hasTool,
      hasTool ? "jaspers.plan_reply is registered" : "missing jaspers.plan_reply in tool registry"
    );
  } catch (err) {
    add("Agent Tool Wiring", false, `tool registry error: ${err?.message || err}`);
  }

  const ciPath = path.resolve(process.cwd(), ".github", "workflows", "ci.yml");
  add(
    "CI Workflow File",
    await fs.pathExists(ciPath),
    (await fs.pathExists(ciPath)) ? ciPath : "missing .github/workflows/ci.yml"
  );

  const passCount = checks.filter((x) => x.pass).length;
  return {
    checks,
    passCount,
    total: checks.length,
    ok: passCount === checks.length
  };
}

function registerDemoCommands(program) {
  const d = program.command("demo").description("non-technical demo/testing helpers");

  d.command("smoke")
    .description("run one-command PASS/FAIL checks for operator demos")
    .action(async (_opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const out = await runSmokeChecks();
      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: out.ok, ...out }, null, 2));
        if (!out.ok) process.exitCode = 1;
        return;
      }

      logger.info("WABA Demo Smoke");
      for (const row of out.checks) {
        if (row.pass) logger.ok(`PASS ${row.name} - ${row.detail}`);
        else logger.error(`FAIL ${row.name} - ${row.detail}`);
      }
      logger.info(`Summary: ${out.passCount}/${out.total} passed`);
      if (!out.ok) {
        logger.warn("Fix failed checks above, then re-run: waba demo smoke");
        process.exitCode = 1;
      }
    });
}

module.exports = {
  registerDemoCommands,
  runSmokeChecks
};
