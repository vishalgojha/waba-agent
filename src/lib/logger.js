const chalkImport = require("chalk");
const chalk = chalkImport.default || chalkImport;

let DEBUG = false;

function fmt(prefix, msg) {
  const s = typeof msg === "string" ? msg : JSON.stringify(msg, null, 2);
  return `${prefix} ${s}`;
}

const logger = {
  setDebug(v) {
    DEBUG = !!v;
  },
  debug(msg) {
    if (!DEBUG) return;
    // eslint-disable-next-line no-console
    console.log(fmt(chalk.gray("[debug]"), msg));
  },
  info(msg) {
    // eslint-disable-next-line no-console
    console.log(fmt(chalk.cyan("[info]"), msg));
  },
  warn(msg) {
    // eslint-disable-next-line no-console
    console.warn(fmt(chalk.yellow("[warn]"), msg));
  },
  error(msg) {
    // eslint-disable-next-line no-console
    console.error(fmt(chalk.red("[error]"), msg));
  },
  ok(msg) {
    // eslint-disable-next-line no-console
    console.log(fmt(chalk.green("[ok]"), msg));
  }
};

module.exports = { logger };
