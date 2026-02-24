// @ts-nocheck
const { logger } = require("../lib/logger");
const { runGuidedDemo } = require("./demo");

async function runCheckAction(program, cmd) {
  const root = cmd.parent || program;
  const { json } = root.opts();

  const out = await runGuidedDemo({
    autoFix: true,
    scopeCheckMode: "best-effort"
  });

  if (json) {
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          ok: out.ok,
          readiness: {
            metaReady: out.readiness.metaReady,
            webhookReady: out.readiness.webhookReady,
            overallReady: out.readiness.overallReady
          },
          smoke: {
            passCount: out.smoke.passCount,
            total: out.smoke.total,
            failed: out.smoke.checks.filter((x) => !x.pass)
          },
          doctor: out.doctor ? { overall: out.doctor.overall } : null,
          next: out.next.steps
        },
        null,
        2
      )
    );
    if (!out.ok) process.exitCode = 1;
    return;
  }

  logger.info("WABA Quick Check");
  logger.info(`Readiness: meta=${out.readiness.metaReady ? "ready" : "missing"}, webhook=${out.readiness.webhookReady ? "ready" : "missing"}`);
  logger.info(`Smoke: ${out.smoke.passCount}/${out.smoke.total} passed`);

  const failed = out.smoke.checks.filter((x) => !x.pass);
  if (failed.length) {
    logger.warn("Needs attention:");
    for (const row of failed) logger.warn(`- ${row.name}: ${row.detail}`);
  }

  if (out.doctor) logger.info(`Doctor: ${out.doctor.overall}`);
  for (const w of out.warnings) logger.warn(w);

  if (out.ok) {
    logger.ok("Ready. Next: waba start");
    return;
  }

  logger.info("Do these next:");
  for (const step of out.next.steps.slice(0, 3)) {
    logger.info(`${step.id}. ${step.command}`);
  }
  logger.warn("Run `waba check` again after completing the steps.");
  process.exitCode = 1;
}

function registerCheckCommands(program) {
  const register = (name, description) => {
    program
      .command(name)
      .description(description)
      .action(async (_opts, cmd) => runCheckAction(program, cmd));
  };

  register("check", "one-command beginner readiness check (safe defaults)");
  register("health", "alias of check");
  register("ready", "alias of check");
  register("verify", "alias of check");
  register("test", "alias of check");
}

module.exports = { registerCheckCommands };
