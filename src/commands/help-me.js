const { logger } = require("../lib/logger");

function renderBeginnerHelp() {
  return [
    "Beginner Commands",
    "",
    "waba check  - quick readiness check",
    "waba fix    - guided fixer with simple yes/no prompts",
    "waba go     - check first, then open assistant when ready",
    "waba start  - full guided setup + launch flow",
    "waba hi     - same as waba start",
    "waba panic  - safe reset for local config issues",
    "",
    "Recommended first-time order:",
    "1) waba check",
    "2) waba fix",
    "3) waba go"
  ];
}

function registerHelpMeCommands(program) {
  program
    .command("help-me")
    .alias("helpme")
    .description("show non-technical beginner commands only")
    .action((_opts, cmd) => {
      const root = cmd.parent || program;
      const json = !!root.opts()?.json;
      const lines = renderBeginnerHelp();
      if (json) {
        // eslint-disable-next-line no-console
        console.log(
          JSON.stringify(
            {
              ok: true,
              title: lines[0],
              lines: lines.slice(2)
            },
            null,
            2
          )
        );
        return;
      }
      for (const line of lines) logger.info(line);
    });
}

module.exports = {
  registerHelpMeCommands,
  renderBeginnerHelp
};
