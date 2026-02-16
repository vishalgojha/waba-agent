const inquirerImport = require("inquirer");
const inquirer = inquirerImport.default || inquirerImport;
const oraImport = require("ora");
const ora = oraImport.default || oraImport;

const { askInput, askYesNo } = require("../prompt");
const { logger } = require("../logger");
const { WizardCancelledError } = require("./prompts");

function isPromptCancelled(err) {
  const name = String(err?.name || "");
  const msg = String(err?.message || "");
  return (
    name === "ExitPromptError" ||
    name === "AbortPromptError" ||
    name === "AbortError" ||
    msg.toLowerCase().includes("user force closed")
  );
}

async function guardCancellation(work) {
  try {
    return await work();
  } catch (err) {
    if (isPromptCancelled(err)) {
      throw new WizardCancelledError();
    }
    throw err;
  }
}

function createWizardPrompter() {
  return {
    async intro(title) {
      logger.info(title);
    },
    async outro(message) {
      logger.ok(message);
    },
    async note(message, title) {
      if (title) {
        logger.info(`[${title}] ${message}`);
        return;
      }
      logger.info(message);
    },
    async text(params) {
      let value = String(params?.initialValue || "");
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const suffix = params?.placeholder ? ` (${params.placeholder})` : "";
        const label = `${params?.message || "Input"}${suffix}`;
        const raw = await guardCancellation(() => askInput(label));
        value = String(raw || "").trim();
        if (!value && params?.initialValue) value = String(params.initialValue);
        const reason = typeof params?.validate === "function" ? params.validate(value) : undefined;
        if (!reason) return value;
        logger.warn(reason);
      }
    },
    async confirm(params) {
      return await guardCancellation(() =>
        askYesNo(params?.message || "Continue?", { defaultYes: !!params?.initialValue })
      );
    },
    async select(params) {
      const out = await guardCancellation(() =>
        inquirer.prompt([
          {
            type: "list",
            name: "value",
            message: params?.message || "Select",
            default: params?.initialValue,
            choices: (params?.options || []).map((opt) => ({
              value: opt.value,
              name: opt.hint ? `${opt.label} - ${opt.hint}` : opt.label
            }))
          }
        ])
      );
      return out.value;
    },
    async multiselect(params) {
      const out = await guardCancellation(() =>
        inquirer.prompt([
          {
            type: "checkbox",
            name: "values",
            message: params?.message || "Select",
            choices: (params?.options || []).map((opt) => ({
              value: opt.value,
              name: opt.hint ? `${opt.label} - ${opt.hint}` : opt.label,
              checked: Array.isArray(params?.initialValues) ? params.initialValues.includes(opt.value) : false
            }))
          }
        ])
      );
      return Array.isArray(out.values) ? out.values : [];
    },
    progress(label) {
      const spin = ora({ text: label || "Working..." }).start();
      return {
        update(message) {
          spin.text = message || label || "Working...";
        },
        stop(message) {
          if (message) {
            spin.succeed(message);
          } else {
            spin.stop();
          }
        }
      };
    }
  };
}

module.exports = { createWizardPrompter };
