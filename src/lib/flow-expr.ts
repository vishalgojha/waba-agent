// @ts-nocheck
function parseAmount(x) {
  const s = String(x ?? "").trim().toLowerCase();
  if (!s) return null;

  // Normalize common India units.
  // 10l / 10 lakh -> 10 * 100000
  // 1cr / 1 crore -> 1 * 10000000
  const cleaned = s.replace(/,/g, "").replace(/\s+/g, " ");
  const m1 = cleaned.match(/^(\d+(?:\.\d+)?)\s*(l|lakh|lakhs)$/);
  if (m1) return Number(m1[1]) * 100000;
  const m2 = cleaned.match(/^(\d+(?:\.\d+)?)\s*(cr|crore|crores)$/);
  if (m2) return Number(m2[1]) * 10000000;

  const n = Number(cleaned.replace(/[^0-9.]/g, ""));
  if (Number.isFinite(n) && n > 0) return n;
  return null;
}

function parseValue(raw) {
  const t = String(raw ?? "").trim();
  if (!t) return { kind: "string", value: "" };
  const q = t.match(/^"(.*)"$/) || t.match(/^'(.*)'$/);
  if (q) return { kind: "string", value: q[1] };

  const amt = parseAmount(t);
  if (amt != null) return { kind: "number", value: amt };

  return { kind: "string", value: t };
}

function parseExpr(expr) {
  const s = String(expr ?? "").trim();
  if (!s) return null;

  // Supported:
  // field > 10L
  // field contains "abc"
  const m = s.match(/^([a-zA-Z0-9._-]+)\s*(==|!=|>=|<=|>|<|contains)\s*(.+)$/);
  if (!m) return null;
  return { field: m[1], op: m[2], value: parseValue(m[3]) };
}

function getField(vars, field) {
  const v = vars && typeof vars === "object" ? vars : {};
  return v[field];
}

function evalExpr(expr, vars) {
  const ast = typeof expr === "string" ? parseExpr(expr) : expr;
  if (!ast) return false;
  const leftRaw = getField(vars, ast.field);
  if (leftRaw === undefined || leftRaw === null) return false;

  if (ast.op === "contains") {
    const left = String(leftRaw).toLowerCase();
    const right = String(ast.value?.value ?? "").toLowerCase();
    return left.includes(right);
  }

  // Numeric comparisons try amount parsing first.
  const leftNum = parseAmount(leftRaw);
  const rightNum = ast.value?.kind === "number" ? ast.value.value : parseAmount(ast.value?.value);
  const canNum = leftNum != null && rightNum != null;

  if (canNum) {
    if (ast.op === ">") return leftNum > rightNum;
    if (ast.op === "<") return leftNum < rightNum;
    if (ast.op === ">=") return leftNum >= rightNum;
    if (ast.op === "<=") return leftNum <= rightNum;
    if (ast.op === "==") return leftNum === rightNum;
    if (ast.op === "!=") return leftNum !== rightNum;
  }

  const left = String(leftRaw).trim().toLowerCase();
  const right = String(ast.value?.value ?? "").trim().toLowerCase();
  if (ast.op === "==") return left === right;
  if (ast.op === "!=") return left !== right;
  if (ast.op === ">") return left > right;
  if (ast.op === "<") return left < right;
  if (ast.op === ">=") return left >= right;
  if (ast.op === "<=") return left <= right;
  return false;
}

module.exports = { parseExpr, evalExpr, parseAmount };

