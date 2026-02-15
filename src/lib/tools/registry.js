const { builtinTools } = require("./builtins");

function createRegistry() {
  const tools = new Map();
  for (const t of builtinTools()) tools.set(t.name, t);

  return {
    list() {
      return [...tools.values()].map((t) => ({
        name: t.name,
        description: t.description,
        risk: t.risk
      }));
    },
    get(name) {
      return tools.get(name);
    },
    has(name) {
      return tools.has(name);
    }
  };
}

module.exports = { createRegistry };

