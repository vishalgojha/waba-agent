// @ts-nocheck
function shouldAutoStart(argv = [], { stdinIsTTY = process.stdin.isTTY, stdoutIsTTY = process.stdout.isTTY } = {}) {
  if (!stdinIsTTY || !stdoutIsTTY) return false;
  const args = Array.isArray(argv) ? argv.map((x) => String(x || "").trim()) : [];
  return args.length === 0;
}

module.exports = { shouldAutoStart };
