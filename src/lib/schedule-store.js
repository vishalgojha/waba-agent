const fs = require("fs-extra");

const { schedulesPath, wabaHome } = require("./paths");

async function readSchedules() {
  const p = schedulesPath();
  if (!(await fs.pathExists(p))) return [];
  const data = await fs.readJson(p);
  return Array.isArray(data) ? data : [];
}

async function writeSchedules(list) {
  await fs.ensureDir(wabaHome());
  const p = schedulesPath();
  await fs.writeJson(p, list, { spaces: 2 });
  try {
    await fs.chmod(p, 0o600);
  } catch {}
  return p;
}

function newId() {
  return `sch_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

module.exports = { readSchedules, writeSchedules, newId };

