const chalkImport = require("chalk");
const inquirerImport = require("inquirer");

const chalk = chalkImport.default || chalkImport;
const inquirer = inquirerImport.default || inquirerImport;

const { logger } = require("../lib/logger");
const { OrderAIEngine, loadOrderProfile, saveOrderProfile } = require("../lib/orderai/engine");

function formatRs(v) {
  return `₹${Number(v || 0).toFixed(2)}`;
}

function printCart(engine) {
  const view = engine.cartView();
  logger.info("Cart summary:");
  if (!view.lines.length) {
    logger.warn("Cart empty hai. Items add karo.");
    return;
  }

  for (const line of view.lines) {
    const descriptor = line.descriptor ? ` (${line.descriptor})` : "";
    // eslint-disable-next-line no-console
    console.log(chalk.white(`- ${line.item} x${line.qty}${descriptor} -> ${formatRs(line.lineTotal)}`));
    if (line.customizations.length) {
      // eslint-disable-next-line no-console
      console.log(chalk.gray(`  customizations: ${line.customizations.join(", ")}`));
    }
  }
  if (view.offers.length) {
    for (const offer of view.offers) {
      // eslint-disable-next-line no-console
      console.log(chalk.green(`  offer: ${offer.title} (-${formatRs(offer.amount)})`));
    }
  }
  // eslint-disable-next-line no-console
  console.log(chalk.cyan(`Subtotal: ${formatRs(view.subtotal)}`));
  // eslint-disable-next-line no-console
  console.log(chalk.cyan(`Taxes (est): ${formatRs(view.taxes)}`));
  // eslint-disable-next-line no-console
  console.log(chalk.cyan(`Delivery fee (est): ${formatRs(view.deliveryFee)}`));
  // eslint-disable-next-line no-console
  console.log(chalk.cyan.bold(`Total (est): ${formatRs(view.total)}`));
}

async function askInput(message, fallback = "") {
  const ans = await inquirer.prompt([
    {
      type: "input",
      name: "value",
      message,
      default: fallback
    }
  ]);
  return String(ans.value || "").trim();
}

async function askChoice(message, choices) {
  const ans = await inquirer.prompt([
    {
      type: "list",
      name: "value",
      message,
      choices
    }
  ]);
  return ans.value;
}

function printUpdate(outcome) {
  for (const msg of outcome.updates || []) logger.info(msg);
  for (const msg of outcome.warnings || []) logger.warn(msg);
  if (outcome.suggestions?.length) {
    logger.info(`Suggestion: ${outcome.suggestions[0]}`);
  }
}

async function runInteractiveSession(engine, initialText = "") {
  // Step 1: Greet + location detect.
  // eslint-disable-next-line no-console
  console.log(engine.greet());
  logger.info(engine.locationLine());
  logger.info(engine.modeLine());

  let text = String(initialText || "").trim();
  if (!text) {
    text = await askInput("Order bolo (qty + item + customizations):");
  }

  // Step 2 + 3 + 4 loop.
  while (true) {
    const outcome = engine.applyInput(text);
    printUpdate(outcome);
    printCart(engine);
    const decision = await askChoice("Sab theek hai? Edit karna hai to bolo!", [
      { name: "Confirm cart", value: "confirm" },
      { name: "Add/Edit items", value: "edit" },
      { name: "Cancel", value: "cancel" }
    ]);

    if (decision === "cancel") {
      logger.warn("Order cancelled.");
      return null;
    }
    if (decision === "confirm") break;
    text = await askInput("Bolo kya edit/add/remove karna hai:");
  }

  if (!engine.paymentMode) {
    const payment = await askChoice("Payment mode select karo:", [
      { name: "UPI", value: "UPI" },
      { name: "COD", value: "COD" },
      { name: "Card", value: "Card" },
      { name: "NetBanking", value: "NetBanking" }
    ]);
    engine.paymentMode = payment;
  }

  if (engine.serviceMode === "delivery" && !engine.deliveryAddress) {
    engine.deliveryAddress = await askInput("Delivery address bhejo:");
  }

  printCart(engine);
  const finalDecision = await askChoice("Final confirm?", [
    { name: "Place order", value: "place" },
    { name: "Edit again", value: "edit" },
    { name: "Cancel", value: "cancel" }
  ]);

  if (finalDecision === "cancel") {
    logger.warn("Order cancelled.");
    return null;
  }
  if (finalDecision === "edit") {
    const editText = await askInput("Final edit bolo:");
    return runInteractiveSession(engine, editText);
  }

  const ready = engine.isReadyForCheckout();
  if (!ready.ready) {
    logger.error(ready.reason);
    return null;
  }

  // Step 5: backend payload.
  const payload = engine.buildPayload();
  logger.ok("Order ready for backend integration.");
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(payload, null, 2));
  return payload;
}

function registerOrderCommands(program) {
  program
    .command("order")
    .description("OrderAI: McDonald's India ordering assistant")
    .argument("[request...]", "Optional first order line")
    .option("--location <text>", "Current location for store selection", "current location")
    .option("--mode <mode>", "delivery|pickup|dine-in")
    .option("--diet <diet>", "veg|non-veg|jain")
    .option("--payment <mode>", "UPI|COD|Card|NetBanking")
    .option("--address <text>", "Delivery address")
    .action(async (requestParts, opts, cmd) => {
      const root = cmd.parent?.parent || program;
      const profile = await loadOrderProfile();
      const engine = new OrderAIEngine({
        profile,
        location: opts.location,
        mode: opts.mode || profile.preferredMode || "delivery",
        diet: opts.diet || profile.diet || "veg",
        payment: opts.payment || profile.paymentMode || null,
        address: opts.address || profile.lastAddress || ""
      });
      const requestText = Array.isArray(requestParts) ? requestParts.join(" ") : String(requestParts || "");

      if (root.opts().json) {
        if (!requestText) {
          throw new Error("--json mode requires an initial order request text.");
        }
        engine.applyInput(requestText);
        if (!engine.paymentMode) engine.paymentMode = "UPI";
        if (engine.serviceMode === "delivery" && !engine.deliveryAddress) engine.deliveryAddress = opts.address || profile.lastAddress || "";
        const ready = engine.isReadyForCheckout();
        if (!ready.ready) throw new Error(`Cannot finalize JSON order: ${ready.reason}`);
        // eslint-disable-next-line no-console
        console.log(JSON.stringify(engine.buildPayload(), null, 2));
      } else {
        const payload = await runInteractiveSession(engine, requestText);
        if (!payload) return;
      }

      if (root.opts().memory !== false) {
        await saveOrderProfile(engine.profileSnapshot());
      }
    });
}

module.exports = { registerOrderCommands };
