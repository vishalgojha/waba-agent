#!/usr/bin/env node
// @ts-nocheck

const fs = require("fs-extra");
const path = require("path");

const { getConfig } = require("../src/lib/config");
const { configPath, wabaHome } = require("../src/lib/paths");
const { startGatewayServer } = require("../src/server/gateway");

function nowIso() {
  return new Date().toISOString();
}

function parseArgs(argv) {
  const flags = new Set((argv || []).map((x) => String(x || "").trim().toLowerCase()));
  return {
    json: flags.has("--json"),
    strict: flags.has("--strict"),
    noGateway: flags.has("--no-gateway-check")
  };
}

function statusPass(name, details = null) {
  return { name, status: "pass", details };
}

function statusWarn(name, details = null) {
  return { name, status: "warn", details };
}

function statusFail(name, details = null) {
  return { name, status: "fail", details };
}

function hasValue(v) {
  return String(v || "").trim().length > 0;
}

function requiredAiKeyField(provider) {
  const p = String(provider || "").trim().toLowerCase();
  if (p === "openai") return "openaiApiKey";
  if (p === "anthropic") return "anthropicApiKey";
  if (p === "xai") return "xaiApiKey";
  if (p === "openrouter") return "openrouterApiKey";
  if (p === "ollama") return null;
  return null;
}

function safeRequire(moduleId) {
  try {
    require.resolve(moduleId);
    return true;
  } catch {
    return false;
  }
}

async function runGatewayCheck(cfg) {
  let server = null;
  try {
    const out = await startGatewayServer({
      host: "127.0.0.1",
      port: 0,
      client: cfg.activeClient || "default",
      language: "en"
    });
    server = out.server;
    const p = server.address().port;
    const res = await fetch(`http://127.0.0.1:${p}/api/health`);
    if (res.status !== 200) {
      return statusFail("gateway_health_check", `expected 200 got ${res.status}`);
    }
    const data = await res.json();
    if (!data?.ok) return statusFail("gateway_health_check", "health payload not ok");
    return statusPass("gateway_health_check", `service=${data.service || "waba-gateway"} uptime=${data.uptime || 0}s`);
  } catch (err) {
    return statusFail("gateway_health_check", String(err?.message || err));
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  }
}

function summarize(results) {
  const pass = results.filter((x) => x.status === "pass").length;
  const warn = results.filter((x) => x.status === "warn").length;
  const fail = results.filter((x) => x.status === "fail").length;
  return { pass, warn, fail, ok: fail === 0 };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cfg = await getConfig();
  const checks = [];

  const cfgPath = configPath();
  const cfgExists = await fs.pathExists(cfgPath);
  checks.push(
    cfgExists
      ? statusPass("config_file_present", cfgPath)
      : statusFail("config_file_present", `missing ${cfgPath}`)
  );

  const metaOk = hasValue(cfg.token) && hasValue(cfg.phoneNumberId) && hasValue(cfg.wabaId);
  checks.push(
    metaOk
      ? statusPass("meta_credentials_present")
      : statusFail(
        "meta_credentials_present",
        "missing one or more of token / phoneNumberId / wabaId"
      )
  );

  checks.push(
    hasValue(cfg.webhookVerifyToken)
      ? statusPass("webhook_verify_token_present")
      : statusFail("webhook_verify_token_present", "missing webhookVerifyToken")
  );

  const provider = String(cfg.aiProvider || "openai").trim().toLowerCase();
  const keyField = requiredAiKeyField(provider);
  if (!keyField) {
    if (provider === "ollama") {
      checks.push(
        statusPass(
          "ai_provider_ready",
          "provider=ollama (no hosted API key required)"
        )
      );
    } else {
      checks.push(statusWarn("ai_provider_ready", `unknown provider=${provider}`));
    }
  } else {
    checks.push(
      hasValue(cfg[keyField])
        ? statusPass("ai_provider_ready", `provider=${provider}`)
        : statusFail("ai_provider_ready", `provider=${provider} missing ${keyField}`)
    );
  }

  const queueEnabled = String(process.env.WABA_QUEUE_ENABLED || "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(queueEnabled)) {
    const hasRedisUrl = hasValue(process.env.REDIS_URL);
    const hasBullMq = safeRequire("bullmq");
    if (hasRedisUrl && hasBullMq) {
      checks.push(statusPass("queue_runtime_ready", "bullmq + REDIS_URL detected"));
    } else {
      const missing = [];
      if (!hasRedisUrl) missing.push("REDIS_URL");
      if (!hasBullMq) missing.push("bullmq package");
      checks.push(statusFail("queue_runtime_ready", `missing ${missing.join(", ")}`));
    }
  } else {
    checks.push(statusWarn("queue_runtime_ready", "WABA_QUEUE_ENABLED not set; direct execution mode"));
  }

  const sentryRequested = hasValue(process.env.SENTRY_DSN) || ["1", "true", "yes", "on"].includes(String(process.env.WABA_SENTRY_ENABLED || "").trim().toLowerCase());
  if (sentryRequested) {
    checks.push(
      safeRequire("@sentry/node")
        ? statusPass("sentry_runtime_ready")
        : statusFail("sentry_runtime_ready", "missing @sentry/node package")
    );
  } else {
    checks.push(statusWarn("sentry_runtime_ready", "Sentry not configured"));
  }

  const otelRequested = hasValue(process.env.OTEL_EXPORTER_OTLP_ENDPOINT)
    || hasValue(process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT)
    || ["1", "true", "yes", "on"].includes(String(process.env.WABA_OTEL_ENABLED || "").trim().toLowerCase());
  if (otelRequested) {
    const missing = [];
    if (!safeRequire("@opentelemetry/sdk-node")) missing.push("@opentelemetry/sdk-node");
    if (!safeRequire("@opentelemetry/auto-instrumentations-node")) {
      missing.push("@opentelemetry/auto-instrumentations-node");
    }
    if (missing.length) {
      checks.push(statusFail("otel_runtime_ready", `missing ${missing.join(", ")}`));
    } else {
      checks.push(statusPass("otel_runtime_ready"));
    }
  } else {
    checks.push(statusWarn("otel_runtime_ready", "OpenTelemetry not configured"));
  }

  if (!opts.noGateway) {
    checks.push(await runGatewayCheck(cfg));
  } else {
    checks.push(statusWarn("gateway_health_check", "skipped via --no-gateway-check"));
  }

  const summary = summarize(checks);
  const report = {
    ts: nowIso(),
    version: "0.1.1",
    home: wabaHome(),
    activeClient: cfg.activeClient || "default",
    summary,
    checks,
    manual_next_steps: [
      "Run docs/production-validation-checklist.md and mark each step pass/fail.",
      "For real Meta send/template/schedule checks, use a staging recipient and approved templates.",
      "Capture results in HANDOFF.md and .agent/checklist.json."
    ]
  };

  const outDir = path.join(process.cwd(), ".agent");
  await fs.ensureDir(outDir);
  const outPath = path.join(outDir, "production-validation-latest.json");
  await fs.writeJson(outPath, report, { spaces: 2 });

  if (opts.json) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(report, null, 2));
  } else {
    // eslint-disable-next-line no-console
    console.log(`Production validation summary: pass=${summary.pass} warn=${summary.warn} fail=${summary.fail}`);
    // eslint-disable-next-line no-console
    console.log(`Report: ${outPath}`);
    for (const c of checks) {
      const mark = c.status === "pass" ? "[PASS]" : c.status === "warn" ? "[WARN]" : "[FAIL]";
      // eslint-disable-next-line no-console
      console.log(`${mark} ${c.name}${c.details ? ` - ${c.details}` : ""}`);
    }
  }

  if (opts.strict && !summary.ok) process.exitCode = 1;
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err?.stack || String(err));
  process.exitCode = 1;
});
