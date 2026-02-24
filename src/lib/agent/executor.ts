// @ts-nocheck
const chalkImport = require("chalk");
const chalk = chalkImport.default || chalkImport;

const { askYesNo } = require("../prompt");
const { logger } = require("../logger");

function riskOrder(r) {
  return r === "high" ? 3 : r === "medium" ? 2 : 1;
}

function formatStep(s, i) {
  const riskColor = s.risk === "high" ? chalk.red : s.risk === "medium" ? chalk.yellow : chalk.green;
  return `${String(i + 1).padStart(2, "0")}. ${chalk.white(s.tool)} ${riskColor(`[${s.risk}]`)} ${s.reason ? `- ${s.reason}` : ""}`;
}

async function executePlan(ctx, { steps, risk }, { yes = false, allowHighRisk = false, json = false } = {}) {
  if (json) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ok: true, plan: { risk, steps } }, null, 2));
    return { ok: true, plan: { risk, steps }, executed: false };
  }

  logger.info("Plan:");
  for (let i = 0; i < steps.length; i++) logger.info(formatStep(steps[i], i));
  logger.warn(`Overall risk: ${risk}`);
  logger.warn("Costs: WhatsApp Cloud API is per-message billed (India approx: ~INR 0.11 utility, ~INR 0.78 marketing; verify current rates in Meta).");

  const proceed = yes ? true : await askYesNo(`Execute ${steps.length} step(s)?`, { defaultYes: false });
  if (!proceed) return { ok: true, executed: false };

  const results = [];
  for (const s of steps) {
    const tool = ctx.registry.get(s.tool);
    if (!tool) {
      results.push({ tool: s.tool, ok: false, error: "tool_missing" });
      continue;
    }

    if (riskOrder(tool.risk) >= 3 && !allowHighRisk) {
      const ok = await askYesNo(`High-risk step: ${tool.name}. This may send outbound messages and incur costs. Continue?`, { defaultYes: false });
      if (!ok) {
        results.push({ tool: tool.name, ok: false, skipped: true, reason: "high_risk_denied" });
        continue;
      }
    }

    logger.info(`>> ${tool.name}`);
    try {
      const out = await tool.execute(ctx, s.args);
      logger.ok(`[OK] ${tool.name}`);
      results.push({ tool: tool.name, ok: true, out });
    } catch (err) {
      logger.error(`[ERR] ${tool.name}: ${err?.message || err}`);
      results.push({ tool: tool.name, ok: false, error: String(err?.message || err) });
      // Fail fast; businesses hate silent partial states.
      break;
    }
  }

  return { ok: true, executed: true, results };
}

module.exports = { executePlan };
