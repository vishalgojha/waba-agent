// @ts-nocheck
function toolMemoryNote() {
  return {
    name: "memory.note",
    description: "Append a note to per-client memory (append-only).",
    risk: "low",
    async execute(ctx, args) {
      const client = args?.client || ctx.client || "default";
      const text = args?.text || "";
      await ctx.appendMemory(client, { type: "note", text });
      return { ok: true };
    }
  };
}

module.exports = { toolMemoryNote };
