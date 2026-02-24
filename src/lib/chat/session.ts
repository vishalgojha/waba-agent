// @ts-nocheck
const chalkImport = require("chalk");
const chalk = chalkImport.default || chalkImport;
const inquirerImport = require("inquirer");
const inquirer = inquirerImport.default || inquirerImport;
const oraImport = require("ora");
const ora = oraImport.default || oraImport;

const { ConversationContext } = require("./context");
const { WhatsAppAgent } = require("./agent");
const { PersistentMemory } = require("./memory");
const { logger } = require("../logger");

class ChatSession {
  constructor({ client, sessionId, language } = {}) {
    this.client = client || "default";
    this.language = language === "hi" ? "hi" : "en";
    this.id = sessionId || `chat-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    this.active = true;
    this.context = new ConversationContext(this.client, this.language);
    this.context.setSessionId(this.id);
    this.memory = new PersistentMemory(this.id, this.client);
    this.agent = new WhatsAppAgent(this.context);
  }

  async start() {
    // eslint-disable-next-line no-console
    console.clear();
    this.printHeader();

    const resumed = await this.memory.exists();
    if (resumed) {
      await this.memory.load(this.context);
      // eslint-disable-next-line no-console
      console.log(chalk.yellow("Resumed previous conversation.\n"));
      this.printRecentHistory();
    }

    await this.agent.init();
    await this.agent.refreshLeadCache();
    const greeting = this.agent.getGreeting();
    this.printAgent(greeting);

    while (this.active) {
      const userInput = await this.getUserInput();
      if (!userInput) continue;
      if (this.handleCommand(userInput)) {
        // eslint-disable-next-line no-await-in-loop
        await this.memory.save(this.context);
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      await this.processMessage(userInput);
      // eslint-disable-next-line no-await-in-loop
      await this.memory.save(this.context);
    }

    this.printGoodbye();
  }

  printHeader() {
    // eslint-disable-next-line no-console
    console.log(chalk.cyan("=".repeat(60)));
    // eslint-disable-next-line no-console
    console.log(chalk.cyan.bold("    WABA Agent - WhatsApp Business Assistant"));
    // eslint-disable-next-line no-console
    console.log(chalk.gray(`    Client: ${this.context.client || "default"}`));
    // eslint-disable-next-line no-console
    console.log(chalk.gray(`    Session: ${this.id}`));
    // eslint-disable-next-line no-console
    console.log(chalk.cyan("=".repeat(60)));
    // eslint-disable-next-line no-console
    console.log(chalk.gray("Commands: /help /exit /leads /schedule /status /lang\n"));
  }

  async getUserInput() {
    const answers = await inquirer.prompt([
      {
        type: "input",
        name: "message",
        message: chalk.green("You:"),
        prefix: ""
      }
    ]);
    return String(answers.message || "").trim();
  }

  handleCommand(input) {
    const cmd = String(input || "").trim();
    if (cmd === "/exit" || cmd === "exit") {
      this.active = false;
      return true;
    }
    if (cmd === "/help") {
      this.printHelp();
      return true;
    }
    if (cmd === "/leads") {
      this.agent.showLeadsSummary();
      return true;
    }
    if (cmd === "/schedule") {
      this.agent.showSchedule();
      return true;
    }
    if (cmd === "/status") {
      this.agent.showStatus();
      return true;
    }
    if (cmd.startsWith("/lang")) {
      const next = cmd.split(/\s+/)[1] || "";
      if (next === "hi" || next === "en") {
        this.context.setLanguage(next);
        this.printAgent(next === "hi" ? "Language switched to Hindi-English mix." : "Language switched to English.");
      } else {
        this.printAgent("Usage: /lang en|hi");
      }
      return true;
    }
    return false;
  }

  async processMessage(userInput) {
    this.context.addMessage("user", userInput);
    const spinner = ora({
      text: chalk.gray("Agent is thinking..."),
      color: "cyan"
    }).start();

    try {
      const response = await this.agent.process(userInput);
      spinner.stop();
      this.printAgent(response.message);

      if (Array.isArray(response.actions) && response.actions.length) {
        await this.executeActions(response.actions);
      }
      if (Array.isArray(response.suggestions) && response.suggestions.length) {
        this.printSuggestions(response.suggestions);
      }
    } catch (err) {
      spinner.stop();
      logger.error(`chat error: ${err?.stack || err}`);
      this.printAgent(`Sorry, I hit an error: ${err?.message || err}`);
    }
  }

  async executeActions(actions) {
    // eslint-disable-next-line no-console
    console.log(chalk.yellow("\nExecuting actions...\n"));
    for (const action of actions) {
      const spinner = ora(action.description || "Running action").start();
      try {
        // eslint-disable-next-line no-await-in-loop
        const result = await this.agent.execute(action);
        spinner.succeed(chalk.green(result.summary));
        if (result.details) {
          // eslint-disable-next-line no-console
          console.log(chalk.gray(`   ${result.details}`));
        }
        this.context.addActionResult(action, result);
      } catch (err) {
        spinner.fail(chalk.red(String(err?.message || err)));
        this.context.addActionError(action, err);
      }
    }
    // eslint-disable-next-line no-console
    console.log("");
  }

  printAgent(message) {
    // eslint-disable-next-line no-console
    console.log(chalk.cyan("\nAgent: ") + chalk.white(String(message || "")) + "\n");
  }

  printSuggestions(suggestions) {
    // eslint-disable-next-line no-console
    console.log(chalk.gray("Suggestions:"));
    for (let i = 0; i < suggestions.length; i++) {
      // eslint-disable-next-line no-console
      console.log(chalk.gray(`  ${i + 1}. ${suggestions[i]}`));
    }
    // eslint-disable-next-line no-console
    console.log("");
  }

  printHelp() {
    // eslint-disable-next-line no-console
    console.log(chalk.cyan("\nHelp:\n"));
    // eslint-disable-next-line no-console
    console.log(chalk.white("Natural examples:"));
    // eslint-disable-next-line no-console
    console.log(chalk.gray('  "I got 5 new leads from 99acres for ACME"'));
    // eslint-disable-next-line no-console
    console.log(chalk.gray('  "qualify them"'));
    // eslint-disable-next-line no-console
    console.log(chalk.gray('  "schedule follow-up tomorrow 10am"'));
    // eslint-disable-next-line no-console
    console.log(chalk.gray('  "show templates"'));
    // eslint-disable-next-line no-console
    console.log(chalk.gray('  "Hindi mein reply karo"'));
    // eslint-disable-next-line no-console
    console.log(chalk.white("\nQuick commands:"));
    // eslint-disable-next-line no-console
    console.log(chalk.gray("  /leads    show lead summary"));
    // eslint-disable-next-line no-console
    console.log(chalk.gray("  /schedule show scheduled actions in this session"));
    // eslint-disable-next-line no-console
    console.log(chalk.gray("  /status   show chat agent status"));
    // eslint-disable-next-line no-console
    console.log(chalk.gray("  /lang hi|en switch language"));
    // eslint-disable-next-line no-console
    console.log(chalk.gray("  /exit     end chat session\n"));
  }

  printRecentHistory() {
    const rows = this.context.getRecentMessages(5);
    if (!rows.length) return;
    // eslint-disable-next-line no-console
    console.log(chalk.gray("Recent conversation:"));
    for (const msg of rows) {
      const prefix = msg.role === "user" ? "You:" : "Agent:";
      const color = msg.role === "user" ? chalk.green : chalk.cyan;
      // eslint-disable-next-line no-console
      console.log(color(`  ${prefix} ${String(msg.content || "").slice(0, 120)}`));
    }
    // eslint-disable-next-line no-console
    console.log("");
  }

  printGoodbye() {
    // eslint-disable-next-line no-console
    console.log(chalk.cyan('\nConversation saved. Type "waba chat resume" to continue.\n'));
  }
}

module.exports = { ChatSession };
