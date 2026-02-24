// @ts-nocheck
const { loadFlow } = require("./flow-store");
const { getConversation, setConversation } = require("./flow-state");
const { evalExpr } = require("./flow-expr");

function renderVars(text, vars) {
  let out = String(text || "");
  const v = vars && typeof vars === "object" ? vars : {};
  out = out.replace(/\{\{\s*([a-zA-Z0-9._-]+)\s*\}\}/g, (_m, key) => {
    const val = v[key];
    if (val === null || val === undefined) return "";
    return String(val);
  });
  return out;
}

async function handleInboundWithFlow({ client, from, inboundText, flowName, nowIso }) {
  const flow = await loadFlow(client, flowName);
  if (!flow) return { ok: false, reason: "flow_not_found" };
  const steps = Array.isArray(flow.steps) ? flow.steps : [];
  if (!steps.length) return { ok: false, reason: "flow_empty" };

  const prev = await getConversation(client, from);
  const prevActive = prev && prev.flow === flowName && !prev.completedAt;
  const convo = prevActive
    ? { ...prev }
    : {
        flow: flowName,
        stepIndex: 0,
        waiting: null, // { field, stepIndex }
        data: {},
        startedAt: nowIso,
        updatedAt: nowIso,
        completedAt: null
      };

  convo.updatedAt = nowIso;
  convo.lastInboundAt = nowIso;

  // Capture answer if we were waiting for a field.
  const text = String(inboundText || "").trim();
  if (convo.waiting && text) {
    const { field, stepIndex } = convo.waiting;
    convo.data = { ...(convo.data || {}), [field]: text };
    convo.stepIndex = Math.max(convo.stepIndex, (stepIndex ?? convo.stepIndex) + 1);
    convo.waiting = null;
  }

  // Run until we emit one outbound message or finish.
  while (convo.stepIndex < steps.length) {
    const step = steps[convo.stepIndex];
    if (!step || typeof step !== "object") {
      convo.stepIndex += 1;
      continue;
    }

    if (step.type === "condition") {
      const expr = step.if || step.expr;
      const ok = evalExpr(expr, { ...(convo.data || {}), _last: text });
      const thenStep = Number.isFinite(Number(step.thenStepIndex)) ? Number(step.thenStepIndex) : null;
      const elseStep = Number.isFinite(Number(step.elseStepIndex)) ? Number(step.elseStepIndex) : null;
      if (ok && thenStep != null) convo.stepIndex = thenStep;
      else if (!ok && elseStep != null) convo.stepIndex = elseStep;
      else convo.stepIndex += 1;
      await setConversation(client, from, convo);
      continue;
    }

    if (step.type === "question") {
      const field = String(step.field || "").trim();
      if (!field) {
        convo.stepIndex += 1;
        continue;
      }
      convo.waiting = { field, stepIndex: convo.stepIndex };
      await setConversation(client, from, convo);
      return {
        ok: true,
        flow: flowName,
        action: "ask",
        message: { type: "text", body: renderVars(step.text, convo.data) },
        state: convo
      };
    }

    if (step.type === "reply") {
      convo.stepIndex += 1;
      await setConversation(client, from, convo);
      return {
        ok: true,
        flow: flowName,
        action: "reply",
        message: { type: "text", body: renderVars(step.text, convo.data) },
        state: convo
      };
    }

    if (step.type === "handoff") {
      convo.stepIndex = steps.length;
      convo.completedAt = nowIso;
      convo.handoff = { reason: step.reason || "handoff", at: nowIso };
      await setConversation(client, from, convo);
      return {
        ok: true,
        flow: flowName,
        action: "handoff",
        message: step.text ? { type: "text", body: renderVars(step.text, convo.data) } : null,
        state: convo
      };
    }

    if (step.type === "end") {
      convo.stepIndex = steps.length;
      convo.completedAt = nowIso;
      await setConversation(client, from, convo);
      return {
        ok: true,
        flow: flowName,
        action: "end",
        message: step.text ? { type: "text", body: renderVars(step.text, convo.data) } : null,
        state: convo
      };
    }

    // Unknown step type: skip.
    convo.stepIndex += 1;
  }

  await setConversation(client, from, convo);
  return { ok: true, flow: flowName, action: "noop", message: null, state: convo };
}

module.exports = { handleInboundWithFlow };
