const fs = require("fs-extra");
const path = require("path");

const { clientDir } = require("../../memory");

function toolClientInit() {
  return {
    name: "client.init",
    description: "Initialize per-client config scaffolding for India SMB lead automation.",
    risk: "low",
    async execute(ctx, args) {
      const client = args?.client || ctx.client || "default";
      const dir = clientDir(client);
      await fs.ensureDir(dir);

      const p = path.join(dir, "client.json");
      if (await fs.pathExists(p)) return { ok: true, path: p, created: false };

      const cfg = {
        client,
        timezone: "Asia/Kolkata",
        businessType: args?.businessType || "generic",
        leadQuestions: [
          "What is your name?",
          "What are you looking for?",
          "Location/area?",
          "Budget range?",
          "When do you want to proceed?"
        ],
        templates: {
          // For outbound outside the 24h customer-service window:
          // welcome: { "name": "welcome_template_name", "language": "en" }
          welcome: null
        },
        intentReplies: {
          greeting: "Thanks for contacting us. Please share your name and requirement. We'll reply shortly.",
          price_inquiry: "Sure. Please share the product/service name and your location. We'll send pricing and options.",
          booking_request: "Sure. Please share preferred date/time and your location. We'll confirm the slot.",
          order_intent: "Great. Please share the item/service you want, quantity, and delivery location.",
          fallback: "Thanks. Please share your name, location, and requirement. We'll get back shortly."
        },
        handoff: {
          mode: "human",
          notifyNumber: args?.notifyNumber || null
        },
        autoReplies: {
          greeting: "Thanks for contacting us. Please share your name and requirement. We'll reply shortly.",
          afterHours: "Thanks! We're currently offline. We'll get back to you during business hours."
        }
      };

      await fs.writeJson(p, cfg, { spaces: 2 });
      try {
        await fs.chmod(p, 0o600);
      } catch {}
      return { ok: true, path: p, created: true };
    }
  };
}

module.exports = { toolClientInit };

