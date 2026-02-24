// @ts-nocheck
const fs = require("fs-extra");
const path = require("path");
const crypto = require("crypto");

const { getConfig, setConfig } = require("../lib/config");
const { buildReadiness } = require("../lib/readiness");
const { createRegistry } = require("../lib/tools/registry");
const { logger } = require("../lib/logger");
const { createWizardPrompter } = require("../lib/wizard/prompter");
const { WizardCancelledError } = require("../lib/wizard/prompts");
const {
  loadTsConfigBridge,
  loadTsDoctorBridge,
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
      : "missing credentials. run: waba start"
  );

  add(
    "Webhook Verify Token",
    readiness.webhookReady,
    readiness.webhookReady
      ? "verify token is configured"
      : "missing verify token. run: waba start"
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

async function generateDemoNextSteps() {
  const cfg = await getConfig();
  const readiness = buildReadiness(cfg, {});
  const steps = [];
  let index = 1;

  const pushStep = (title, command, why) => {
    steps.push({
      id: index++,
      title: String(title || ""),
      command: String(command || ""),
      why: String(why || "")
    });
  };

  if (!readiness.metaReady) {
    pushStep(
      "Open guided setup",
      "waba start",
      "beginner flow to connect Meta credentials safely"
    );
  }

  if (!readiness.webhookReady) {
    pushStep(
      "Generate missing webhook token",
      "waba start",
      "guided setup creates webhook verify token automatically"
    );
  }

  pushStep(
    "Run quick readiness",
    "waba check",
    "one-command beginner readiness report"
  );

  pushStep(
    "Run quick demo smoke",
    "waba demo smoke",
    "confirms control-plane wiring in one command"
  );

  pushStep(
    "Launch guided runtime",
    "waba start",
    "opens beginner assistant for safe next actions"
  );

  if (readiness.overallReady) {
    pushStep(
      "Open assistant directly",
      "waba go",
      "auto-check and start assistant when ready"
    );
  }

  const deduped = [];
  const seen = new Set();
  for (const step of steps) {
    const key = String(step.command || "").trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({ ...step, id: deduped.length + 1 });
  }

  return {
    client: readiness.client,
    activeClient: readiness.activeClient,
    metaReady: readiness.metaReady,
    webhookReady: readiness.webhookReady,
    overallReady: readiness.overallReady,
    steps: deduped
  };
}

function base64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function runGuidedDemo({ autoFix = false, scopeCheckMode = "best-effort" } = {}) {
  const actions = [];
  const warnings = [];

  const beforeCfg = await getConfig();
  const beforeReadiness = buildReadiness(beforeCfg, {});

  if (autoFix && !beforeReadiness.webhookReady) {
    try {
      const token = base64url(crypto.randomBytes(24));
      await setConfig({ webhookVerifyToken: token });
      actions.push("generated_webhook_verify_token");
    } catch (err) {
      warnings.push(`auto-fix skipped: unable to write webhook verify token (${err?.message || err})`);
    }
  }

  const smoke = await runSmokeChecks();

  const afterCfg = await getConfig();
  const afterReadiness = buildReadiness(afterCfg, {});

  let doctor = null;
  if (afterReadiness.metaReady) {
    try {
      const ts = await loadTsDoctorBridge();
      if (!ts) {
        warnings.push("doctor bridge unavailable; skipped doctor check");
      } else {
        const cfg = await ts.readConfig();
        const report = await ts.runDoctor(cfg, { scopeCheckMode });
        doctor = {
          overall: report.overall,
          tokenValidity: report.tokenValidity,
          requiredScopes: report.requiredScopes,
          phoneAccess: report.phoneAccess,
          webhookConnectivity: report.webhookConnectivity,
          testSendCapability: report.testSendCapability,
          rateLimits: report.rateLimits
        };
      }
    } catch (err) {
      warnings.push(`doctor check failed: ${err?.message || err}`);
    }
  } else {
    warnings.push("meta credentials missing; skipped doctor API checks");
  }

  const next = await generateDemoNextSteps();
  const doctorOk = !doctor ? true : doctor.overall !== "FAIL";

  return {
    actions,
    warnings,
    readiness: afterReadiness,
    smoke,
    doctor,
    next,
    ok: smoke.ok && doctorOk
  };
}

function registerDemoCommands(program) {
  const d = program
    .command("demo")
    .description("non-technical demo/testing helpers")
    .action(async (_opts, cmd) => {
      const root = cmd.parent || program;
      const json = !!root.opts()?.json;
      if (json || !process.stdin.isTTY || !process.stdout.isTTY) {
        logger.info("Demo home:");
        logger.info("1. waba check");
        logger.info("2. waba fix");
        logger.info("3. waba go");
        logger.info("4. waba whoami");
        logger.info("5. waba tour");
        return;
      }

      const prompter = createWizardPrompter();
      try {
        const pick = await prompter.select({
          message: "WABA Demo Home - choose what to do",
          options: [
            { value: "check", label: "Check setup", hint: "quick readiness check" },
            { value: "fix", label: "Fix setup", hint: "guided repair flow" },
            { value: "go", label: "Start assistant", hint: "open assistant when ready" },
            { value: "whoami", label: "Show status", hint: "current setup snapshot" },
            { value: "tour", label: "Guided tour", hint: "30-second walkthrough" }
          ],
          initialValue: "check"
        });

        if (pick === "check") logger.info("Run now: waba check");
        else if (pick === "fix") logger.info("Run now: waba fix");
        else if (pick === "go") logger.info("Run now: waba go");
        else if (pick === "whoami") logger.info("Run now: waba whoami");
        else logger.info("Run now: waba tour");
      } catch (err) {
        if (err instanceof WizardCancelledError) {
          logger.warn("Demo menu cancelled.");
          return;
        }
        throw err;
      }
    });

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

  d.command("run")
    .description("guided autopilot: auto-run safe checks and print exact manual next steps")
    .option("--auto-fix", "auto-generate webhook verify token if missing", false)
    .option("--scope-check-mode <mode>", "strict|best-effort", "best-effort")
    .action(async (opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const out = await runGuidedDemo({
        autoFix: !!opts.autoFix,
        scopeCheckMode: String(opts.scopeCheckMode || "best-effort")
      });

      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify(out, null, 2));
        if (!out.ok) process.exitCode = 1;
        return;
      }

      logger.info("WABA Demo Run");
      for (const action of out.actions) logger.ok(`AUTO ${action}`);

      logger.info("Smoke checks:");
      for (const row of out.smoke.checks) {
        if (row.pass) logger.ok(`PASS ${row.name} - ${row.detail}`);
        else logger.error(`FAIL ${row.name} - ${row.detail}`);
      }
      logger.info(`Smoke summary: ${out.smoke.passCount}/${out.smoke.total} passed`);

      if (out.doctor) {
        logger.info(`Doctor overall: ${out.doctor.overall}`);
        logger.info(`- token_validity: ${out.doctor.tokenValidity.ok ? "OK" : "FAIL"} | ${out.doctor.tokenValidity.detail}`);
        logger.info(`- required_scopes: ${out.doctor.requiredScopes.ok ? "OK" : "FAIL"} | ${out.doctor.requiredScopes.detail}`);
        logger.info(`- phone_access: ${out.doctor.phoneAccess.ok ? "OK" : "FAIL"} | ${out.doctor.phoneAccess.detail}`);
        logger.info(`- webhook_connectivity: ${out.doctor.webhookConnectivity.ok ? "OK" : "FAIL"} | ${out.doctor.webhookConnectivity.detail}`);
        logger.info(`- test_send_capability: ${out.doctor.testSendCapability.ok ? "OK" : "FAIL"} | ${out.doctor.testSendCapability.detail}`);
        logger.info(`- rate_limits: ${out.doctor.rateLimits.ok ? "OK" : "FAIL"} | ${out.doctor.rateLimits.detail}`);
      }

      for (const w of out.warnings) logger.warn(w);

      logger.info("Manual next steps:");
      for (const step of out.next.steps) {
        logger.info(`${step.id}. ${step.title}`);
        logger.info(`   ${step.command}`);
      }

      if (!out.ok) {
        logger.warn("Demo run has failures. Complete steps above, then re-run: waba demo run");
        process.exitCode = 1;
      }
    });

  d.command("next")
    .description("show exact next commands for non-technical setup/testing")
    .action(async (_opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const { json } = root.opts();
      const out = await generateDemoNextSteps();

      if (json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify(out, null, 2));
        return;
      }

      logger.info(`Demo Next Steps (client=${out.client}, active=${out.activeClient})`);
      logger.info(`Readiness: meta=${out.metaReady ? "ready" : "missing"}, webhook=${out.webhookReady ? "ready" : "missing"}`);
      for (const step of out.steps) {
        logger.info(`${step.id}. ${step.title}`);
        logger.info(`   ${step.command}`);
        logger.info(`   why: ${step.why}`);
      }
    });
}

module.exports = {
  registerDemoCommands,
  runSmokeChecks,
  generateDemoNextSteps,
  runGuidedDemo
};
