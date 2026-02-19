function normalizeToken(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function levenshtein(a, b) {
  const s = normalizeToken(a);
  const t = normalizeToken(b);
  const dp = Array.from({ length: s.length + 1 }, () => Array(t.length + 1).fill(0));
  for (let i = 0; i <= s.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= t.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= s.length; i += 1) {
    for (let j = 1; j <= t.length; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[s.length][t.length];
}

const KEYWORD_RULES = [
  { target: "check", words: ["check", "health", "ready", "verify", "validate", "test", "diagnose", "doctor"] },
  { target: "go", words: ["go", "begin", "start", "launch", "open", "run"] },
  { target: "status", words: ["status", "state", "info", "summary"] },
  { target: "help", words: ["help", "how", "what", "guide", "assist"] }
];

function firstNonOptionIndex(args) {
  for (let i = 0; i < args.length; i += 1) {
    if (!String(args[i] || "").startsWith("-")) return i;
  }
  return -1;
}

function collectKnownCommandNames(program) {
  const set = new Set();
  for (const cmd of program.commands || []) {
    if (typeof cmd.name === "function") set.add(normalizeToken(cmd.name()));
    if (typeof cmd.aliases === "function") {
      for (const a of cmd.aliases()) set.add(normalizeToken(a));
    }
  }
  return set;
}

function resolveFriendlyCommand(args = [], knownCommands = new Set()) {
  if (!Array.isArray(args) || !args.length) return null;
  const idx = firstNonOptionIndex(args);
  if (idx < 0) return null;

  const rawCommand = String(args[idx] || "");
  const command = normalizeToken(rawCommand);
  if (!command || knownCommands.has(command)) return null;

  const tail = args.slice(idx + 1).map((x) => normalizeToken(x)).filter(Boolean);
  const allTokens = [command, ...tail];
  const scores = new Map();
  const bump = (target, points) => {
    scores.set(target, (scores.get(target) || 0) + points);
  };

  for (const rule of KEYWORD_RULES) {
    for (const token of allTokens) {
      if (rule.words.includes(token)) bump(rule.target, 3);
    }
  }

  const fuzzyTargets = ["check", "go", "status", "help"];
  for (const target of fuzzyTargets) {
    if (!knownCommands.has(normalizeToken(target))) continue;
    const d = levenshtein(command, target);
    if (d <= 2) bump(target, 5 - d);
  }

  if (!scores.size) return null;
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const [topTarget, topScore] = ranked[0];
  const second = ranked[1] ? ranked[1][1] : -Infinity;
  if (topScore < 3 || topScore === second) return null;

  const fuzzyDistance = levenshtein(command, topTarget);
  const keepTail = fuzzyDistance <= 2;
  const rewritten = [
    ...args.slice(0, idx),
    topTarget,
    ...(keepTail ? args.slice(idx + 1) : [])
  ];

  return {
    target: topTarget,
    original: rawCommand,
    rewritten,
    keepTail
  };
}

module.exports = {
  normalizeToken,
  levenshtein,
  collectKnownCommandNames,
  resolveFriendlyCommand
};
