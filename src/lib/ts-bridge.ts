// @ts-nocheck
const fs = require("fs-extra");
const path = require("path");
const { pathToFileURL } = require("url");

function repoRoot() {
  return path.resolve(__dirname, "..", "..");
}

function compiledPath(scope, ...segments) {
  return path.join(repoRoot(), ".tmp-ts", scope, ...segments);
}

async function loadTsModule(...segments) {
  const modPath = compiledPath("src-ts", ...segments);
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

async function loadTsReplayBridge() {
  const replayMod = await loadTsModule("replay.js");
  const guardMod = await loadTsModule("replay-guard.js");
  const schemaMod = await loadTsModule("engine", "schema.js");
  if (!replayMod?.listReplay || !replayMod?.getReplayById || !guardMod?.assertReplayIntentHasRequiredPayload || !schemaMod?.validateIntent) return null;
  return {
    listReplay: replayMod.listReplay,
    getReplayById: replayMod.getReplayById,
    assertReplayIntentHasRequiredPayload: guardMod.assertReplayIntentHasRequiredPayload,
    validateIntent: schemaMod.validateIntent
  };
}

async function loadTsTuiBridge() {
  const modPath = compiledPath("src", "tui", "index.js");
  if (!(await fs.pathExists(modPath))) return null;
  const mod = await import(pathToFileURL(modPath).href);
  if (!mod?.startHatchTui && !mod?.startTui) return null;
  return {
    startHatchTui: mod.startHatchTui || mod.startTui
  };
}

async function loadTsClientsBridge() {
  const mod = await loadTsModule("clients.js");
  if (!mod?.listClients || !mod?.addOrUpdateClient || !mod?.switchClient || !mod?.removeClient) return null;
  return {
    listClients: mod.listClients,
    addOrUpdateClient: mod.addOrUpdateClient,
    switchClient: mod.switchClient,
    removeClient: mod.removeClient
  };
}

async function loadTsConfigEditBridge() {
  const mod = await loadTsModule("config-edit.js");
  if (!mod?.showConfig || !mod?.setConfigValue || !mod?.unsetConfigValue) return null;
  return {
    showConfig: mod.showConfig,
    setConfigValue: mod.setConfigValue,
    unsetConfigValue: mod.unsetConfigValue
  };
}

async function loadTsJaspersBridge() {
  const catalogMod = await loadTsModule("domain", "jaspers-market", "catalog.js");
  const playbookMod = await loadTsModule("domain", "jaspers-market", "playbook.js");
  const storeMod = await loadTsModule("domain", "jaspers-market", "state-store.js");
  if (!catalogMod?.JASPERS_CATALOG || !playbookMod?.planMarketReply || !storeMod?.getMarketSession || !storeMod?.saveMarketSession) {
    return null;
  }
  return {
    catalog: catalogMod.JASPERS_CATALOG,
    planMarketReply: playbookMod.planMarketReply,
    getMarketSession: storeMod.getMarketSession,
    saveMarketSession: storeMod.saveMarketSession
  };
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
  loadTsReplayBridge,
  loadTsTuiBridge,
  loadTsClientsBridge,
  loadTsConfigEditBridge,
  loadTsJaspersBridge,
  buildTsAgentConfigFromCreds
};
