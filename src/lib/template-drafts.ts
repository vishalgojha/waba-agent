// @ts-nocheck
const fs = require("fs-extra");
const path = require("path");

const { contextDir } = require("./paths");
const { safeName } = require("./memory");

function draftsDir(client) {
  return path.join(contextDir(), safeName(client || "default"), "templates");
}

function draftPath(client, name) {
  return path.join(draftsDir(client), `${safeName(name)}.json`);
}

async function saveDraft(client, draft) {
  const name = draft?.name;
  if (!name) throw new Error("Draft missing name.");
  const dir = draftsDir(client);
  await fs.ensureDir(dir);
  const p = draftPath(client, name);
  await fs.writeJson(p, draft, { spaces: 2 });
  try {
    await fs.chmod(p, 0o600);
  } catch {}
  return p;
}

async function loadDraft(client, name) {
  const p = draftPath(client, name);
  if (!(await fs.pathExists(p))) return null;
  return fs.readJson(p);
}

async function listDrafts(client) {
  const dir = draftsDir(client);
  if (!(await fs.pathExists(dir))) return [];
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
  return files.map((f) => f.replace(/\.json$/, "")).sort();
}

module.exports = {
  draftsDir,
  draftPath,
  saveDraft,
  loadDraft,
  listDrafts
};

