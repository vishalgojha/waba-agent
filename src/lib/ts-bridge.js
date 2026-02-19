const fs = require("fs-extra");
const path = require("path");
const { pathToFileURL } = require("url");

function repoRoot() {
  return path.resolve(__dirname, "..", "..");
}

async function loadTsModule(...segments) {
  const modPath = path.join(repoRoot(), ".tmp-ts", "src-ts", ...segments);
  if (!(await fs.pathExists(modPath))) return null;
  return import(pathToFileURL(modPath).href);
}

async function loadTsConfigBridge() {
  const mod = await loadTsModule("config.js");
  if (!mod?.readConfig) return null;
  return { readConfig: mod.readConfig, writeConfig: mod.writeConfig };
}

async function loadTsDoctorBridge() {
  const doctorMod = await loadTsModule("doctor.js");
  const configMod = await loadTsModule("config.js");
  const policyMod = await loadTsModule("doctor-policy.js");
  if (!doctorMod?.runDoctor || !configMod?.readConfig || !policyMod?.shouldFailDoctorGate) return null;
  return {
    runDoctor: doctorMod.runDoctor,
    readConfig: configMod.readConfig,
    shouldFailDoctorGate: policyMod.shouldFailDoctorGate
  };
}

async function loadTsOpsBridge() {
  const execMod = await loadTsModule("engine", "executor.js");
  const schemaMod = await loadTsModule("engine", "schema.js");
  if (!execMod?.executeIntent || !schemaMod?.validateIntent) return null;
  return {
    executeIntent: execMod.executeIntent,
    validateIntent: schemaMod.validateIntent
  };
}

async function loadTsMetaClientBridge() {
  const mod = await loadTsModule("meta-client.js");
  if (!mod?.MetaClient) return null;
  return { MetaClient: mod.MetaClient };
}

function buildTsAgentConfigFromCreds(cfg, creds) {
  return {
    token: String(creds?.token || ""),
    businessId: String(creds?.wabaId || ""),
    phoneNumberId: String(creds?.phoneNumberId || ""),
    graphVersion: String(cfg?.graphVersion || "v20.0"),
    baseUrl: String(cfg?.baseUrl || "https://graph.facebook.com")
  };
}

module.exports = {
  loadTsModule,
  loadTsConfigBridge,
  loadTsDoctorBridge,
  loadTsOpsBridge,
  loadTsMetaClientBridge,
  buildTsAgentConfigFromCreds
};
