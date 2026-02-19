const os = require("os");
const path = require("path");

function wabaHome() {
  // Allows easy multi-tenant setups for agencies.
  const fromEnv = process.env.WABA_HOME || process.env.WABA_AGENT_HOME;
  if (fromEnv) return fromEnv;
  // Default to ~/.waba for compatibility with common naming and existing tooling.
  return path.join(os.homedir(), ".waba");
}

function configPath() {
  return path.join(wabaHome(), "config.json");
}

function contextDir() {
  return path.join(wabaHome(), "context");
}

function schedulesPath() {
  return path.join(wabaHome(), "schedules.json");
}

function optoutDir() {
  return path.join(wabaHome(), "optout");
}

function campaignsDir() {
  return path.join(wabaHome(), "campaigns");
}

function reportsDir() {
  return path.join(wabaHome(), "reports");
}

function storageDir() {
  return path.join(wabaHome(), "storage");
}

function sqlitePath() {
  return path.join(storageDir(), "waba.sqlite");
}

module.exports = { wabaHome, configPath, contextDir, schedulesPath, optoutDir, campaignsDir, reportsDir, storageDir, sqlitePath };
