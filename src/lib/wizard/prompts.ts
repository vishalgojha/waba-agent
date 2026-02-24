// @ts-nocheck
class WizardCancelledError extends Error {
  constructor(message = "wizard cancelled") {
    super(message);
    this.name = "WizardCancelledError";
  }
}

function isWizardCancelledError(err) {
  return err instanceof WizardCancelledError;
}

module.exports = {
  WizardCancelledError,
  isWizardCancelledError
};
