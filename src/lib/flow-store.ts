// @ts-nocheck
const fs = require("fs-extra");
const path = require("path");

const { contextDir } = require("./paths");
const { safeName } = require("./memory");

function flowsDir(client) {
  return path.join(contextDir(), safeName(client || "default"), "flows");
}

function flowPath(client, flowName) {
  return path.join(flowsDir(client), `${safeName(flowName)}.json`);
}

function newStepId() {
  return `stp_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function presetLeadQualification(flowName = "lead-qualification") {
  return {
    id: safeName(flowName),
    name: flowName,
    version: 1,
    createdAt: new Date().toISOString(),
    steps: [
      { id: newStepId(), type: "reply", text: "Thanks for contacting us. I will ask a few quick questions to help you." },
      { id: newStepId(), type: "question", field: "name", text: "What is your name?" },
      { id: newStepId(), type: "question", field: "requirement", text: "What are you looking for?" },
      { id: newStepId(), type: "question", field: "location", text: "Which area/location?" },
      { id: newStepId(), type: "question", field: "budget", text: "What is your budget range?" },
      {
        id: newStepId(),
        type: "condition",
        if: "budget >= 10L",
        // If high budget, fast-track to handoff (step index points to the handoff step below).
        thenStepIndex: 6,
        elseStepIndex: 7
      },
      { id: newStepId(), type: "handoff", reason: "high_budget", text: "Thanks {{name}}. Noted. Our senior advisor will contact you shortly." },
      { id: newStepId(), type: "question", field: "timeline", text: "When do you want to proceed?" },
      {
        id: newStepId(),
        type: "end",
        text: "Thanks {{name}}. Noted: {{requirement}} in {{location}}, budget {{budget}}, timeline {{timeline}}. Our team will get back shortly."
      }
    ]
  };
}

async function ensurePresetFlow(client, flowName) {
  const p = flowPath(client, flowName);
  if (await fs.pathExists(p)) return { path: p, created: false };
  await fs.ensureDir(path.dirname(p));
  const flow = presetLeadQualification(flowName);
  await fs.writeJson(p, flow, { spaces: 2 });
  try {
    await fs.chmod(p, 0o600);
  } catch {}
  return { path: p, created: true };
}

async function loadFlow(client, flowName) {
  const p = flowPath(client, flowName);
  if (!(await fs.pathExists(p))) return null;
  try {
    const data = await fs.readJson(p);
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}

async function saveFlow(client, flow) {
  const name = flow?.name || flow?.id;
  if (!name) throw new Error("Flow missing name.");
  const p = flowPath(client, name);
  await fs.ensureDir(path.dirname(p));
  await fs.writeJson(p, flow, { spaces: 2 });
  try {
    await fs.chmod(p, 0o600);
  } catch {}
  return p;
}

async function listFlows(client) {
  const dir = flowsDir(client);
  if (!(await fs.pathExists(dir))) return [];
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
  return files.map((f) => f.replace(/\.json$/, "")).sort();
}

module.exports = {
  flowsDir,
  flowPath,
  newStepId,
  presetLeadQualification,
  ensurePresetFlow,
  loadFlow,
  saveFlow,
  listFlows
};
