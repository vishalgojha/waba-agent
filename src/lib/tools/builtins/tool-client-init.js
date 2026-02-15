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
        integrations: {
          // Optional CRM integrations configured via `waba integrate ...`
          autoPush: {
            // enabled: true,
            mode: "flow_end"
          }
        },
        flows: {
          // Default flow mapping. Create/edit flows under ~/.waba/context/<client>/flows/
          active: "lead-qualification",
          intentMap: {
            greeting: "lead-qualification",
            price_inquiry: "lead-qualification",
            booking_request: "lead-qualification",
            order_intent: "lead-qualification",
            unknown: "lead-qualification"
          }
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

      // Scaffold default flow.
      try {
        const { ensurePresetFlow } = require("../../flow-store");
        await ensurePresetFlow(client, "lead-qualification");
      } catch {}
      return { ok: true, path: p, created: true };
    }
  };
}

module.exports = { toolClientInit };
