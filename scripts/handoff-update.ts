#!/usr/bin/env node
// @ts-nocheck

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const agentDir = path.join(repoRoot, ".agent");
const statePath = path.join(agentDir, "state.json");
const checklistPath = path.join(agentDir, "checklist.json");

function toIsoDate(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function runGit(cmd) {
  const parts = String(cmd || "").split(/\s+/).filter(Boolean);
  if (!parts.length) return { ok: false, out: "" };
  try {
    const out = execFileSync(parts[0], parts.slice(1), {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();
    return { ok: true, out };
  } catch {
    return { ok: false, out: "" };
  }
}

function readJsonSafe(filePath, fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function ensureArray(value, fallback = []) {
  return Array.isArray(value) ? value : fallback;
}

function parseChangedFiles(statusShortOutput) {
  if (!statusShortOutput) return [];
  const out = new Set();
  const lines = statusShortOutput.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  for (const line of lines) {
    const rawPath = line.slice(3).trim();
    if (!rawPath) continue;
    if (rawPath.includes("->")) {
      const parts = rawPath.split("->");
      const right = String(parts[parts.length - 1] || "").trim();
      if (right) out.add(right);
      continue;
    }
    out.add(rawPath);
  }
  return Array.from(out);
}

function createChecklistTemplate(existing = {}) {
  return {
    project: existing.project || path.basename(repoRoot),
    status: existing.status || "in_progress",
    phase: existing.phase || "set_current_phase",
    completed: ensureArray(existing.completed),
    pending: ensureArray(existing.pending),
    next_actions: ensureArray(existing.next_actions),
    blockers: ensureArray(existing.blockers),
    required_env: ensureArray(existing.required_env),
    safety_invariants: ensureArray(existing.safety_invariants),
    last_verified: {
      all_passed: Boolean(existing?.last_verified?.all_passed),
      commands: ensureArray(existing?.last_verified?.commands)
    }
  };
}

function main() {
  fs.mkdirSync(agentDir, { recursive: true });

  const existingState = readJsonSafe(statePath, {});
  if (!fs.existsSync(checklistPath)) {
    const template = createChecklistTemplate(existingState);
    fs.writeFileSync(checklistPath, `${JSON.stringify(template, null, 2)}\n`, "utf8");
    // eslint-disable-next-line no-console
    console.log(`Created ${path.relative(repoRoot, checklistPath)}. Fill it, then rerun this script.`);
    process.exit(1);
  }

  const checklist = readJsonSafe(checklistPath, {});
  const branchResult = runGit("git rev-parse --abbrev-ref HEAD");
  const statusResult = runGit("git status --short");
  const logResult = runGit("git log --oneline -n 3");

  const gitAvailable = branchResult.ok && statusResult.ok && logResult.ok;
  const changedFiles = statusResult.ok
    ? parseChangedFiles(statusResult.out)
    : ensureArray(existingState.files_changed_this_cycle);
  const latestCommits = logResult.ok
    ? (logResult.out
      ? logResult.out.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)
      : [])
    : ensureArray(existingState?.git?.latest_commits);

  const branch = (branchResult.ok ? branchResult.out : "")
    || checklist.branch
    || existingState.branch
    || "unknown";

  const merged = {
    updated_at: toIsoDate(),
    project: checklist.project || existingState.project || path.basename(repoRoot),
    branch,
    status: checklist.status || existingState.status || "in_progress",
    phase: checklist.phase || existingState.phase || "",
    completed: ensureArray(checklist.completed, ensureArray(existingState.completed)),
    pending: ensureArray(checklist.pending, ensureArray(existingState.pending)),
    files_changed_this_cycle: changedFiles.length
      ? changedFiles
      : ensureArray(existingState.files_changed_this_cycle),
    last_verified: {
      all_passed: Boolean(
        checklist?.last_verified?.all_passed ?? existingState?.last_verified?.all_passed ?? false
      ),
      commands: ensureArray(
        checklist?.last_verified?.commands,
        ensureArray(existingState?.last_verified?.commands)
      )
    },
    blockers: ensureArray(checklist.blockers, ensureArray(existingState.blockers)),
    required_env: ensureArray(checklist.required_env, ensureArray(existingState.required_env)),
    safety_invariants: ensureArray(
      checklist.safety_invariants,
      ensureArray(existingState.safety_invariants)
    ),
    next_actions: ensureArray(checklist.next_actions, ensureArray(existingState.next_actions)),
    git: {
      available: gitAvailable,
      dirty: gitAvailable ? changedFiles.length > 0 : null,
      changed_count: gitAvailable ? changedFiles.length : null,
      latest_commits: latestCommits
    }
  };

  fs.writeFileSync(statePath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  // eslint-disable-next-line no-console
  console.log(`Updated ${path.relative(repoRoot, statePath)} from ${path.relative(repoRoot, checklistPath)}.`);
}

main();
