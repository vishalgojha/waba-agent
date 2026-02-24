// @ts-nocheck
const { logger } = require("./logger");

let initialized = false;
let state = {
  enabled: false,
  sentry: false,
  otel: false,
  serviceName: null,
  environment: null
};
let otelSdk = null;
let warnedMissing = new Set();

function parseBool(value, defaultValue = false) {
  if (value === undefined || value === null || value === "") return defaultValue;
  const v = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return defaultValue;
}

function parseOtlpHeaders(raw) {
  const out = {};
  const src = String(raw || "").trim();
  if (!src) return out;
  for (const pair of src.split(",")) {
    const part = pair.trim();
    if (!part) continue;
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

function warnMissingPackage(pkgName) {
  if (warnedMissing.has(pkgName)) return;
  warnedMissing.add(pkgName);
  logger.warn(
    `Observability package missing: ${pkgName}. Install it to enable telemetry for this runtime.`
  );
}

async function initOtel({ serviceName }) {
  try {
    const { NodeSDK } = require("@opentelemetry/sdk-node");
    const { getNodeAutoInstrumentations } = require("@opentelemetry/auto-instrumentations-node");

    let traceExporter;
    const endpoint = String(process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "").trim();
    const tracesEndpoint = String(process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || "").trim();
    if (endpoint || tracesEndpoint) {
      const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-http");
      const base = tracesEndpoint || `${endpoint.replace(/\/+$/, "")}/v1/traces`;
      traceExporter = new OTLPTraceExporter({
        url: base,
        headers: parseOtlpHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS || "")
      });
    }

    otelSdk = new NodeSDK({
      serviceName,
      traceExporter,
      instrumentations: [getNodeAutoInstrumentations()]
    });
    await Promise.resolve(otelSdk.start());
    return true;
  } catch (err) {
    const msg = String(err?.message || err);
    if (/Cannot find module/i.test(msg)) {
      if (msg.includes("@opentelemetry/sdk-node")) warnMissingPackage("@opentelemetry/sdk-node");
      if (msg.includes("@opentelemetry/auto-instrumentations-node")) {
        warnMissingPackage("@opentelemetry/auto-instrumentations-node");
      }
      if (msg.includes("@opentelemetry/exporter-trace-otlp-http")) {
        warnMissingPackage("@opentelemetry/exporter-trace-otlp-http");
      }
      return false;
    }
    logger.warn(`OpenTelemetry init failed: ${msg}`);
    return false;
  }
}

function initSentry({ serviceName, serviceVersion, environment }) {
  const dsn = String(process.env.SENTRY_DSN || "").trim();
  if (!dsn) return false;
  try {
    const Sentry = require("@sentry/node");
    const tracesSampleRate = Number(process.env.SENTRY_TRACES_SAMPLE_RATE || "0.1");
    Sentry.init({
      dsn,
      environment,
      release: serviceVersion ? `${serviceName}@${serviceVersion}` : serviceName,
      tracesSampleRate: Number.isFinite(tracesSampleRate) ? tracesSampleRate : 0.1
    });
    return true;
  } catch (err) {
    const msg = String(err?.message || err);
    if (/Cannot find module/i.test(msg) && msg.includes("@sentry/node")) {
      warnMissingPackage("@sentry/node");
      return false;
    }
    logger.warn(`Sentry init failed: ${msg}`);
    return false;
  }
}

function shouldEnable() {
  const env = process.env;
  if (parseBool(env.WABA_OBS_ENABLED, false)) return true;
  if (parseBool(env.WABA_SENTRY_ENABLED, false) && env.SENTRY_DSN) return true;
  if (parseBool(env.WABA_OTEL_ENABLED, false)) return true;
  if (env.SENTRY_DSN || env.OTEL_EXPORTER_OTLP_ENDPOINT || env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) {
    return true;
  }
  return false;
}

async function initObservability({
  serviceName = "waba-agent",
  serviceVersion = null,
  environment = process.env.NODE_ENV || "development"
} = {}) {
  if (initialized) return state;
  initialized = true;

  if (!shouldEnable()) {
    return state;
  }

  const wantsSentry = parseBool(process.env.WABA_SENTRY_ENABLED, true);
  const wantsOtel = parseBool(process.env.WABA_OTEL_ENABLED, true);

  let sentry = false;
  let otel = false;

  if (wantsSentry) {
    sentry = initSentry({ serviceName, serviceVersion, environment });
  }
  if (wantsOtel) {
    otel = await initOtel({ serviceName });
  }

  state = {
    enabled: sentry || otel,
    sentry,
    otel,
    serviceName,
    environment
  };

  if (state.enabled) {
    logger.info(
      `Observability enabled service=${serviceName} sentry=${sentry ? "on" : "off"} otel=${otel ? "on" : "off"}`
    );
  }

  if (otelSdk) {
    process.once("beforeExit", async () => {
      try {
        await Promise.resolve(otelSdk.shutdown());
      } catch (err) {
        logger.warn(`OpenTelemetry shutdown failed: ${err?.message || err}`);
      }
    });
  }

  return state;
}

function getObservabilityState() {
  return state;
}

module.exports = {
  initObservability,
  getObservabilityState
};
